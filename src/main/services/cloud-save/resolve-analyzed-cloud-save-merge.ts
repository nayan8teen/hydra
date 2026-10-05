import type { CloudSaveConflictResolution, CloudSaveMergeResult } from "@types";

import type { analyzeCloudSaveState } from "./analyze-cloud-save-state.js";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.js";

type CloudSaveAnalysis = Awaited<ReturnType<typeof analyzeCloudSaveState>>;
type RemoteManifest = NonNullable<CloudSaveAnalysis["remoteManifest"]>;
type ResolvableCloudSaveAnalysis = Pick<
  CloudSaveAnalysis,
  | "merge"
  | "localSnapshotContext"
  | "anchor"
  | "syncDirection"
  | "pendingCustomPathRawPaths"
  | "installationOwnedCustomPathRawPaths"
  | "preserveCloudOnlyEntryIds"
> & {
  remoteManifest: Pick<RemoteManifest, "variants" | "files"> | null;
};

export const resolveAnalyzedCloudSaveMerge = (
  analysis: ResolvableCloudSaveAnalysis,
  resolution?: CloudSaveConflictResolution
): CloudSaveMergeResult => {
  if (!resolution) return analysis.merge;
  // The conflict may already be gone (for example another sync landed first).
  // Resolving a conflict that no longer exists is a no-op, not a failure:
  // proceed with the current merge instead of surfacing a sync error.
  if (analysis.merge.conflicts.length === 0) return analysis.merge;
  const resolutions = new Map(
    analysis.merge.conflicts.map((conflict) => [conflict.entryId, resolution])
  );
  return mergeUserVariantSnapshots({
    local: analysis.localSnapshotContext,
    remoteVariants: analysis.remoteManifest?.variants ?? [],
    remoteFiles: analysis.remoteManifest?.files ?? [],
    base: analysis.anchor,
    direction: analysis.syncDirection,
    resolutions,
    treatLocalAsNewRawPaths: new Set(analysis.pendingCustomPathRawPaths),
    preserveLocalMissingRawPaths: new Set(
      analysis.installationOwnedCustomPathRawPaths
    ),
    preserveCloudOnlyEntryIds: new Set(
      analysis.preserveCloudOnlyEntryIds ?? []
    ),
  });
};
