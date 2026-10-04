/**
 * Fork: unlocked achievements replicate through the user's Google Drive
 * (`GoogleDriveService.isSyncEnabled()` in the main process) instead of the
 * Hydra Cloud subscription, so the sidebar banner keys off the Drive
 * connection rather than `hasActiveSubscription`.
 */
export type AchievementsSyncStatus = "hidden" | "enabled" | "disabled";

interface AchievementsSyncStatusInput {
  achievementsCount: number;
  /** True while the Drive connection status is still being fetched. */
  isLoading: boolean;
  /** True when Drive sync is enabled and an account is connected. */
  isDriveSyncActive: boolean;
}

export const getAchievementsSyncStatus = ({
  achievementsCount,
  isLoading,
  isDriveSyncActive,
}: AchievementsSyncStatusInput): AchievementsSyncStatus => {
  // Never flash the "not synced" warning before the Drive status is known.
  if (achievementsCount <= 0 || isLoading) return "hidden";

  return isDriveSyncActive ? "enabled" : "disabled";
};
