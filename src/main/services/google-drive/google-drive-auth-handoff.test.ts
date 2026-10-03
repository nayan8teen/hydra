import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { describe, it } from "node:test";

import { startGoogleDriveAuthorizationRedirect } from "./google-drive-authorized-redirect.js";
import { GOOGLE_DRIVE_CALLBACK_PATH } from "./google-drive-constants.js";
import { GoogleDriveOAuthClient } from "./google-drive-oauth-client.js";
import { createGoogleDrivePkcePair } from "./google-drive-pkce.js";

const CLIENT_ID = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";

const base64Url = (value: Buffer) =>
  value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

interface FakeGoogle {
  tokenUrl: string;
  userinfoUrl: string;
  requests: { path: string; params: URLSearchParams }[];
  close: () => Promise<void>;
}

const readBody = (request: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });

/** Stands in for Google: the token endpoint and the userinfo endpoint. */
const startFakeGoogle = async (): Promise<FakeGoogle> => {
  const requests: { path: string; params: URLSearchParams }[] = [];
  let origin = "";

  const server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const url = new URL(request.url ?? "/", origin);
      requests.push({
        path: url.pathname,
        params: new URLSearchParams(body.toString("utf8")),
      });

      const json = (status: number, payload: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      if (url.pathname === "/token") {
        json(200, {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/drive.file",
        });
        return;
      }

      if (url.pathname === "/userinfo") {
        json(200, { email: "player@example.com", name: "Player One" });
        return;
      }

      json(404, { error: "not_found" });
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
    tokenUrl: `${origin}/token`,
    userinfoUrl: `${origin}/userinfo`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

describe("google drive authorization hand-off", () => {
  it("turns a browser consent into a connected account", async () => {
    const google = await startFakeGoogle();

    try {
      const state = "state-value";
      const pkce = createGoogleDrivePkcePair();

      // What the app sends Google as the challenge must be the S256 hash of the
      // verifier it later sends with the code.
      assert.equal(
        pkce.challenge,
        base64Url(createHash("sha256").update(pkce.verifier).digest())
      );

      const redirect = await startGoogleDriveAuthorizationRedirect({
        expectedState: state,
        timeoutMs: 10_000,
      });
      const redirectUri = `http://127.0.0.1:${redirect.port}${GOOGLE_DRIVE_CALLBACK_PATH}`;

      // The browser lands on the loopback callback with Google's code.
      const callback = await fetch(
        `${redirectUri}?code=4%2F0Abrowser-code&state=${state}`
      );
      assert.equal(callback.status, 200);
      assert.match(await callback.text(), /Google Drive connected/);

      const code = await redirect.code;
      const client = new GoogleDriveOAuthClient({
        tokenUrl: google.tokenUrl,
        userinfoUrl: google.userinfoUrl,
      });
      const tokens = await client.exchangeAuthorizationCode({
        clientId: CLIENT_ID,
        code,
        codeVerifier: pkce.verifier,
        redirectUri,
      });
      const account = await client.fetchAccount(tokens.accessToken);

      assert.equal(account.email, "player@example.com");
      assert.equal(account.displayName, "Player One");
      assert.equal(tokens.refreshToken, "refresh-token");

      const exchange = google.requests.find(
        (request) => request.path === "/token"
      );
      assert.ok(exchange, "the code must be exchanged at the token endpoint");
      assert.equal(exchange.params.get("code"), code);
      assert.equal(exchange.params.get("code_verifier"), pkce.verifier);
      assert.equal(exchange.params.get("redirect_uri"), redirectUri);
      assert.equal(exchange.params.get("client_id"), CLIENT_ID);
    } finally {
      await google.close();
    }
  });

  it("never exchanges a code the browser did not return", async () => {
    const google = await startFakeGoogle();

    try {
      const redirect = await startGoogleDriveAuthorizationRedirect({
        expectedState: "state-value",
        timeoutMs: 10_000,
      });

      await fetch(
        `http://127.0.0.1:${redirect.port}${GOOGLE_DRIVE_CALLBACK_PATH}?code=stolen&state=wrong-state`
      );

      await assert.rejects(redirect.code, (error: unknown) =>
        /state did not match/.test(
          error instanceof Error ? error.message : String(error)
        )
      );
      assert.equal(google.requests.length, 0);
    } finally {
      await google.close();
    }
  });
});
