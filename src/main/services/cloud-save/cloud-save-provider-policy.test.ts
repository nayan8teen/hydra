import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCloudSaveAnchorIdentity,
  getCloudSaveProviderForSnapshot,
  normalizeCloudSaveProvider,
  shouldUseGoogleDriveCloudSave,
} from "./cloud-save-provider-policy.js";

describe("cloud save remote provider policy", () => {
  it("treats providers from older builds as Hydra", () => {
    assert.equal(normalizeCloudSaveProvider(undefined), "hydra");
    assert.equal(normalizeCloudSaveProvider(null), "hydra");
    assert.equal(normalizeCloudSaveProvider("hydra"), "hydra");
    assert.equal(normalizeCloudSaveProvider("google-drive"), "google-drive");
    assert.equal(getCloudSaveProviderForSnapshot({}), "hydra");
    assert.equal(
      getCloudSaveProviderForSnapshot({ provider: "google-drive" }),
      "google-drive"
    );
  });

  it("only selects Drive when the toggle is on and an account is connected", () => {
    assert.equal(
      shouldUseGoogleDriveCloudSave({
        driveSyncEnabled: true,
        driveConnected: true,
      }),
      true
    );
    assert.equal(
      shouldUseGoogleDriveCloudSave({
        driveSyncEnabled: false,
        driveConnected: true,
      }),
      false
    );
    assert.equal(
      shouldUseGoogleDriveCloudSave({
        driveSyncEnabled: true,
        driveConnected: false,
      }),
      false
    );
  });

  it("scopes anchors to the account that owns the remote state", () => {
    assert.equal(
      getCloudSaveAnchorIdentity({
        provider: "hydra",
        hydraUserId: "user-1",
        driveAccountEmail: "play@example.com",
      }),
      "user-1"
    );
    assert.equal(
      getCloudSaveAnchorIdentity({
        provider: "google-drive",
        hydraUserId: "user-1",
        driveAccountEmail: "play@example.com",
      }),
      "google-drive:play@example.com"
    );
    assert.notEqual(
      getCloudSaveAnchorIdentity({
        provider: "google-drive",
        hydraUserId: "user-1",
        driveAccountEmail: "play@example.com",
      }),
      getCloudSaveAnchorIdentity({
        provider: "google-drive",
        hydraUserId: "user-1",
        driveAccountEmail: "other@example.com",
      })
    );
    assert.equal(
      getCloudSaveAnchorIdentity({
        provider: "google-drive",
        hydraUserId: "user-1",
      }),
      "google-drive:unknown-account"
    );
  });
});
