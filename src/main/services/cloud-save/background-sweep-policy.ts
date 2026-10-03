import type { GoogleDriveSettings } from "@types";

import { GOOGLE_DRIVE_DEFAULT_SWEEP_INTERVAL_MINUTES } from "../google-drive/google-drive-constants.js";

const MINUTE_IN_MS = 60_000;

/**
 * The sweep only runs when Drive is the active cloud-save backend and the user
 * explicitly opted into background syncs; both default to off.
 */
export const isBackgroundCloudSaveSweepEnabled = (
  settings: Pick<
    GoogleDriveSettings,
    "driveSyncEnabled" | "backgroundSweepEnabled"
  >
) =>
  settings.driveSyncEnabled === true &&
  settings.backgroundSweepEnabled === true;

export const getBackgroundCloudSaveSweepIntervalMs = (
  settings: Pick<GoogleDriveSettings, "backgroundSweepIntervalMinutes">
) => {
  const minutes =
    settings.backgroundSweepIntervalMinutes > 0
      ? settings.backgroundSweepIntervalMinutes
      : GOOGLE_DRIVE_DEFAULT_SWEEP_INTERVAL_MINUTES;

  return minutes * MINUTE_IN_MS;
};

/**
 * A sweep never runs at launch: without a previous run the first one waits a
 * full interval, so startup is never blocked by background sync work.
 */
export const shouldStartBackgroundCloudSaveSweep = (params: {
  now: number;
  lastStartedAt: number | null;
  intervalMs: number;
}) =>
  params.lastStartedAt !== null &&
  params.now - params.lastStartedAt >= params.intervalMs;

/** Games that are playing or launching are never swept. */
export const shouldSkipGameForBackgroundSweep = (params: {
  isRunning: boolean;
  hasPendingLaunch: boolean;
}) => params.isRunning || params.hasPendingLaunch;
