import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { GoogleDriveManifestInvalidError } from "./google-drive-errors.js";
// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildGoogleDriveManifest,
  parseGoogleDriveManifest,
  toGoogleDriveRestoreManifest,
  toGoogleDriveSnapshotSummary,
} from "./google-drive-manifest.js";

const AGGREGATE_HASH = "a".repeat(64);
const VARIANT_ID = "b".repeat(64);

const variant = { variantId: VARIANT_ID, kind: "default" as const };
const file = {
  variantId: VARIANT_ID,
  rawPath: "<base>/save.dat",
  relativePath: "save.dat",
  hash: "c".repeat(64),
  sizeBytes: 128,
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
};

const buildInput = {
  shop: "steam" as const,
  objectId: "10",
  version: 3,
  previousSnapshotId: "drive-file-1",
  aggregateHash: AGGREGATE_HASH,
  environmentId: "env-1",
  hostname: "host",
  platform: "windows" as const,
  appVersion: "4.1.4",
  customPathRawPaths: [] as string[],
  variants: [variant],
  files: [file],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("Google Drive manifest", () => {
  it("round-trips a built manifest through parse", () => {
    const manifest = buildGoogleDriveManifest(buildInput);
    const parsed = parseGoogleDriveManifest(
      JSON.parse(JSON.stringify(manifest))
    );
    assert.deepEqual(parsed, manifest);
  });

  it("sorts custom path raw paths when building", () => {
    const manifest = buildGoogleDriveManifest({
      ...buildInput,
      customPathRawPaths: ["<custom>/b", "<custom>/a"],
    });
    assert.deepEqual(manifest.customPathRawPaths, ["<custom>/a", "<custom>/b"]);
  });

  it("rejects unknown, missing and tampered fields", () => {
    const manifest = buildGoogleDriveManifest(buildInput);

    assert.throws(
      () => parseGoogleDriveManifest({ ...manifest, extra: true }),
      GoogleDriveManifestInvalidError
    );
    assert.throws(
      () => parseGoogleDriveManifest({ ...manifest, aggregateHash: "nope" }),
      GoogleDriveManifestInvalidError
    );
    assert.throws(
      () => parseGoogleDriveManifest({ ...manifest, version: 0 }),
      GoogleDriveManifestInvalidError
    );
    assert.throws(
      () => parseGoogleDriveManifest({ ...manifest, files: [] }),
      GoogleDriveManifestInvalidError
    );

    const { provider, ...withoutProvider } = manifest;
    assert.throws(
      () => parseGoogleDriveManifest(withoutProvider),
      GoogleDriveManifestInvalidError
    );
    assert.equal(provider, "google-drive");
  });

  it("validates custom paths against the files they cover", () => {
    const customFile = {
      ...file,
      rawPath: "<custom>/saves",
      relativePath: "saves/save.dat",
    };

    assert.throws(
      () =>
        parseGoogleDriveManifest(
          buildGoogleDriveManifest({
            ...buildInput,
            customPathRawPaths: [],
            files: [customFile],
          })
        ),
      GoogleDriveManifestInvalidError
    );

    assert.doesNotThrow(() =>
      parseGoogleDriveManifest(
        buildGoogleDriveManifest({
          ...buildInput,
          customPathRawPaths: ["<custom>/saves"],
          files: [customFile],
        })
      )
    );
  });

  it("maps manifests to engine snapshot shapes", () => {
    const manifest = buildGoogleDriveManifest(buildInput);
    const ref = {
      fileId: "drive-manifest-id",
      etag: "etag-1",
      modifiedTime: "2026-01-02T00:00:00.000Z",
      manifest,
    };

    assert.deepEqual(toGoogleDriveSnapshotSummary(ref), {
      id: "drive-manifest-id",
      version: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      fileCount: 1,
      totalSizeBytes: 128,
      aggregateHash: AGGREGATE_HASH,
      provider: "google-drive",
    });

    assert.deepEqual(toGoogleDriveRestoreManifest(ref), {
      snapshot: {
        id: "drive-manifest-id",
        version: 3,
        shop: "steam",
        objectId: "10",
      },
      customPathRawPaths: [],
      variants: [variant],
      files: [file],
    });
  });
});
