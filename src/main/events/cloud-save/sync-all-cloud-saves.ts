import { gamesSublevel } from "@main/level";
import { logger, WindowManager } from "@main/services";
import {
  assertCloudSaveRemoteAccess,
  canRunManualCloudSaveSync,
  isGoogleDriveCloudSaveEnabled,
  runCloudSaveBulkSyncWithDeps,
  syncGameCloudSave,
  type CloudSaveBulkSyncDeps,
} from "@main/services/cloud-save";
import type {
  CloudSaveBulkSyncProgress,
  CloudSaveBulkSyncResult,
} from "@types";

import { registerEvent } from "../register-event";

const BULK_SYNC_PROGRESS_CHANNEL = "on-cloud-save-bulk-sync-progress";

let activeBulkSync: CloudSaveBulkSyncProgress | null = null;

const bulkSyncDeps: CloudSaveBulkSyncDeps = {
  listGames: async () => {
    const entries = await gamesSublevel.iterator().all();

    return entries.map(([, game]) => ({
      objectId: game.objectId,
      shop: game.shop,
      title: game.title,
    }));
  },
  canSync: (objectId, shop) => canRunManualCloudSaveSync(objectId, shop),
  sync: (objectId, shop) => syncGameCloudSave(objectId, shop, "manual"),
  onGameError: (game, error) =>
    logger.error("[Cloud Save] Sync all failed for game", {
      shop: game.shop,
      objectId: game.objectId,
      error: error instanceof Error ? error.message : String(error),
    }),
};

const emitProgress = (progress: CloudSaveBulkSyncProgress) => {
  activeBulkSync = progress.processed >= progress.total ? null : progress;
  WindowManager.sendToAppWindows(BULK_SYNC_PROGRESS_CHANNEL, progress);
};

/** Syncs every installed game one by one; used by the settings "sync all" job. */
const syncAllCloudSaves = async (): Promise<CloudSaveBulkSyncResult> => {
  await assertCloudSaveRemoteAccess(
    (await isGoogleDriveCloudSaveEnabled()) ? "google-drive" : "hydra"
  );

  try {
    return await runCloudSaveBulkSyncWithDeps(bulkSyncDeps, emitProgress);
  } finally {
    activeBulkSync = null;
  }
};

const getActiveCloudSaveBulkSync = async () => activeBulkSync;

registerEvent("syncAllCloudSaves", syncAllCloudSaves);
registerEvent("getActiveCloudSaveBulkSync", getActiveCloudSaveBulkSync);
