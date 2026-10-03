import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { describe, it } from "node:test";

import { GoogleDriveOAuthClient } from "./google-drive-oauth-client.js";

const MARKER_PATTERN = /^google_drive_[a-z0-9_]+/;

const markerOf = (error: unknown) =>
  MARKER_PATTERN.exec(error instanceof Error ? error.message : "")?.[0] ?? null;

interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  params: URLSearchParams;
}

interface FakeOAuthServer {
  endpoints: { tokenUrl: string; userinfoUrl: string };
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

interface FakeResponse {
  status: number;
  body: unknown;
}

type FakeHandler = (request: RecordedRequest) => FakeResponse;

const readBody = (request: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const startFakeOAuth = async (
  handler: FakeHandler
): Promise<FakeOAuthServer> => {
  const requests: RecordedRequest[] = [];
  let origin = "";

  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const url = new URL(request.url ?? "/", origin);
      const recorded: RecordedRequest = {
        method: request.method ?? "GET",
        path: url.pathname,
        headers: request.headers,
        params: new URLSearchParams(body.toString("utf8")),
      };
      requests.push(recorded);

      const result = handler(recorded);
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result.body));
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") {
        origin = `http://127.0.0.1:${address.port}`;
      }
      resolve();
    });
  });

  return {
    endpoints: {
      tokenUrl: `${origin}/token`,
      userinfoUrl: `${origin}/userinfo`,
    },
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const exchangeParams = {
  clientId: "123456789012-abcdefghijklmnop.apps.googleusercontent.com",
  code: "4/0Aauthorization-code",
  codeVerifier: "verifier-value",
  redirectUri: "http://127.0.0.1:49152/oauth2callback",
};

const onTokenPath = (response: (params: URLSearchParams) => FakeResponse) => {
  return (request: RecordedRequest): FakeResponse => {
    if (request.path !== "/token") {
      return { status: 404, body: { error: "not_found" } };
    }
    return response(request.params);
  };
};

describe("google drive oauth client", () => {
  it("exchanges the PKCE code for tokens", async () => {
    const fake = await startFakeOAuth(
      onTokenPath(() => ({
        status: 200,
        body: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 1800,
          scope: "https://www.googleapis.com/auth/drive.file",
        },
      }))
    );

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);
      const tokens = await client.exchangeAuthorizationCode(exchangeParams);

      assert.deepEqual(tokens, {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresInSeconds: 1800,
        scope: "https://www.googleapis.com/auth/drive.file",
      });

      const [request] = fake.requests;
      assert.equal(request.method, "POST");
      assert.equal(
        request.headers["content-type"],
        "application/x-www-form-urlencoded"
      );
      assert.equal(request.params.get("grant_type"), "authorization_code");
      assert.equal(request.params.get("code"), exchangeParams.code);
      assert.equal(request.params.get("code_verifier"), "verifier-value");
      assert.equal(request.params.get("client_id"), exchangeParams.clientId);
      assert.equal(
        request.params.get("redirect_uri"),
        exchangeParams.redirectUri
      );
      assert.equal(request.params.get("client_secret"), null);
    } finally {
      await fake.close();
    }
  });

  it("sends the configured client secret for Web application clients", async () => {
    const fake = await startFakeOAuth(
      onTokenPath(() => ({
        status: 200,
        body: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 1800,
          scope: "https://www.googleapis.com/auth/drive.file",
        },
      }))
    );

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);
      await client.exchangeAuthorizationCode({
        ...exchangeParams,
        clientSecret: "GOCSPX-example-secret",
      });

      const [request] = fake.requests;
      assert.equal(
        request.params.get("client_secret"),
        "GOCSPX-example-secret"
      );
      // PKCE stays in place alongside the secret.
      assert.equal(
        request.params.get("code_verifier"),
        exchangeParams.codeVerifier
      );
    } finally {
      await fake.close();
    }
  });

  it("ignores a blank client secret", async () => {
    const fake = await startFakeOAuth(
      onTokenPath(() => ({
        status: 200,
        body: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      }))
    );

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);
      await client.exchangeAuthorizationCode({
        ...exchangeParams,
        clientSecret: "   ",
      });

      assert.equal(fake.requests[0].params.get("client_secret"), null);
    } finally {
      await fake.close();
    }
  });

  it("names a client Google refuses and keeps its description", async () => {
    const fake = await startFakeOAuth(
      onTokenPath(() => ({
        status: 401,
        body: {
          error: "invalid_client",
          error_description: "Unauthorized",
        },
      }))
    );

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);

      await assert.rejects(
        client.exchangeAuthorizationCode(exchangeParams),
        (error: unknown) => {
          assert.equal(markerOf(error), "google_drive_oauth_invalid_client");
          assert.match((error as Error).message, /Unauthorized/);
          return true;
        }
      );
    } finally {
      await fake.close();
    }
  });

  it("names a rejected authorization code", async () => {
    const fake = await startFakeOAuth(
      onTokenPath(() => ({
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "Bad Request",
        },
      }))
    );

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);

      await assert.rejects(
        client.exchangeAuthorizationCode(exchangeParams),
        (error: unknown) =>
          markerOf(error) === "google_drive_oauth_invalid_grant"
      );
    } finally {
      await fake.close();
    }
  });

  it("names a Google outage separately from the client's own mistakes", async () => {
    const fake = await startFakeOAuth(
      onTokenPath(() => ({ status: 503, body: {} }))
    );

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);

      await assert.rejects(
        client.exchangeAuthorizationCode(exchangeParams),
        (error: unknown) =>
          markerOf(error) === "google_drive_oauth_server_error"
      );
    } finally {
      await fake.close();
    }
  });

  it("names an unreachable Google endpoint", async () => {
    const client = new GoogleDriveOAuthClient({
      tokenUrl: "http://127.0.0.1:9/token",
      userinfoUrl: "http://127.0.0.1:9/userinfo",
    });

    await assert.rejects(
      client.exchangeAuthorizationCode(exchangeParams),
      (error: unknown) => markerOf(error) === "google_drive_oauth_network_error"
    );
  });

  it("rejects a success response without the tokens the app needs", async () => {
    const fake = await startFakeOAuth(
      onTokenPath(() => ({
        status: 200,
        body: { access_token: "access-token" },
      }))
    );

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);

      await assert.rejects(
        client.exchangeAuthorizationCode(exchangeParams),
        (error: unknown) => markerOf(error) === "google_drive_oauth_failed"
      );
    } finally {
      await fake.close();
    }
  });

  it("reads the connected account from the userinfo endpoint", async () => {
    const fake = await startFakeOAuth((request) => {
      if (request.path !== "/userinfo") return { status: 404, body: {} };
      return {
        status: 200,
        body: {
          email: "player@example.com",
          name: "Player One",
          picture: "https://example.com/avatar.png",
        },
      };
    });

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);
      const account = await client.fetchAccount("access-token");

      assert.equal(account.email, "player@example.com");
      assert.equal(account.displayName, "Player One");
      assert.equal(account.photoUrl, "https://example.com/avatar.png");
      assert.ok(!Number.isNaN(Date.parse(account.connectedAt)));
      assert.equal(
        fake.requests[0].headers.authorization,
        "Bearer access-token"
      );
    } finally {
      await fake.close();
    }
  });

  it("falls back to the email when Google has no display name", async () => {
    const fake = await startFakeOAuth(() => ({
      status: 200,
      body: { email: "player@example.com" },
    }));

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);
      const account = await client.fetchAccount("access-token");

      assert.equal(account.displayName, "player@example.com");
      assert.equal(account.photoUrl, null);
    } finally {
      await fake.close();
    }
  });

  it("names a failed profile lookup", async () => {
    const fake = await startFakeOAuth(() => ({
      status: 403,
      body: { error: "forbidden" },
    }));

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);

      await assert.rejects(
        client.fetchAccount("access-token"),
        (error: unknown) =>
          markerOf(error) === "google_drive_account_lookup_failed"
      );
    } finally {
      await fake.close();
    }
  });

  it("refuses a profile without an email", async () => {
    const fake = await startFakeOAuth(() => ({ status: 200, body: {} }));

    try {
      const client = new GoogleDriveOAuthClient(fake.endpoints);

      await assert.rejects(
        client.fetchAccount("access-token"),
        (error: unknown) =>
          markerOf(error) === "google_drive_account_lookup_failed"
      );
    } finally {
      await fake.close();
    }
  });
});
