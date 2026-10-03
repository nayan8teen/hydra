import { GoogleDriveService } from "@main/services";

import { registerEvent } from "../register-event";

registerEvent("cancelGoogleDriveConnect", () =>
  GoogleDriveService.cancelConnect()
);
