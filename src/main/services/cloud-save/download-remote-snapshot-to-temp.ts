import type {
  CloudSaveRemoteProvider,
  DownloadedRestoreFile,
  RestoreManifestFile,
} from "@types";

import { downloadGoogleDriveSnapshotToTemp } from "./download-google-drive-snapshot-to-temp";

/**
 * Fork: snapshots are only ever stored on Google Drive, so the download always
 * resolves content-addressed blobs from there. The provider argument is kept so
 * callers do not have to change, but it no longer selects a backend.
 */
export const downloadRemoteSnapshotToTemp = async (
  snapshotId: string,
  snapshotVersion: number,
  requestedFiles?: RestoreManifestFile[],
  onProgress?: (processedFiles: number, totalFiles: number) => void,
  _provider?: CloudSaveRemoteProvider
): Promise<DownloadedRestoreFile[]> => {
  if (requestedFiles?.length === 0) return [];

  return downloadGoogleDriveSnapshotToTemp({
    snapshotId,
    snapshotVersion,
    requestedFiles,
    onProgress,
  });
};
