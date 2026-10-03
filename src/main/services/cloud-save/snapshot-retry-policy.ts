import { isAxiosError } from "axios";

export const isCloudSaveCommitTransportFailure = (error: unknown) =>
  (isAxiosError(error) && !error.response) ||
  (!isAxiosError(error) &&
    error instanceof Error &&
    /Request failed with|ECONN|ETIMEDOUT|timeout|socket hang up/i.test(
      error.message
    ));

export const shouldReprepareCloudSaveSnapshot = (error: unknown) => {
  if (
    error instanceof Error &&
    error.message.includes("cloud_save_upload_url_expired")
  ) {
    return true;
  }
  if (!isAxiosError(error)) return false;
  const payload = JSON.stringify(error.response?.data ?? "");
  return (
    payload.includes("game/cloud-save-pending-snapshot-expired") ||
    payload.includes("game/cloud-save-pending-snapshot-incomplete") ||
    payload.includes("game/cloud-save-pending-snapshot-not-found")
  );
};

/**
 * A lost conflict race is always reported as HTTP 409: Hydra rejects a stale
 * `expectedSnapshotId` and Google Drive maps a stale `If-Match` precondition
 * failure onto the same status, so both backends retry through one path.
 */
export const isCloudSaveConflictError = (error: unknown) =>
  (isAxiosError(error) && error.response?.status === 409) ||
  (!isAxiosError(error) &&
    error instanceof Error &&
    (error as { status?: unknown }).status === 409);

export const shouldRetryCloudSaveConflict = (error: unknown, attempt: number) =>
  attempt === 0 && isCloudSaveConflictError(error);

export const shouldRetryCloudSaveStateChange = (attempt: number) =>
  attempt === 0;
