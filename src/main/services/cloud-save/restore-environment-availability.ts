/**
 * Restore targets can be unresolvable when the current machine cannot map the
 * remote save paths (no Wine prefix/profile for a Windows game on Linux). Those
 * failures are environmental, not corruption, so callers skip the observation
 * step instead of failing the whole operation.
 */
export const isUnavailableRestoreEnvironment = (error: unknown) =>
  error instanceof Error &&
  (error.message === "cloud_save_restore_prefix_unresolved" ||
    error.message === "cloud_save_restore_prefix_invalid" ||
    error.message === "cloud_save_restore_profile_unresolved");
