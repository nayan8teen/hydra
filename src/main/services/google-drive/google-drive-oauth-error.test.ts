import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  classifyGoogleDriveOAuthFailure,
  createGoogleDriveOAuthError,
  describeGoogleDriveAccountFailure,
  describeGoogleDriveOAuthFailure,
  getGoogleDriveOAuthErrorCode,
} from "./google-drive-oauth-error.js";

const axiosError = (params: {
  status?: number;
  data?: unknown;
  noResponse?: boolean;
}) => {
  const error = new Error("Request failed") as Error & {
    isAxiosError: boolean;
    response?: unknown;
    request?: unknown;
  };
  error.isAxiosError = true;
  if (params.noResponse) {
    error.request = {};
  } else {
    error.response = { status: params.status, data: params.data };
  }
  return error;
};

describe("google drive oauth failure classification", () => {
  it("reads Google's machine-readable error out of the response body", () => {
    const error = axiosError({
      status: 400,
      data: { error: "invalid_grant", error_description: "Bad Request" },
    });

    assert.equal(getGoogleDriveOAuthErrorCode(error), "invalid_grant");
    assert.equal(
      classifyGoogleDriveOAuthFailure(error),
      "google_drive_oauth_invalid_grant"
    );
    assert.equal(
      describeGoogleDriveOAuthFailure(error),
      "google_drive_oauth_invalid_grant: Bad Request"
    );
  });

  it("treats a client Google cannot authenticate as the wrong kind of client", () => {
    // A Web application client rejects a secret-less exchange like this.
    const webClient = axiosError({
      status: 401,
      data: { error: "invalid_client", error_description: "Unauthorized" },
    });
    assert.equal(
      classifyGoogleDriveOAuthFailure(webClient),
      "google_drive_oauth_invalid_client"
    );

    const missingSecret = axiosError({
      status: 400,
      data: {
        error: "invalid_request",
        error_description: "client_secret is missing.",
      },
    });
    assert.equal(
      classifyGoogleDriveOAuthFailure(missingSecret),
      "google_drive_oauth_invalid_client"
    );

    const statusOnly = axiosError({ status: 401, data: {} });
    assert.equal(
      classifyGoogleDriveOAuthFailure(statusOnly),
      "google_drive_oauth_invalid_client"
    );

    const unauthorizedClient = axiosError({
      status: 400,
      data: { error: "unauthorized_client" },
    });
    assert.equal(
      classifyGoogleDriveOAuthFailure(unauthorizedClient),
      "google_drive_oauth_invalid_client"
    );
  });

  it("separates a rejected redirect, a denial, a Google outage and a dead network", () => {
    assert.equal(
      classifyGoogleDriveOAuthFailure(
        axiosError({
          status: 400,
          data: { error: "redirect_uri_mismatch" },
        })
      ),
      "google_drive_oauth_redirect_mismatch"
    );
    assert.equal(
      classifyGoogleDriveOAuthFailure(
        axiosError({ status: 403, data: { error: "access_denied" } })
      ),
      "google_drive_oauth_access_denied"
    );
    assert.equal(
      classifyGoogleDriveOAuthFailure(axiosError({ status: 503, data: {} })),
      "google_drive_oauth_server_error"
    );
    assert.equal(
      classifyGoogleDriveOAuthFailure(axiosError({ noResponse: true })),
      "google_drive_oauth_network_error"
    );
  });

  it("falls back to the generic marker for an unrecognised failure", () => {
    assert.equal(
      classifyGoogleDriveOAuthFailure(
        axiosError({ status: 418, data: { error: "teapot" } })
      ),
      "google_drive_oauth_failed"
    );
    assert.equal(
      classifyGoogleDriveOAuthFailure(new Error("boom")),
      "google_drive_oauth_failed"
    );
  });

  it("describes an account lookup failure with Google's own words", () => {
    assert.equal(
      describeGoogleDriveAccountFailure(
        axiosError({
          status: 403,
          data: { error: "forbidden", error_description: "Insufficient scope" },
        })
      ),
      "google_drive_account_lookup_failed: Insufficient scope"
    );
    assert.equal(
      describeGoogleDriveAccountFailure(new Error("boom")),
      "google_drive_account_lookup_failed"
    );
  });
});

describe("google drive oauth error creation", () => {
  it("builds marked errors for the failures our own flow detects", () => {
    assert.equal(
      createGoogleDriveOAuthError(
        "google_drive_oauth_timeout",
        "no browser response"
      ).message,
      "google_drive_oauth_timeout: no browser response"
    );
    assert.equal(
      createGoogleDriveOAuthError("google_drive_oauth_timeout").message,
      "google_drive_oauth_timeout"
    );
  });
});
