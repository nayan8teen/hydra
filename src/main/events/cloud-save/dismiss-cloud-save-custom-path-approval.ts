import {
  assertCloudSaveDriveConnected,
  dismissPendingCloudSaveCustomPathApproval,
} from "@main/services/cloud-save";

import { registerEvent } from "../register-event";

registerEvent(
  "dismissCloudSaveCustomPathApproval",
  async (
    _event: Electron.IpcMainInvokeEvent,
    approvalId: string
  ): Promise<void> => {
    await assertCloudSaveDriveConnected();
    dismissPendingCloudSaveCustomPathApproval(approvalId);
  }
);
