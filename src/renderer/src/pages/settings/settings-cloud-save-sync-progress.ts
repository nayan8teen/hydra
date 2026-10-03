import type { CloudSaveBulkSyncProgress } from "@types";

const PERCENT = 100;

export interface CloudSaveSyncAllPresentation {
  isVisible: boolean;
  processed: number;
  total: number;
  /** Null while the total is unknown, which renders an indeterminate bar. */
  percent: number | null;
  currentLabel: string | null;
}

export const getCloudSaveSyncAllPresentation = (
  progress: CloudSaveBulkSyncProgress | null,
  isRunning: boolean
): CloudSaveSyncAllPresentation => {
  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;

  return {
    isVisible: isRunning,
    processed,
    total,
    percent:
      total > 0
        ? Math.min(PERCENT, Math.round((processed / total) * PERCENT))
        : null,
    currentLabel: progress?.currentLabel ?? null,
  };
};
