import { logger } from "@main/services/logger";
import type {
  CloudSaveCustomPathBindings,
  CloudSavePathContext,
  GameShop,
  LocalGameSnapshotContext,
  RestoreManifestResponse,
} from "@types";

import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { reconcileRemoteTargetObservations } from "./reconcile-remote-target-observations";
import { resolveRestoreManifestTargets } from "./resolve-remote-snapshot-targets";
import { isUnavailableRestoreEnvironment } from "./restore-environment-availability";

interface ReconcileLocalSnapshotTargetsParams {
  objectId: string;
  shop: GameShop;
  local: LocalGameSnapshotContext;
  remoteManifest: Pick<
    RestoreManifestResponse,
    "snapshot" | "variants" | "files"
  > &
    Partial<Pick<RestoreManifestResponse, "customPathRawPaths">>;
  customPathBindings?: CloudSaveCustomPathBindings;
  rpcs3SavedataTitleIds?: readonly string[];
  pathContext?: CloudSavePathContext;
}

/**
 * Matches locally scanned files to the remote manifest identity they belong to.
 *
 * A restore writes each file to the target path the resolver chose, but the
 * local scan can attribute the result to a different raw path, relative path or
 * variant than the snapshot entry it came from. Reconciliation resolves the
 * still-missing remote files against the local filesystem and adopts the remote
 * identity for anything it observes, so downstream callers can match a restored
 * entry back to the selection instead of treating a completed restore as
 * failed.
 */
export const reconcileLocalSnapshotTargets = async ({
  objectId,
  shop,
  local,
  remoteManifest,
  customPathBindings,
  rpcs3SavedataTitleIds,
  pathContext,
}: ReconcileLocalSnapshotTargetsParams): Promise<LocalGameSnapshotContext> => {
  const localEntryIds = new Set(local.files.map(cloudSaveFileKey));
  const missingRemoteFiles = remoteManifest.files.filter(
    (file) => !localEntryIds.has(cloudSaveFileKey(file))
  );
  if (missingRemoteFiles.length === 0) return local;

  const usedVariantIds = new Set(
    missingRemoteFiles.map((file) => file.variantId)
  );
  try {
    const resolution = await resolveRestoreManifestTargets(
      {
        snapshot: remoteManifest.snapshot,
        customPathRawPaths: remoteManifest.customPathRawPaths ?? [],
        variants: remoteManifest.variants.filter((variant) =>
          usedVariantIds.has(variant.variantId)
        ),
        files: missingRemoteFiles,
      },
      pathContext ?? local.pathContext,
      customPathBindings,
      rpcs3SavedataTitleIds
    );
    return reconcileRemoteTargetObservations(
      local,
      remoteManifest.variants,
      missingRemoteFiles,
      resolution,
      buildCloudSaveAggregateHash
    );
  } catch (error) {
    if (!isUnavailableRestoreEnvironment(error)) throw error;
    logger.info(
      "[Cloud Save] Skipping remote target observation without a usable restore environment",
      { shop, objectId, error }
    );
    return local;
  }
};
