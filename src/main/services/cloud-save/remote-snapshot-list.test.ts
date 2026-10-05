import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GoogleDriveManifestRef, SnapshotFile } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { buildRemoteSnapshotSummaries } from "./remote-snapshot-list.ts";

const hash = (value: string) => value.repeat(64).slice(0, 64);

const file = (relativePath: string, sizeBytes = 4): SnapshotFile => ({
  variantId: "1".repeat(64),
  rawPath: "<winAppData>/Game",
  relativePath,
  hash: hash("a"),
  sizeBytes,
  lastModifiedAt: "2026-07-22T10:00:00.000Z",
});

const ref = (
  version: number,
  fileId: string,
  files: SnapshotFile[] = [file(`save-${version}.sav`)]
): GoogleDriveManifestRef => ({
  fileId,
  etag: `etag-${version}`,
  modifiedTime: "2026-07-22T10:00:00.000Z",
  manifest: {
    schemaVersion: 1,
    provider: "google-drive",
    shop: "steam",
    objectId: "1",
    version,
    previousSnapshotId: null,
    aggregateHash: hash("b"),
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    environmentId: "environment",
    hostname: "host",
    platform: "windows",
    appVersion: "1.0.0",
    customPathRawPaths: [],
    variants: [],
    files,
  },
});

describe("buildRemoteSnapshotSummaries", () => {
  it("lists the head and history newest-first without duplicates", () => {
    const summaries = buildRemoteSnapshotSummaries(ref(3, "head"), [
      ref(2, "h2"),
      ref(1, "h1"),
      ref(3, "h3-duplicate"),
    ]);

    assert.deepEqual(
      summaries.map((summary) => [summary.version, summary.id]),
      [
        [3, "head"],
        [2, "h2"],
        [1, "h1"],
      ]
    );
  });

  it("still lists history snapshots when the head manifest is missing", () => {
    const summaries = buildRemoteSnapshotSummaries(null, [
      ref(2, "h2"),
      ref(1, "h1", []),
    ]);

    assert.deepEqual(
      summaries.map((summary) => summary.id),
      ["h2", "h1"]
    );
    assert.equal(summaries[1]?.fileCount, 0);
    assert.equal(summaries[0]?.provider, "google-drive");
  });

  it("returns an empty list when the game has no manifests at all", () => {
    assert.deepEqual(buildRemoteSnapshotSummaries(null, []), []);
  });
});
