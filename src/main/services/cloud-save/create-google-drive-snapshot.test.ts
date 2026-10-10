import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planGoogleDriveSnapshotWrite } from "./google-drive-snapshot-policy.js";

describe("Drive manifest conflict retry", () => {
  // When the Drive head changes between the analysis read and the commit
  // (fileId or version differs from what the engine analyzed), the plan
  // reports a conflict. The commit path re-reads the head and re-plans, so
  // a transient conflict resolves itself on retry as long as the head
  // stabilizes before the max retry count is exhausted.

  it("conflicts when the snapshot file id changed since analysis", () => {
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: { fileId: "file-new", etag: "etag-new", version: 5 },
        baseVersion: 4,
        expectedSnapshotId: "file-old",
      }),
      { kind: "conflict", reason: "snapshot-changed" }
    );
  });

  it("conflicts when the snapshot version advanced since analysis", () => {
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: { fileId: "file-3", etag: "etag-3", version: 5 },
        baseVersion: 4,
        expectedSnapshotId: "file-3",
      }),
      { kind: "conflict", reason: "version-changed" }
    );
  });

  it("writes when a re-read sees the same head the analysis saw", () => {
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: { fileId: "file-3", etag: "etag-3", version: 4 },
        baseVersion: 4,
        expectedSnapshotId: "file-3",
      }),
      {
        kind: "write",
        version: 5,
        previousManifestFileId: "file-3",
        previousEtag: "etag-3",
        previousSnapshotId: "file-3",
      }
    );
  });

  it("writes when a re-read sees a new head that matches the expected id and base version", () => {
    // After a concurrent write advanced the snapshot, a retry re-reads the
    // new head. If the engine's base version was already current at analysis
    // time the plan still conflicts, but when the analysis itself was stale
    // (base version one behind) a fresh re-read produces a write plan whose
    // version carries forward from the new head.
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: { fileId: "file-4", etag: "etag-4", version: 4 },
        baseVersion: 4,
        expectedSnapshotId: "file-4",
      }),
      {
        kind: "write",
        version: 5,
        previousManifestFileId: "file-4",
        previousEtag: "etag-4",
        previousSnapshotId: "file-4",
      }
    );
  });

  it("recreates the head when only a history snapshot remains", () => {
    // A game whose head manifest is missing but whose history survived (the
    // exact condition behind "show cloud snapshots when the head manifest is
    // missing") analyzed a history snapshot as its base. The commit must create
    // a fresh head carrying the version past that history instead of
    // dead-ending in a conflict that no retry can clear.
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({
        head: null,
        baseVersion: 4,
        expectedSnapshotId: "history-file-3",
      }),
      {
        kind: "write",
        version: 5,
        previousManifestFileId: null,
        previousEtag: null,
        previousSnapshotId: "history-file-3",
      }
    );
  });

  it("conflicts when the head is missing and only a version was analyzed", () => {
    assert.deepEqual(
      planGoogleDriveSnapshotWrite({ head: null, baseVersion: 4 }),
      { kind: "conflict", reason: "version-changed" }
    );
  });
});
