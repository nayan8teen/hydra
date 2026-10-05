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
  isGoogleDriveManifestConflictError,
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
  /**
   * How many times to re-read and re-plan when the Drive head manifest
   * changes mid-commit. The total attempt count is this + 1.
   */
  maxManifestConflictRetries?: number;
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
const readHead = async (
  shop: GameShop,
  objectId: string
): Promise<{
  fileId: string;
  etag: string;
  version: number;
} | null> => {
  const headRef = await GoogleDriveStorage.readManifest(shop, objectId);
  if (!headRef) return null;
  return {
    fileId: headRef.fileId,
    etag: headRef.etag,
    version: headRef.manifest.version,
  };
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Commits a local snapshot to Drive with retry on concurrent manifest
 * changes. The head manifest is the snapshot: its Drive file id is the
 * snapshot id the rest of the engine already handles.
 *
 * A concurrent write (from another app instance or a re-validation) can
 * move the head between the analysis read and the commit. Rather than
 * fail immediately, re-read the head and re-plan a few times so a
 * transient conflict resolves itself.
 */
export const createGoogleDriveSnapshotFromLocalState = async (
  params: CreateGoogleDriveSnapshotParams
): Promise<RemoteGameSnapshot> => {
  const maxRetries = params.maxManifestConflictRetries ?? 2;
  let head = await readHead(params.shop, params.objectId);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const plan = planGoogleDriveSnapshotWrite({
      head: head,
      baseVersion: params.baseVersion,
      expectedSnapshotId: params.expectedSnapshotId ?? null,
    });
    if (plan.kind !== "conflict") {
      try {
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
                ...(file.stateMetadata
                  ? { stateMetadata: file.stateMetadata }
                  : {}),
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
      } catch (error) {
        if (attempt < maxRetries && isGoogleDriveManifestConflictError(error)) {
          head = await readHead(params.shop, params.objectId);
          continue;
        }
        throw error;
      }
    }

    if (attempt >= maxRetries) {
      throw new GoogleDriveManifestConflictError(
        plan.reason === "snapshot-changed"
          ? "Google Drive snapshot changed before the commit"
          : "Google Drive snapshot version advanced before the commit"
      );
    }

    head = await readHead(params.shop, params.objectId);
    if (!head) {
      // Head manifest disappeared; re-plan with no head on the next
      // iteration so a fresh first write can proceed.
      await sleep(100 * (attempt + 1));
      continue;
    }
    await sleep(100 * (attempt + 1));
  }

  throw new Error(
    "Unreachable: createGoogleDriveSnapshotFromLocalState exhausted retries"
  );
};
