import { GoogleDriveService } from "@main/services";

import { registerEvent } from "../register-event";

registerEvent(
  "connectGoogleDrive",
  (_event: Electron.IpcMainInvokeEvent, clientId?: string) =>
    GoogleDriveService.connect(clientId)
);
