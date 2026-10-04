import { GoogleDriveNotConnectedError } from "../google-drive";
import { isGoogleDriveCloudSaveEnabled } from "./remote-backend.js";

/**
 * Fork: cloud saves require a connected Google Drive account, not a Hydra
 * Cloud subscription. Every caller that used to assert a subscription now
 * asserts the Drive connection instead.
 */
export const canAccessCloudSavesNow = () => isGoogleDriveCloudSaveEnabled();

export const assertCloudSaveDriveConnected = async () => {
  if (!(await isGoogleDriveCloudSaveEnabled())) {
    throw new GoogleDriveNotConnectedError(
      "Google Drive save sync is not enabled or not connected"
    );
  }
};
