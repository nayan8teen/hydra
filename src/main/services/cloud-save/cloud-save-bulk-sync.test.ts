import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveBulkSyncProgress,
  SyncGameCloudSaveResult,
} from "@types";

import {
  runCloudSaveBulkSyncWithDeps,
  type CloudSaveBulkSyncDeps,
  type CloudSaveBulkSyncGame,
} from "./cloud-save-bulk-sync.js";

const games: CloudSaveBulkSyncGame[] = [
  { objectId: "1", shop: "steam", title: "Alpha" },
  { objectId: "2", shop: "steam", title: "Beta" },
  { objectId: "3", shop: "steam", title: "Gamma" },
];

const result = (
  action: SyncGameCloudSaveResult["action"]
): SyncGameCloudSaveResult => ({
  trigger: "manual",
  action,
  initialState: "local-ahead",
  finalState: action === "conflict" ? "conflict" : "synced",
});

describe("cloud save bulk sync", () => {
  it("syncs every eligible game sequentially and counts outcomes", async () => {
    const callOrder: string[] = [];
    const progress: CloudSaveBulkSyncProgress[] = [];
    const deps: CloudSaveBulkSyncDeps = {
      listGames: async () => games,
      canSync: async (objectId) => objectId !== "3",
      sync: async (objectId) => {
        callOrder.push(objectId);
        return result(objectId === "2" ? "conflict" : "upload");
      },
    };

    const summary = await runCloudSaveBulkSyncWithDeps(deps, (current) =>
      progress.push(current)
    );

    assert.deepEqual(callOrder, ["1", "2"]);
    assert.deepEqual(summary, {
      total: 3,
      synced: 1,
      skipped: 1,
      failed: 0,
      conflicts: 1,
    });
    assert.equal(progress[0].total, 3);
    assert.equal(progress.at(-1)?.processed, 3);
    assert.equal(progress.at(-1)?.currentLabel, "Gamma");
  });

  it("treats a running game as skipped and records other failures", async () => {
    const failedGames: string[] = [];
    const deps: CloudSaveBulkSyncDeps = {
      listGames: async () => games.slice(0, 2),
      canSync: async () => true,
      sync: async (objectId) => {
        if (objectId === "1") throw new Error("cloud_save_game_running");
        throw new Error("boom");
      },
      onGameError: (game) => failedGames.push(game.objectId),
    };

    const summary = await runCloudSaveBulkSyncWithDeps(deps, () => undefined);

    assert.deepEqual(summary, {
      total: 2,
      synced: 0,
      skipped: 1,
      failed: 1,
      conflicts: 0,
    });
    assert.deepEqual(failedGames, ["2"]);
  });

  it("treats an unreadable eligibility check as a skip", async () => {
    const deps: CloudSaveBulkSyncDeps = {
      listGames: async () => games.slice(0, 1),
      canSync: async () => {
        throw new Error("store unavailable");
      },
      sync: async () => result("upload"),
    };

    const summary = await runCloudSaveBulkSyncWithDeps(deps, () => undefined);

    assert.deepEqual(summary, {
      total: 1,
      synced: 0,
      skipped: 1,
      failed: 0,
      conflicts: 0,
    });
  });
});
