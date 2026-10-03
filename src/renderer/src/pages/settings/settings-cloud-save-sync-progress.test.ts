import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CloudSaveBulkSyncProgress } from "@types";

import { getCloudSaveSyncAllPresentation } from "./settings-cloud-save-sync-progress.js";

const progress = (
  patch: Partial<CloudSaveBulkSyncProgress>
): CloudSaveBulkSyncProgress => ({
  processed: 0,
  total: 0,
  synced: 0,
  skipped: 0,
  failed: 0,
  conflicts: 0,
  currentLabel: null,
  ...patch,
});

describe("cloud save sync all presentation", () => {
  it("stays hidden until the job runs", () => {
    const presentation = getCloudSaveSyncAllPresentation(null, false);

    assert.equal(presentation.isVisible, false);
    assert.equal(presentation.percent, null);
  });

  it("renders an indeterminate bar while the total is unknown", () => {
    const presentation = getCloudSaveSyncAllPresentation(
      progress({ currentLabel: "Alpha" }),
      true
    );

    assert.equal(presentation.isVisible, true);
    assert.equal(presentation.percent, null);
    assert.equal(presentation.currentLabel, "Alpha");
  });

  it("reports the completed share of the sweep", () => {
    const presentation = getCloudSaveSyncAllPresentation(
      progress({ processed: 3, total: 6, currentLabel: "Delta" }),
      true
    );

    assert.equal(presentation.percent, 50);
    assert.equal(presentation.processed, 3);
    assert.equal(presentation.total, 6);
    assert.equal(presentation.currentLabel, "Delta");
  });
});
