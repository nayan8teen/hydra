import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";

import {
  GoogleDriveClient,
  type GoogleDriveClientEndpoints,
} from "./google-drive-client.js";
import { isGoogleDrivePreconditionFailedError } from "./google-drive-errors.js";

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

interface FakeDriveServer {
  endpoints: GoogleDriveClientEndpoints;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

const readBody = (request: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const startFakeDrive = async (): Promise<FakeDriveServer> => {
  const requests: RecordedRequest[] = [];
  let origin = "";

  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const url = new URL(request.url ?? "/", origin);
      requests.push({
        method: request.method ?? "GET",
        url: `${url.pathname}${url.search}`,
        headers: request.headers,
        body,
      });

      const json = (status: number, payload: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      if (request.method === "POST" && url.pathname === "/files") {
        json(200, {
          id: "folder-1",
          name: JSON.parse(body.toString("utf8")).name,
          mimeType: "application/vnd.google-apps.folder",
          etag: "etag-folder-1",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/files") {
        json(200, {
          files: [{ id: "blob-1", name: "hash-1", etag: "etag-blob-1" }],
          nextPageToken: "page-2",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/files/file-1") {
        if (url.searchParams.get("alt") === "media") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ schemaVersion: 1, files: [] }));
          return;
        }
        json(200, {
          id: "file-1",
          name: "manifest.json",
          etag: "etag-1",
          modifiedTime: "2026-01-01T00:00:00.000Z",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/files/missing") {
        json(404, { error: { message: "notFound" } });
        return;
      }

      if (request.method === "GET" && url.pathname === "/files/flaky") {
        const attempts = requests.filter((entry) =>
          entry.url.startsWith("/files/flaky")
        ).length;
        if (attempts <= 1) {
          json(401, { error: { message: "unauthorized" } });
          return;
        }
        json(200, { id: "flaky", name: "flaky", etag: "etag-flaky" });
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/files/blob-1") {
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/upload/files") {
        const uploadType = url.searchParams.get("uploadType");
        if (uploadType === "resumable") {
          response.writeHead(200, {
            Location: `${origin}/upload-session/1`,
          });
          response.end();
          return;
        }
        json(200, {
          id: "manifest-1",
          name: "manifest.json",
          etag: "etag-manifest-1",
        });
        return;
      }

      if (request.method === "PUT" && url.pathname === "/upload-session/1") {
        json(200, { id: "blob-1", name: "hash-1", size: String(body.length) });
        return;
      }

      if (
        request.method === "PATCH" &&
        url.pathname === "/upload/files/file-1"
      ) {
        if (request.headers["if-match"] === "stale-etag") {
          json(412, { error: { message: "preconditionFailed" } });
          return;
        }
        json(200, {
          id: "file-1",
          name: "manifest.json",
          etag: "etag-2",
        });
        return;
      }

      json(500, {
        error: { message: `unhandled ${request.method} ${url.pathname}` },
      });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake Drive server failed to start");
  }
  origin = `http://127.0.0.1:${address.port}`;

  return {
    endpoints: {
      filesUrl: `${origin}/files`,
      uploadUrl: `${origin}/upload/files`,
    },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

describe("Google Drive REST client", () => {
  let fake: FakeDriveServer;
  let client: GoogleDriveClient;
  let tempDir: string;

  before(async () => {
    fake = await startFakeDrive();
    client = new GoogleDriveClient(async () => "access-token", fake.endpoints);
    tempDir = await mkdtemp(path.join(os.tmpdir(), "hydra-drive-client-"));
  });

  after(async () => {
    await fake.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("lists and finds files with the requested fields", async () => {
    const list = await client.listFiles({ query: "name = 'hash-1'" });
    assert.equal(list.files[0]?.id, "blob-1");
    assert.equal(list.nextPageToken, "page-2");

    const request = fake.requests.at(-1);
    const url = new URL(request!.url, "http://localhost");
    assert.equal(url.searchParams.get("q"), "name = 'hash-1'");
    assert.equal(url.searchParams.get("spaces"), "drive");
    assert.equal(request!.headers.authorization, "Bearer access-token");
  });

  it("creates folders and reads their metadata", async () => {
    const folder = await client.createFolder({
      name: "Hydra Save Sync",
      parentId: "root",
      appProperties: { hydraRole: "root" },
    });
    assert.equal(folder.id, "folder-1");

    const body = JSON.parse(fake.requests.at(-1)!.body.toString("utf8"));
    assert.equal(body.name, "Hydra Save Sync");
    assert.deepEqual(body.parents, ["root"]);
    assert.equal(body.mimeType, "application/vnd.google-apps.folder");

    const metadata = await client.getFileMetadata("file-1");
    assert.equal(metadata?.etag, "etag-1");
    assert.equal(await client.getFileMetadata("missing"), null);
  });

  it("uploads a JSON file as a multipart body", async () => {
    const file = await client.createJsonFile({
      name: "manifest.json",
      parentId: "folder-1",
      appProperties: { hydraRole: "manifest" },
      content: '{"version":1}',
    });
    assert.equal(file.id, "manifest-1");

    const request = fake.requests.at(-1)!;
    const body = request.body.toString("utf8");
    assert.match(request.headers["content-type"] ?? "", /multipart\/related/);
    assert.match(body, /"name":"manifest.json"/);
    assert.match(body, /\{"version":1\}/);
  });

  it("guards manifest updates with If-Match", async () => {
    const updated = await client.updateJsonFile({
      fileId: "file-1",
      content: '{"version":2}',
      ifMatch: "etag-1",
    });
    assert.equal(updated.etag, "etag-2");
    assert.equal(fake.requests.at(-1)!.headers["if-match"], "etag-1");

    await assert.rejects(
      client.updateJsonFile({
        fileId: "file-1",
        content: '{"version":3}',
        ifMatch: "stale-etag",
      }),
      (error: unknown) => isGoogleDrivePreconditionFailedError(error)
    );
  });

  it("streams a blob through a resumable upload session", async () => {
    const absolutePath = path.join(tempDir, "blob.bin");
    await rm(absolutePath, { force: true });
    const bytes = Buffer.from("save-bytes".repeat(64));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(absolutePath, bytes);

    const uploaded = await client.uploadBlobFile({
      name: "hash-1",
      parentId: "blobs",
      absolutePath,
      sizeBytes: bytes.length,
      appProperties: { sha256: "hash-1" },
    });
    assert.equal(uploaded.id, "blob-1");

    const sessionRequest = fake.requests.find((request) =>
      request.url.includes("uploadType=resumable")
    );
    assert.equal(
      sessionRequest?.headers["x-upload-content-length"],
      String(bytes.length)
    );
    const putRequest = fake.requests.find(
      (request) => request.method === "PUT"
    );
    assert.equal(putRequest?.body.length, bytes.length);
    assert.equal(putRequest?.body.toString("utf8"), bytes.toString("utf8"));
  });

  it("downloads JSON and file contents to disk", async () => {
    const json = await client.downloadJson("file-1");
    assert.deepEqual(json, { schemaVersion: 1, files: [] });

    const destinationPath = path.join(tempDir, "manifest.json");
    await client.downloadFileToPath({ fileId: "file-1", destinationPath });
    assert.equal(
      await readFile(destinationPath, "utf8"),
      JSON.stringify({ schemaVersion: 1, files: [] })
    );
  });

  it("deletes files", async () => {
    await client.deleteFile("blob-1");
    assert.equal(fake.requests.at(-1)?.method, "DELETE");
  });

  it("refreshes the token once when Drive answers 401", async () => {
    const calls: Array<{ forceRefresh?: boolean } | undefined> = [];
    const retryingClient = new GoogleDriveClient(async (options) => {
      calls.push(options);
      return "access-token";
    }, fake.endpoints);

    const metadata = await retryingClient.getFileMetadata("flaky");
    assert.equal(metadata?.id, "flaky");
    assert.deepEqual(calls, [undefined, { forceRefresh: true }]);
    assert.equal(
      fake.requests.filter((request) => request.url.startsWith("/files/flaky"))
        .length,
      2
    );
  });
});
