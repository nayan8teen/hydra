import { rm } from "node:fs/promises";
import path from "node:path";

import { SystemPath } from "@main/services/system-path";
import type {
  DownloadedRestoreFile,
  RestoreManifestFile,
  SnapshotFile,
} from "@types";

import { GoogleDriveStorage } from "../google-drive";
import { cloudSaveFileKey } from "./cloud-save-contract";
import {
  mapWithConcurrency,
  MAX_CONCURRENT_RESTORE_OPERATIONS,
} from "./map-with-concurrency";

const blobKey = (file: Pick<SnapshotFile, "hash" | "sizeBytes">) =>
  JSON.stringify([file.hash, file.sizeBytes]);

/** Drive restores keep their blobs in the same temp root the native path uses. */
export const googleDriveSnapshotTempRoot = (snapshotTempId: string) =>
  path.join(SystemPath.getPath("temp"), "hydra-drive-restore", snapshotTempId);

export const cleanupGoogleDriveSnapshotTemp = async (
  snapshotTempId: string
) => {
  await rm(googleDriveSnapshotTempRoot(snapshotTempId), {
    recursive: true,
    force: true,
  });
};

export const downloadGoogleDriveSnapshotToTemp = async (params: {
  snapshotId: string;
  snapshotVersion: number;
  requestedFiles?: RestoreManifestFile[];
  onProgress?: (processedFiles: number, totalFiles: number) => void;
}): Promise<DownloadedRestoreFile[]> => {
  const manifestRef = await GoogleDriveStorage.readManifestByFileId(
    params.snapshotId
  );
  if (!manifestRef) {
    throw new Error("cloud_save_restore_snapshot_not_found");
  }

  const manifestFiles = new Map(
    manifestRef.manifest.files.map((file) => [cloudSaveFileKey(file), file])
  );
  const selectedFiles = (
    params.requestedFiles ?? manifestRef.manifest.files
  ).map((requested) => {
    const manifestFile = manifestFiles.get(cloudSaveFileKey(requested));
    if (
      !manifestFile ||
      manifestFile.hash !== requested.hash ||
      manifestFile.sizeBytes !== requested.sizeBytes ||
      manifestFile.lastModifiedAt !== requested.lastModifiedAt
    ) {
      throw new Error("Restore file does not match the Drive snapshot");
    }
    return manifestFile;
  });

  const tempRoot = googleDriveSnapshotTempRoot(
    `${params.snapshotId}-${params.snapshotVersion}`
  );
  const filesByBlob = new Map<string, SnapshotFile[]>();
  for (const file of selectedFiles) {
    const key = blobKey(file);
    filesByBlob.set(key, [...(filesByBlob.get(key) ?? []), file]);
  }

  const groups = [...filesByBlob.values()];
  let processedFiles = 0;
  const downloadedGroups = await mapWithConcurrency(
    groups,
    MAX_CONCURRENT_RESTORE_OPERATIONS,
    async (group) => {
      const [file] = group;
      const tempPath = path.join(tempRoot, file.hash);
      await GoogleDriveStorage.downloadBlob({
        hash: file.hash,
        destinationPath: tempPath,
      });
      return { key: blobKey(file), tempPath };
    },
    (_result, group) => {
      processedFiles += group.length;
      params.onProgress?.(processedFiles, selectedFiles.length);
    }
  );
  const tempPathByBlob = new Map(
    downloadedGroups.map(({ key, tempPath }) => [key, tempPath])
  );

  return selectedFiles.map((file) => {
    const tempPath = tempPathByBlob.get(blobKey(file));
    if (!tempPath) throw new Error("Missing downloaded Drive restore blob");
    return { ...file, tempPath };
  });
};
