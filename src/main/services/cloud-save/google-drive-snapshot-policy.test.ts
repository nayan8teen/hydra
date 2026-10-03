import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SnapshotFile, SnapshotVariant } from "@types";

import {
  planGoogleDriveSnapshotWrite,
  verifyGoogleDriveSnapshotCommit,
} from "./google-drive-snapshot-policy.js";
import type { GoogleDriveStorageManifest } from "@types";

const variant: SnapshotVariant = { variantId: "default", kind: "default" };
const file: SnapshotFile = {
  variantId: "default",
  rawPath: "save.dat",
  relativePath: "save.dat",
  hash: "a".repeat(64),
  sizeBytes: 128,
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
};

const manifest: GoogleDriveStorageManifest = {
  schemaVersion: 1,
  provider: "google-drive",
  shop: "steam",
  objectId: "1",
  version: 3,
  previousSnapshotId: "file-2",
  aggregateHash: "b".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "environment",
  hostname: "host",
  platform: "windows",
  appVersion: "4.1.4",
  customPathRawPaths: ["<custom>/a"],
  variants: [variant],
  files: [file],
};

describe("google drive snapshot write plan", () => {
  it("writes the first snapshot with no predecessor", () => {
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({ head: null, baseVersion: 0 }),
      {
        kind: "write",
        version: 1,
        previousManifestFileId: null,
        previousEtag: null,
        previousSnapshotId: null,
      }
    );
  });

  it("advances the head manifest and carries its etag for If-Match", () => {
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: { fileId: "file-3", etag: "etag-3", version: 3 },
        baseVersion: 3,
        expectedSnapshotId: "file-3",
      }),
      {
        kind: "write",
        version: 4,
        previousManifestFileId: "file-3",
        previousEtag: "etag-3",
        previousSnapshotId: "file-3",
      }
    );
  });

  it("conflicts when another device replaced or advanced the snapshot", () => {
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: { fileId: "file-9", etag: "etag-9", version: 9 },
        baseVersion: 3,
        expectedSnapshotId: "file-3",
      }),
      { kind: "conflict", reason: "snapshot-changed" }
    );
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: { fileId: "file-3", etag: "etag-4", version: 4 },
        baseVersion: 3,
        expectedSnapshotId: "file-3",
      }),
      { kind: "conflict", reason: "version-changed" }
    );
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({ head: null, baseVersion: 3 }),
      { kind: "conflict", reason: "version-changed" }
    );
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: { fileId: "file-3", etag: "etag-3", version: 3 },
        baseVersion: 3,
        expectedSnapshotId: "file-other",
      }),
      { kind: "conflict", reason: "snapshot-changed" }
    );
  });
});

describe("google drive snapshot commit verification", () => {
  const expected = {
    version: manifest.version,
    aggregateHash: manifest.aggregateHash,
    customPathRawPaths: ["<custom>/a"],
    variants: [variant],
    files: [file],
  };

  it("accepts a manifest that matches the proposal", () => {
    assert.equal(
      verifyGoogleDriveSnapshotCommit({ manifest, ...expected }),
      true
    );
  });

  it("rejects a manifest that drifted from the proposal", () => {
    assert.equal(
      verifyGoogleDriveSnapshotCommit({
        manifest,
        ...expected,
        version: manifest.version + 1,
      }),
      false
    );
    assert.equal(
      verifyGoogleDriveSnapshotCommit({
        manifest,
        ...expected,
        files: [{ ...file, hash: "c".repeat(64) }],
      }),
      false
    );
    assert.equal(
      verifyGoogleDriveSnapshotCommit({
        manifest,
        ...expected,
        files: [{ ...file, sizeBytes: 256 }],
      }),
      false
    );
    assert.equal(
      verifyGoogleDriveSnapshotCommit({
        manifest,
        ...expected,
        variants: [],
      }),
      false
    );
    assert.equal(
      verifyGoogleDriveSnapshotCommit({
        manifest,
        ...expected,
        customPathRawPaths: [],
      }),
      false
    );
    assert.equal(
      verifyGoogleDriveSnapshotCommit({
        manifest,
        ...expected,
        aggregateHash: "d".repeat(64),
      }),
      false
    );
  });
});
