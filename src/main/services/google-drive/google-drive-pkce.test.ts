import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  base64UrlEncode,
  createGoogleDriveOAuthState,
  createGoogleDrivePkcePair,
  isMatchingGoogleDriveOAuthState,
} from "./google-drive-pkce.js";

describe("Google Drive PKCE", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = createGoogleDrivePkcePair();

    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(
      challenge,
      base64UrlEncode(createHash("sha256").update(verifier).digest())
    );
    assert.notEqual(verifier, createGoogleDrivePkcePair().verifier);
  });

  it("generates unique states and compares them safely", () => {
    const state = createGoogleDriveOAuthState();

    assert.notEqual(state, createGoogleDriveOAuthState());
    assert.equal(isMatchingGoogleDriveOAuthState(state, state), true);
    assert.equal(isMatchingGoogleDriveOAuthState(state, null), false);
    assert.equal(isMatchingGoogleDriveOAuthState(state, `${state}x`), false);
    assert.equal(
      isMatchingGoogleDriveOAuthState(state, state.slice(0, -1)),
      false
    );
  });
});
