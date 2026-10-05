import { restoreCloudSaveSnapshotFiles } from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type {
  CloudSaveSnapshotRestoreResult,
  CloudSaveSyncIpcProgressPayload,
  GameShop,
} from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "restoreCloudSaveSnapshot",
  async (
    event: Electron.IpcMainInvokeEvent,
    operationId: string,
    objectId: string,
    shop: GameShop,
    snapshotId: string,
    entryIds: string[]
  ): Promise<CloudSaveSnapshotRestoreResult> => {
    if (!operationId) {
      throw new Error("Cloud save restore operation ID is required");
    }
    if (isGameRunning(objectId, shop)) {
      throw new Error("Cloud saves cannot be restored while game is running");
    }

    return restoreCloudSaveSnapshotFiles(
      objectId,
      shop,
      snapshotId,
      entryIds,
      (progress) => {
        if (event.sender.isDestroyed()) return;
        const payload: CloudSaveSyncIpcProgressPayload = {
          operationId,
          ...progress,
        };
        event.sender.send("on-cloud-save-sync-progress", payload);
      }
    );
  }
);
