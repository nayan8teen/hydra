import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GoogleDriveConnectionStatus, GoogleDriveSettings } from "@types";

import { getGoogleDriveIntegrationPresentation } from "./settings-google-drive-state.js";

const settings: GoogleDriveSettings = {
  clientId: "123456789012-abcdefghijklmnop.apps.googleusercontent.com",
  clientSecret: null,
  driveSyncEnabled: false,
  backgroundSweepEnabled: false,
  backgroundSweepIntervalMinutes: 30,
};

const status = (
  overrides: Partial<GoogleDriveConnectionStatus> = {}
): GoogleDriveConnectionStatus => ({
  state: "disconnected",
  account: null,
  settings,
  connectError: null,
  ...overrides,
});

describe("google drive integration presentation", () => {
  it("starts in loading until the status arrives", () => {
    const presentation = getGoogleDriveIntegrationPresentation({
      status: null,
      isConnecting: false,
      hasConnectFailed: false,
    });

    assert.equal(presentation.viewState, "loading");
    assert.equal(presentation.statusTone, "neutral");
  });

  it("reports a connected account with success tone", () => {
    const presentation = getGoogleDriveIntegrationPresentation({
      status: status({
        state: "connected",
        account: {
          email: "play@example.com",
          displayName: "Player",
          photoUrl: null,
          connectedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      isConnecting: false,
      hasConnectFailed: false,
    });

    assert.equal(presentation.viewState, "connected");
    assert.equal(presentation.statusKey, "google_drive_status_connected");
    assert.equal(presentation.statusTone, "success");
  });

  it("keeps a pending authorization visible over every other state", () => {
    const presentation = getGoogleDriveIntegrationPresentation({
      status: status(),
      isConnecting: true,
      hasConnectFailed: true,
    });

    assert.equal(presentation.viewState, "connecting");
    assert.equal(presentation.statusKey, "google_drive_status_connecting");
  });

  it("asks for a reconnect when the stored session expired", () => {
    const presentation = getGoogleDriveIntegrationPresentation({
      status: status({ state: "needs-reauth" }),
      isConnecting: false,
      hasConnectFailed: false,
    });

    assert.equal(presentation.viewState, "needs-reauth");
    assert.equal(presentation.statusKey, "steam_status_reconnect_required");
    assert.equal(presentation.statusTone, "warning");
  });

  it("distinguishes a failed attempt from a missing client id", () => {
    const failed = getGoogleDriveIntegrationPresentation({
      status: status(),
      isConnecting: false,
      hasConnectFailed: true,
    });
    assert.equal(failed.viewState, "failed");
    assert.equal(failed.statusKey, "google_drive_status_connect_failed");
    assert.equal(failed.statusTone, "warning");

    const unconfigured = getGoogleDriveIntegrationPresentation({
      status: status({ settings: { ...settings, clientId: null } }),
      isConnecting: false,
      hasConnectFailed: false,
    });
    assert.equal(unconfigured.viewState, "not-configured");
    assert.equal(unconfigured.statusKey, "integration_status_not_connected");
  });

  it("reports a recorded failure as a failed connection", () => {
    const failed = getGoogleDriveIntegrationPresentation({
      status: status({
        connectError: {
          marker: "google_drive_oauth_invalid_client",
          detail: "The OAuth client was not found.",
          clientId: settings.clientId,
          at: "2026-01-01T00:00:00.000Z",
        },
      }),
      isConnecting: false,
      hasConnectFailed: true,
    });

    assert.equal(failed.viewState, "failed");
    assert.equal(failed.statusKey, "google_drive_status_connect_failed");
  });
});
