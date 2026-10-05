import type {
  CloudSaveHistorySnapshot,
  CloudSaveSnapshotRestoreResult,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";

import { GoogleDriveStorage } from "../google-drive";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { createRemoteSnapshotFromLocalState } from "./create-remote-snapshot-from-local-state";
import { getCloudSaveSnapshotFiles } from "./get-cloud-save-snapshot-files";
import { listCloudSaveSnapshots } from "./list-cloud-save-snapshots";
import { restoreRemoteSnapshot } from "./restore-remote-snapshot";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash";
import {
  assertCloudSaveRemoteAccess,
  resolveCloudSaveProvider,
} from "./remote-backend";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";

export const restoreCloudSaveSnapshotFiles = async (
  objectId: string,
  shop: GameShop,
  snapshotId: string,
  entryIds: string[],
  onProgress?: (progress: CloudSaveSyncProgressPayload) => void
): Promise<CloudSaveSnapshotRestoreResult> => {
  await assertCloudSaveRemoteAccess(
    await resolveCloudSaveProvider(objectId, shop)
  );
  const scopeKey = cloudSaveOperationScopeKey(objectId, shop);
  return cloudSaveOperationGate.runSync(
    scopeKey,
    `history-restore:${snapshotId}:${JSON.stringify([...entryIds].sort())}`,
    async () => {
      const snapshots = await listCloudSaveSnapshots(objectId, shop);
      const snapshot = snapshots.find((item) => item.id === snapshotId);
      if (!snapshot) throw new Error("cloud_save_restore_snapshot_not_found");
      const details = await getCloudSaveSnapshotFiles(
        objectId,
        shop,
        snapshotId
      );
      if (
        entryIds.length === 0 ||
        new Set(entryIds).size !== entryIds.length ||
        entryIds.some(
          (entryId) =>
            !details.files.some((file) => cloudSaveFileKey(file) === entryId)
        )
      ) {
        throw new Error("cloud_save_restore_selection_invalid");
      }

      const gameContext = await getCloudSaveGameContext(objectId, shop);
      const progress = (
        stage: "analyzing" | "restoring" | "uploading" | "completed",
        processedFiles: number,
        totalFiles: number
      ) =>
        onProgress?.({
          gameId: { objectId, shop },
          stage,
          processedFiles,
          totalFiles,
        });
      progress("restoring", 0, entryIds.length);
      const restore = await restoreRemoteSnapshot(
        snapshotId,
        { objectId, shop },
        (payload) =>
          progress("restoring", payload.processedFiles, payload.totalFiles),
        snapshot,
        {
          environmentId: gameContext.environmentId,
          pathContext: gameContext.pathContext,
        },
        entryIds,
        false
      );
      if (!restore.ok) throw new Error("Cloud save restore failed");

      // Make the selected cloud backup the new latest version without restoring
      // or rewriting any other local save. Unselected cloud files are retained
      // in the manifest; their blobs are already stored on Drive.
      progress("analyzing", 0, entryIds.length);
      const local = await buildLocalGameSnapshotContext(objectId, shop);
      const headRef = await GoogleDriveStorage.readManifest(shop, objectId);
      if (!headRef) throw new Error("cloud_save_snapshot_not_found");
      const filesById = new Map(
        headRef.manifest.files.map((file) => [cloudSaveFileKey(file), file])
      );
      const localById = new Map(
        local.files.map((file) => [cloudSaveFileKey(file), file])
      );
      for (const entryId of entryIds) {
        const selectedFile = details.files.find(
          (file) => cloudSaveFileKey(file) === entryId
        )!;
        const localFile = localById.get(entryId);
        if (
          !localFile ||
          localFile.hash !== selectedFile.hash ||
          localFile.sizeBytes !== selectedFile.sizeBytes
        ) {
          throw new Error(
            "Restored cloud save did not match the selected backup"
          );
        }
        filesById.set(entryId, localFile);
      }
      const files = [...filesById.values()].sort((left, right) =>
        cloudSaveFileKey(left).localeCompare(cloudSaveFileKey(right))
      );
      const variantById = new Map(
        [
          ...headRef.manifest.variants,
          ...details.variants,
          ...local.variants,
        ].map((variant) => [variant.variantId, variant])
      );
      const variants = [...new Set(files.map((file) => file.variantId))]
        .map((variantId) => variantById.get(variantId))
        .filter((variant): variant is NonNullable<typeof variant> =>
          Boolean(variant)
        );
      if (
        variants.length !== new Set(files.map((file) => file.variantId)).size
      ) {
        throw new Error("Cloud save restore is missing variant metadata");
      }
      const aggregateHash = buildCloudSaveAggregateHash({ variants, files });
      progress("uploading", 0, files.length);
      const committed = await createRemoteSnapshotFromLocalState(
        objectId,
        shop,
        (uploadProgress) =>
          progress(
            "uploading",
            uploadProgress.completedFiles,
            uploadProgress.totalFiles
          ),
        local,
        {
          baseVersion: headRef.manifest.version,
          expectedSnapshotId: headRef.fileId,
          variants,
          files,
          customPathRawPaths: headRef.manifest.customPathRawPaths,
          aggregateHash,
          unresolvedRemoteEntryIds: [],
        }
      );
      if (!committed) throw new Error("cloud_save_snapshot_not_committed");
      const finalSnapshots = await listCloudSaveSnapshots(objectId, shop);
      const headSnapshot = finalSnapshots.find((item) => item.isHead);
      if (!headSnapshot) throw new Error("cloud_save_snapshot_not_committed");
      progress("completed", entryIds.length, entryIds.length);
      return {
        restoredFiles: restore.restoredFiles + restore.skippedFiles,
        snapshot: snapshot as CloudSaveHistorySnapshot,
        headSnapshot,
      };
    }
  );
};
