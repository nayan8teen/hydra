import { isValidGoogleDriveClientId } from "@shared";
import { db, levelKeys } from "@main/level";
import type { GoogleDriveSettings } from "@types";

import {
  GOOGLE_DRIVE_DEFAULT_FOLDER_NAME,
  GOOGLE_DRIVE_DEFAULT_SWEEP_INTERVAL_MINUTES,
  GOOGLE_DRIVE_MAX_FOLDER_NAME_LENGTH,
  GOOGLE_DRIVE_MAX_SWEEP_INTERVAL_MINUTES,
  GOOGLE_DRIVE_MIN_SWEEP_INTERVAL_MINUTES,
} from "./google-drive-constants.js";

export const DEFAULT_GOOGLE_DRIVE_SETTINGS: GoogleDriveSettings = {
  clientId: null,
  driveSyncEnabled: false,
  backgroundSweepEnabled: false,
  backgroundSweepIntervalMinutes: GOOGLE_DRIVE_DEFAULT_SWEEP_INTERVAL_MINUTES,
  folderName: GOOGLE_DRIVE_DEFAULT_FOLDER_NAME,
};

export { isValidGoogleDriveClientId };

export const normalizeGoogleDriveClientId = (value: unknown): string | null => {
  if (!isValidGoogleDriveClientId(value)) return null;
  return value.trim();
};

const normalizeFolderName = (value: unknown) => {
  if (typeof value !== "string") return GOOGLE_DRIVE_DEFAULT_FOLDER_NAME;
  const name = value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, GOOGLE_DRIVE_MAX_FOLDER_NAME_LENGTH)
    .trim();
  return name.length > 0 ? name : GOOGLE_DRIVE_DEFAULT_FOLDER_NAME;
};

const normalizeSweepInterval = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return GOOGLE_DRIVE_DEFAULT_SWEEP_INTERVAL_MINUTES;
  }
  return Math.min(
    GOOGLE_DRIVE_MAX_SWEEP_INTERVAL_MINUTES,
    Math.max(GOOGLE_DRIVE_MIN_SWEEP_INTERVAL_MINUTES, Math.round(value))
  );
};

export const normalizeGoogleDriveSettings = (
  value: Partial<GoogleDriveSettings> | null | undefined
): GoogleDriveSettings => ({
  clientId: normalizeGoogleDriveClientId(value?.clientId),
  driveSyncEnabled: value?.driveSyncEnabled === true,
  backgroundSweepEnabled: value?.backgroundSweepEnabled === true,
  backgroundSweepIntervalMinutes: normalizeSweepInterval(
    value?.backgroundSweepIntervalMinutes
  ),
  folderName: normalizeFolderName(value?.folderName),
});

export const getGoogleDriveSettings =
  async (): Promise<GoogleDriveSettings> => {
    try {
      const stored = await db.get<string, Partial<GoogleDriveSettings> | null>(
        levelKeys.googleDriveSettings,
        { valueEncoding: "json" }
      );
      return normalizeGoogleDriveSettings(stored);
    } catch {
      return { ...DEFAULT_GOOGLE_DRIVE_SETTINGS };
    }
  };

export const persistGoogleDriveSettings = async (
  settings: GoogleDriveSettings
) => {
  await db.put(levelKeys.googleDriveSettings, settings, {
    valueEncoding: "json",
  });
};

export const updateGoogleDriveSettings = async (
  patch: Partial<GoogleDriveSettings>
): Promise<GoogleDriveSettings> => {
  const current = await getGoogleDriveSettings();
  const next = normalizeGoogleDriveSettings({ ...current, ...patch });
  await persistGoogleDriveSettings(next);
  return next;
};
