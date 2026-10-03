import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { describe, it, before, after } from "node:test";

import { GoogleDriveClient } from "./google-drive-client.js";
import { GoogleDriveDocuments } from "./google-drive-documents.js";

interface StoredFile {
  id: string;
  name: string;
  content: string;
  revision: string;
}

interface FakeDriveServer {
  documentsFolderId: string;
  files: Map<string, StoredFile>;
  close: () => Promise<void>;
  origin: string;
}

const readBody = (request: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const FOLDER_MIME = "application/vnd.google-apps.folder";

const startFakeDrive = async (): Promise<FakeDriveServer> => {
  const state: FakeDriveServer = {
    documentsFolderId: "docs-folder",
    files: new Map(),
    origin: "",
    close: async () => {},
  };
  let sequence = 0;

  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const url = new URL(request.url ?? "/", state.origin);
      const json = (status: number, payload: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      if (request.method === "GET" && url.pathname === "/files") {
        const query = url.searchParams.get("q") ?? "";
        const nameMatch = /name = '([^']+)'/.exec(query);
        const name = nameMatch?.[1] ?? "";
        if (query.includes(FOLDER_MIME)) {
          json(200, {
            files:
              name === "documents"
                ? [
                    {
                      id: state.documentsFolderId,
                      name: "documents",
                      mimeType: FOLDER_MIME,
                      headRevisionId: "folder-revision",
                    },
                  ]
                : [],
          });
          return;
        }
        const file = state.files.get(name);
        json(200, {
          files: file
            ? [
                {
                  id: file.id,
                  name: file.name,
                  headRevisionId: file.revision,
                },
              ]
            : [],
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/upload/files") {
        const boundary =
          /boundary=(.+)$/.exec(request.headers["content-type"] ?? "")?.[1] ??
          "";
        const parsePart = (part: string) => {
          const index = part.indexOf("\r\n\r\n");
          return part.slice(index + 4).replace(/\r\n$/, "");
        };
        const parts = body.toString("utf8").split(`--${boundary}`);
        const metadata = JSON.parse(parsePart(parts[1])) as { name: string };
        const content = parsePart(parts[2]);
        const id = `file-${++sequence}`;
        const file: StoredFile = {
          id,
          name: metadata.name,
          content,
          revision: `${id}-rev-1`,
        };
        state.files.set(metadata.name, file);
        json(200, {
          id,
          name: metadata.name,
          headRevisionId: file.revision,
        });
        return;
      }

      const uploadMatch = /^\/upload\/files\/(.+)$/.exec(url.pathname);
      if (request.method === "PATCH" && uploadMatch) {
        const id = decodeURIComponent(uploadMatch[1]);
        const file = [...state.files.values()].find((entry) => entry.id === id);
        if (!file) {
          json(404, { error: { message: "notFound" } });
          return;
        }
        if (request.headers["if-match"] !== file.revision) {
          json(412, { error: { message: "preconditionFailed" } });
          return;
        }
        file.content = body.toString("utf8");
        file.revision = `${id}-rev-${++sequence}`;
        json(200, { id, name: file.name, headRevisionId: file.revision });
        return;
      }

      const fileMatch = /^\/files\/(.+)$/.exec(url.pathname);
      if (fileMatch) {
        const id = decodeURIComponent(fileMatch[1]);
        const file = [...state.files.values()].find((entry) => entry.id === id);
        if (request.method === "DELETE") {
          if (file) state.files.delete(file.name);
          response.writeHead(204);
          response.end();
          return;
        }
        if (
          request.method === "GET" &&
          url.searchParams.get("alt") === "media"
        ) {
          if (!file) {
            json(404, { error: { message: "notFound" } });
            return;
          }
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(file.content);
          return;
        }
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
  state.origin = `http://127.0.0.1:${address.port}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  return state;
};

describe("GoogleDriveDocuments", () => {
  let fake: FakeDriveServer;
  let documents: GoogleDriveDocuments;

  before(async () => {
    fake = await startFakeDrive();
    documents = new GoogleDriveDocuments({
      client: new GoogleDriveClient(async () => "access-token", {
        filesUrl: `${fake.origin}/files`,
        uploadUrl: `${fake.origin}/upload/files`,
      }),
      getRootFolderId: async () => "root",
    });
  });

  after(async () => {
    await fake.close();
  });

  it("creates a document and reads it back", async () => {
    const written = await documents.write("achievements-steam-1.json", {
      value: 1,
    });
    assert.equal(written.content.value, 1);
    assert.ok(written.revision);

    const read = await documents.read<{ value: number }>(
      "achievements-steam-1.json"
    );
    assert.deepEqual(read?.content, { value: 1 });
    assert.equal(read?.revision, written.revision);
  });

  it("returns null for a missing document", async () => {
    assert.equal(await documents.read("missing.json"), null);
  });

  it("updates an existing document with a read-modify-write", async () => {
    const first = await documents.update<{ items: string[] }>(
      "library.json",
      (current) => ({ items: [...(current?.items ?? []), "a"] })
    );
    assert.deepEqual(first.content, { items: ["a"] });

    const second = await documents.update<{ items: string[] }>(
      "library.json",
      (current) => ({ items: [...(current?.items ?? []), "b"] })
    );
    assert.deepEqual(second.content, { items: ["a", "b"] });
    assert.notEqual(second.revision, first.revision);
  });

  it("removes a document", async () => {
    await documents.write("artwork-steam-1.json", { hash: "x" });
    await documents.remove("artwork-steam-1.json");
    assert.equal(await documents.read("artwork-steam-1.json"), null);
  });
});
