import { GoogleDriveService } from "@main/services";

import { registerEvent } from "../register-event";

registerEvent(
  "disconnectGoogleDrive",
  (
    _event: Electron.IpcMainInvokeEvent,
    options?: { deleteRemoteData?: boolean }
  ) => GoogleDriveService.disconnect(options)
);
