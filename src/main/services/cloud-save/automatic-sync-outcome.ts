import type {
  CloudSaveAutomaticSyncTrigger,
  CloudSaveSyncProgressStage,
  SyncGameCloudSaveResult,
} from "@types";

export type AutomaticCloudSaveSyncOutcome =
  | { status: "completed"; result: SyncGameCloudSaveResult }
  | {
      status: "skipped" | "offline" | "cancelled" | "failed";
      result: null;
      errorCode?: string;
    };

export const getPendingDeletionAutomaticSyncOutcome = (
  deletionPending: boolean
): AutomaticCloudSaveSyncOutcome | null =>
  deletionPending
    ? {
        status: "cancelled",
        result: null,
        errorCode: "cloud_save_delete_pending",
      }
    : null;

export const classifyAutomaticCloudSaveFailure = (
  trigger: CloudSaveAutomaticSyncTrigger,
  latestStage?: CloudSaveSyncProgressStage
): "offline" | "failed" => {
  // Background sweeps are best-effort and invisible to the user, so their
  // failures stay quiet instead of surfacing as sync errors.
  if (trigger === "background-sweep") return "offline";

  return trigger === "pre-launch" && latestStage !== "restoring"
    ? "offline"
    : "failed";
};
