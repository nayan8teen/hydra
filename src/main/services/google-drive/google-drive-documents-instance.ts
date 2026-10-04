import { googleDriveClient } from "./google-drive-client-instance.js";
import { GoogleDriveDocuments } from "./google-drive-documents.js";
import { GoogleDriveStorage } from "./google-drive-storage.js";

/** Shared document store used by the feature stores. */
export const googleDriveDocuments = new GoogleDriveDocuments({
  client: googleDriveClient,
  getRootFolderId: async () => (await GoogleDriveStorage.ensureRootFolder()).id,
});
