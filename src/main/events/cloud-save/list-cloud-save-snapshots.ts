import { listCloudSaveSnapshots } from "@main/services/cloud-save";
import type { CloudSaveHistorySnapshot, GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "listCloudSaveSnapshots",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    listCloudSaveSnapshots(objectId, shop) as Promise<
      CloudSaveHistorySnapshot[]
    >
);
