import os from "node:os";

import { appVersion } from "@main/constants";
import type {
  CloudSaveUploadProgress,
  GameShop,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import {
  GoogleDriveManifestConflictError,
  GoogleDriveStorage,
} from "../google-drive";
import { cloudSaveFileKey } from "./cloud-save-contract";
import {
  planGoogleDriveSnapshotWrite,
  verifyGoogleDriveSnapshotCommit,
} from "./google-drive-snapshot-policy.js";
import { mapWithConcurrency } from "./map-with-concurrency";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";

const MAX_CONCURRENT_DRIVE_UPLOADS = 4;

export interface CreateGoogleDriveSnapshotParams {
  objectId: string;
  shop: GameShop;
  context: LocalGameSnapshotContext;
  files: SnapshotFile[];
  variants: SnapshotVariant[];
  customPathRawPaths: string[];
  aggregateHash: string;
  baseVersion: number;
  expectedSnapshotId?: string | null;
  unresolvedRemoteEntryIds?: string[];
  updateAnchor?: boolean;
  onProgress?: (progress: CloudSaveUploadProgress) => void;
  assertEnvironmentCurrent?: () => Promise<void>;
}

const blobKey = (file: Pick<SnapshotFile, "hash" | "sizeBytes">) =>
  JSON.stringify([file.hash, file.sizeBytes]);

/**
 * Uploads the snapshot's blobs to the content-addressed Drive store. Identical
 * content is uploaded once and shared by every file variant that references it.
 */
const uploadGoogleDriveSnapshotBlobs = async (
  params: CreateGoogleDriveSnapshotParams
) => {
  const { context, files, onProgress } = params;
  const totalFiles = files.length;
  const totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0);

  const sourceByBlob = new Map(
    context.sourceFiles.map((file) => [blobKey(file), file])
  );
  const sourceByIdentity = new Map(
    context.sourceFiles.map((file) => [cloudSaveFileKey(file), file])
  );
  const filesByBlob = new Map<string, SnapshotFile[]>();
  for (const file of files) {
    const key = blobKey(file);
    filesByBlob.set(key, [...(filesByBlob.get(key) ?? []), file]);
  }

  let completedFiles = 0;
  let completedBytes = 0;
  const emitProgress = (currentFile: string | null) =>
    onProgress?.({
      completedFiles,
      totalFiles,
      completedBytes,
      totalBytes,
      currentFile,
    });
  emitProgress(null);

  // One listing lets existing content-addressed blobs be reused without
  // requiring a copy of every historical file to exist in the local scan.
  // Listing failures are fatal: an upload must not assume that cloud content is
  // missing and then try to source it from an unrelated local path.
  const existingBlobHashes = new Set(await GoogleDriveStorage.listBlobHashes());

  await mapWithConcurrency(
    [...filesByBlob.values()],
    MAX_CONCURRENT_DRIVE_UPLOADS,
    async (group) => {
      const [file] = group;
      const key = blobKey(file);
      if (!existingBlobHashes.has(file.hash)) {
        const source =
          sourceByBlob.get(key) ?? sourceByIdentity.get(cloudSaveFileKey(file));
        if (
          !source ||
          source.hash !== file.hash ||
          source.sizeBytes !== file.sizeBytes
        ) {
          throw new Error(
            `Missing local upload source for ${file.relativePath}`
          );
        }

        emitProgress(source.relativePath);
        await GoogleDriveStorage.uploadBlob({
          hash: file.hash,
          absolutePath: source.absolutePath,
          sizeBytes: file.sizeBytes,
        });
      } else {
        emitProgress(file.relativePath);
      }
    },
    (_result, group) => {
      completedFiles += group.length;
      completedBytes += group.reduce(
        (total, file) => total + file.sizeBytes,
        0
      );
      emitProgress(null);
    }
  );
};

/**
 * Commits a local snapshot to Drive. The head manifest is the snapshot: its
 * Drive file id is the snapshot id the rest of the engine already handles.
 */
export const createGoogleDriveSnapshotFromLocalState = async (
  params: CreateGoogleDriveSnapshotParams
): Promise<RemoteGameSnapshot> => {
  const headRef = await GoogleDriveStorage.readManifest(
    params.shop,
    params.objectId
  );
  const plan = planGoogleDriveSnapshotWrite({
    head: headRef
      ? {
          fileId: headRef.fileId,
          etag: headRef.etag,
          version: headRef.manifest.version,
        }
      : null,
    baseVersion: params.baseVersion,
    expectedSnapshotId: params.expectedSnapshotId ?? null,
  });
  if (plan.kind === "conflict") {
    throw new GoogleDriveManifestConflictError(
      plan.reason === "snapshot-changed"
        ? "Google Drive snapshot changed before the commit"
        : "Google Drive snapshot version advanced before the commit"
    );
  }

  await uploadGoogleDriveSnapshotBlobs(params);
  await params.assertEnvironmentCurrent?.();

  const manifestRef = await GoogleDriveStorage.writeManifest(
    params.shop,
    params.objectId,
    {
      previousManifestFileId: plan.previousManifestFileId,
      previousEtag: plan.previousEtag,
      version: plan.version,
      previousSnapshotId: plan.previousSnapshotId,
      aggregateHash: params.aggregateHash,
      environmentId: params.context.environmentId,
      hostname: os.hostname() || "unknown",
      platform: params.context.pathContext.platform,
      appVersion,
      customPathRawPaths: params.customPathRawPaths,
      variants: params.variants,
      files: params.files,
    }
  );
  await params.assertEnvironmentCurrent?.();

  if (
    !verifyGoogleDriveSnapshotCommit({
      manifest: manifestRef.manifest,
      version: plan.version,
      aggregateHash: params.aggregateHash,
      customPathRawPaths: params.customPathRawPaths,
      variants: params.variants,
      files: params.files,
    })
  ) {
    throw new Error("Committed Google Drive snapshot is inconsistent");
  }

  if (params.updateAnchor !== false) {
    await params.assertEnvironmentCurrent?.();
    await saveCloudSaveSyncAnchor(
      params.shop,
      params.objectId,
      params.context.environmentId,
      {
        schemaVersion: 4,
        environmentId: params.context.environmentId,
        baseSnapshotId: manifestRef.fileId,
        baseVersion: plan.version,
        baseAggregateHash: params.aggregateHash,
        entries: params.files.map((file) => ({
          variantId: file.variantId,
          rawPath: file.rawPath,
          relativePath: file.relativePath,
          hash: file.hash,
          sizeBytes: file.sizeBytes,
          ...(file.stateMetadata ? { stateMetadata: file.stateMetadata } : {}),
        })),
        unresolvedRemoteEntryIds: (
          params.unresolvedRemoteEntryIds ?? []
        ).filter((entryId) =>
          params.files.some((file) => cloudSaveFileKey(file) === entryId)
        ),
        updatedAt: new Date().toISOString(),
      }
    );
  }

  return {
    id: manifestRef.fileId,
    version: plan.version,
    fileCount: params.files.length,
    totalSizeBytes: params.files.reduce(
      (total, file) => total + file.sizeBytes,
      0
    ),
    aggregateHash: params.aggregateHash,
    provider: "google-drive",
  };
};
