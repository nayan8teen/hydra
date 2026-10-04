import {
  assertCloudSaveDriveConnected,
  getPendingCloudSaveCustomPathApproval,
} from "@main/services/cloud-save";
import type { CloudSaveCustomPathApproval, GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getPendingCloudSaveCustomPathApproval",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ): Promise<CloudSaveCustomPathApproval | null> => {
    await assertCloudSaveDriveConnected();
    return getPendingCloudSaveCustomPathApproval(shop, objectId);
  }
);
