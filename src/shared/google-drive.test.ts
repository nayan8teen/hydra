import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GOOGLE_DRIVE_CONNECT_CANCELLED_KEY,
  GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY,
  getGoogleDriveConnectErrorTranslationKey,
  getGoogleDriveConnectFailure,
  getGoogleDriveConnectFailureFromStatus,
  getGoogleDriveErrorDetail,
  getGoogleDriveErrorMarker,
  isValidGoogleDriveClientId,
  isValidGoogleDriveClientSecret,
} from "./google-drive.js";

describe("google drive client id validation", () => {
  it("accepts desktop OAuth client ids, trimmed", () => {
    assert.equal(
      isValidGoogleDriveClientId(
        "123456789012-abcdefghijklmnop.apps.googleusercontent.com"
      ),
      true
    );
    assert.equal(
      isValidGoogleDriveClientId(
        "  123456789012-abcdefghijklmnop.apps.googleusercontent.com  "
      ),
      true
    );
  });

  it("rejects anything that is not a client id", () => {
    const rejected: unknown[] = [
      "",
      "client-id",
      "123456789012-abcdefghijklmnop.apps.googleusercontent.com/extra",
      "https://console.cloud.google.com/apis/credentials",
      "123456789012-abcdefghijklmnop.apps.googleusercontent.co",
      42,
      null,
      undefined,
    ];

    for (const candidate of rejected) {
      assert.equal(isValidGoogleDriveClientId(candidate), false);
    }
  });
});

describe("google drive client secret validation", () => {
  it("accepts Google-style secrets, trimmed", () => {
    assert.equal(
      isValidGoogleDriveClientSecret("GOCSPX-abcdefghijklmnopqrstuv"),
      true
    );
    assert.equal(
      isValidGoogleDriveClientSecret("  GOCSPX-abcdefghijklmnopqrstuv  "),
      true
    );
  });

  it("rejects empty, short, spaced or oversized values", () => {
    const rejected: unknown[] = [
      "",
      "     ",
      "short",
      "spaced out secret",
      "a".repeat(513),
      42,
      null,
      undefined,
    ];

    for (const candidate of rejected) {
      assert.equal(isValidGoogleDriveClientSecret(candidate), false);
    }
  });

  it("accepts values up to the maximum length", () => {
    assert.equal(isValidGoogleDriveClientSecret("a".repeat(512)), true);
  });
});

describe("google drive connect failure", () => {
  it("names the cause Google reported, not a generic failure", () => {
    // This is the shape Electron rejects the renderer promise with.
    const failure = getGoogleDriveConnectFailure(
      new Error(
        "Error invoking remote method 'connectGoogleDrive': Error: google_drive_oauth_invalid_client: The OAuth client was not found."
      )
    );

    assert.equal(
      failure.messageKey,
      "google_drive_connect_error_invalid_client"
    );
    assert.equal(failure.detail, "The OAuth client was not found.");
    assert.equal(failure.isCancelled, false);
  });

  it("keeps a cancelled authorization separate from a failure", () => {
    const failure = getGoogleDriveConnectFailure(
      new Error("Google Drive authorization was cancelled")
    );

    assert.equal(failure.messageKey, GOOGLE_DRIVE_CONNECT_CANCELLED_KEY);
    assert.equal(failure.isCancelled, true);
    assert.equal(failure.detail, "");
  });

  it("falls back to the generic message for an unmarked failure", () => {
    assert.equal(
      getGoogleDriveConnectFailure(new Error("socket hang up")).messageKey,
      GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY
    );
    assert.equal(
      getGoogleDriveConnectFailure(undefined).messageKey,
      GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY
    );
  });

  it("reuses the failure the main process recorded", () => {
    assert.equal(getGoogleDriveConnectFailureFromStatus(null), null);
    assert.deepEqual(
      getGoogleDriveConnectFailureFromStatus({
        marker: "google_drive_oauth_timeout",
        detail: "no browser response within 300s",
      }),
      {
        messageKey: "google_drive_connect_error_timeout",
        detail: "no browser response within 300s",
        isCancelled: false,
      }
    );
  });

  it("gives every marker the main process can emit its own copy", () => {
    const markers = [
      "google_drive_oauth_invalid_client",
      "google_drive_oauth_redirect_mismatch",
      "google_drive_oauth_invalid_grant",
      "google_drive_oauth_access_denied",
      "google_drive_oauth_network_error",
      "google_drive_oauth_server_error",
      "google_drive_oauth_state_mismatch",
      "google_drive_oauth_code_missing",
      "google_drive_oauth_timeout",
      "google_drive_oauth_listener_failed",
      "google_drive_oauth_session_persist_failed",
      "google_drive_account_lookup_failed",
    ] as const;

    for (const marker of markers) {
      assert.notEqual(
        getGoogleDriveConnectErrorTranslationKey(marker),
        GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY,
        `${marker} must not collapse into the generic message`
      );
    }

    assert.equal(
      getGoogleDriveConnectErrorTranslationKey("google_drive_oauth_failed"),
      GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY
    );
    assert.equal(
      getGoogleDriveConnectErrorTranslationKey("google_drive_unknown_marker"),
      GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY
    );
    assert.equal(
      getGoogleDriveConnectErrorTranslationKey(null),
      GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY
    );
  });
});

describe("google drive error details", () => {
  it("reads the marker out of a marked message", () => {
    assert.equal(
      getGoogleDriveErrorMarker(
        new Error("google_drive_oauth_timeout: no browser response within 300s")
      ),
      "google_drive_oauth_timeout"
    );
    assert.equal(getGoogleDriveErrorMarker(new Error("nothing here")), null);
  });

  it("strips the marker and the IPC wrapper from the detail", () => {
    assert.equal(
      getGoogleDriveErrorDetail(
        new Error(
          "Error invoking remote method 'connectGoogleDrive': Error: google_drive_oauth_invalid_client: The OAuth client was not found."
        )
      ),
      "The OAuth client was not found."
    );
  });

  it("passes an unmarked message through untouched", () => {
    assert.equal(
      getGoogleDriveErrorDetail(new Error("plain failure")),
      "plain failure"
    );
    assert.equal(getGoogleDriveErrorDetail(undefined), "");
  });

  it("caps a runaway description", () => {
    const detail = getGoogleDriveErrorDetail(
      new Error(`google_drive_oauth_failed: ${"x".repeat(400)}`)
    );

    assert.equal(detail.length, 300);
  });
});
