import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startGoogleDriveAuthorizationRedirect } from "./google-drive-authorized-redirect.js";
import { GoogleDriveConnectCancelledError } from "./google-drive-errors.js";

const EXPECTED_STATE = "expected-state-value";
const TEST_TIMEOUT_MS = 10_000;
const MARKER_PATTERN = /^google_drive_[a-z0-9_]+/;

const callbackUrl = (port: number, query: string) =>
  `http://127.0.0.1:${port}/oauth2callback?${query}`;

const markerOf = (error: unknown) =>
  MARKER_PATTERN.exec(error instanceof Error ? error.message : "")?.[0] ?? null;

const rejectsWithMarker = (marker: string) => (error: unknown) => {
  assert.equal(
    markerOf(error),
    marker,
    `expected ${marker}, got: ${String(error)}`
  );
  return true;
};

const start = () =>
  startGoogleDriveAuthorizationRedirect({
    expectedState: EXPECTED_STATE,
    timeoutMs: TEST_TIMEOUT_MS,
  });

describe("google drive authorization redirect", () => {
  it("hands the authorization code back from the loopback callback", async () => {
    const redirect = await start();

    const response = await fetch(
      callbackUrl(redirect.port, `code=4%2F0Aabc&state=${EXPECTED_STATE}`)
    );

    assert.equal(response.status, 200);
    assert.match(await response.text(), /Google Drive connected/);
    assert.equal(await redirect.code, "4/0Aabc");
  });

  it("ignores unrelated requests instead of ending the flow", async () => {
    const redirect = await start();
    let settled = false;
    void redirect.code.then(
      () => (settled = true),
      () => (settled = true)
    );

    const favicon = await fetch(
      `http://127.0.0.1:${redirect.port}/favicon.ico`
    );
    assert.equal(favicon.status, 404);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(settled, false);

    redirect.abort();
    await assert.rejects(
      redirect.code,
      (error: unknown) => error instanceof GoogleDriveConnectCancelledError
    );
  });

  it("refuses a callback whose state does not match the request", async () => {
    const redirect = await start();

    const response = await fetch(
      callbackUrl(redirect.port, "code=abc&state=someone-else")
    );

    assert.equal(response.status, 200);
    assert.match(await response.text(), /could not be verified/);
    await assert.rejects(
      redirect.code,
      rejectsWithMarker("google_drive_oauth_state_mismatch")
    );
  });

  it("refuses a callback with no state at all", async () => {
    const redirect = await start();

    await fetch(callbackUrl(redirect.port, "code=abc"));

    await assert.rejects(
      redirect.code,
      rejectsWithMarker("google_drive_oauth_state_mismatch")
    );
  });

  it("surfaces the browser's own denial, with Google's description", async () => {
    const redirect = await start();

    await fetch(
      callbackUrl(
        redirect.port,
        "error=access_denied&error_description=The+user+denied+the+request"
      )
    );

    await assert.rejects(redirect.code, (error: unknown) => {
      assert.equal(markerOf(error), "google_drive_oauth_access_denied");
      assert.match(
        (error as Error).message,
        /The user denied the request/,
        "Google's own description must be kept"
      );
      return true;
    });
  });

  it("refuses a callback without an authorization code", async () => {
    const redirect = await start();

    await fetch(callbackUrl(redirect.port, `state=${EXPECTED_STATE}`));

    await assert.rejects(
      redirect.code,
      rejectsWithMarker("google_drive_oauth_code_missing")
    );
  });

  it("gives up when the browser never comes back", async () => {
    const redirect = await startGoogleDriveAuthorizationRedirect({
      expectedState: EXPECTED_STATE,
      timeoutMs: 50,
    });

    await assert.rejects(
      redirect.code,
      rejectsWithMarker("google_drive_oauth_timeout")
    );
  });

  it("aborts an in-flight authorization only once", async () => {
    const redirect = await start();

    redirect.abort();
    await assert.rejects(
      redirect.code,
      (error: unknown) => error instanceof GoogleDriveConnectCancelledError
    );
    assert.doesNotThrow(() => redirect.abort());
  });
});
