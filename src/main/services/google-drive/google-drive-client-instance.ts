import { GoogleDriveAuth } from "./google-drive-auth.js";
import { GoogleDriveClient } from "./google-drive-client.js";

/** App-wide Drive client, authorised by the stored OAuth session. */
export const googleDriveClient = new GoogleDriveClient((options) =>
  GoogleDriveAuth.getAccessToken(options)
);
