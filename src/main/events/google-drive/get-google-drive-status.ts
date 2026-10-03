import { GoogleDriveService } from "@main/services";

import { registerEvent } from "../register-event";

registerEvent("getGoogleDriveStatus", () => GoogleDriveService.getStatus());
