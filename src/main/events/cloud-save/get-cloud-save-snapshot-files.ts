import { getCloudSaveSnapshotFiles } from "@main/services/cloud-save";
import type { CloudSaveSnapshotFiles, GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getCloudSaveSnapshotFiles",
  (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    snapshotId: string
  ) =>
    getCloudSaveSnapshotFiles(
      objectId,
      shop,
      snapshotId
    ) as Promise<CloudSaveSnapshotFiles>
);
