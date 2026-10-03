import { GoogleDriveService } from "@main/services";
import type { GoogleDriveSettings } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "setGoogleDriveSettings",
  (_event: Electron.IpcMainInvokeEvent, patch: Partial<GoogleDriveSettings>) =>
    GoogleDriveService.updateSettings(patch)
);
