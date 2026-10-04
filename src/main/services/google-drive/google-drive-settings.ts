import {
  isValidGoogleDriveClientId,
  isValidGoogleDriveClientSecret,
} from "@shared";
import { db, levelKeys } from "@main/level";
import type { GoogleDriveSettings } from "@types";
import { safeStorage } from "electron";

import { logger } from "../logger.js";
import {
  GOOGLE_DRIVE_DEFAULT_SWEEP_INTERVAL_MINUTES,
  GOOGLE_DRIVE_MAX_SWEEP_INTERVAL_MINUTES,
  GOOGLE_DRIVE_MIN_SWEEP_INTERVAL_MINUTES,
} from "./google-drive-constants.js";

export const DEFAULT_GOOGLE_DRIVE_SETTINGS: GoogleDriveSettings = {
  clientId: null,
  clientSecret: null,
  driveSyncEnabled: false,
  backgroundSweepEnabled: false,
  backgroundSweepIntervalMinutes: GOOGLE_DRIVE_DEFAULT_SWEEP_INTERVAL_MINUTES,
};

export { isValidGoogleDriveClientId };

export const normalizeGoogleDriveClientId = (value: unknown): string | null => {
  if (!isValidGoogleDriveClientId(value)) return null;
  return value.trim();
};

export const normalizeGoogleDriveClientSecret = (
  value: unknown
): string | null => {
  if (!isValidGoogleDriveClientSecret(value)) return null;
  return value.trim();
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
  clientSecret: normalizeGoogleDriveClientSecret(value?.clientSecret),
  driveSyncEnabled: value?.driveSyncEnabled === true,
  backgroundSweepEnabled: value?.backgroundSweepEnabled === true,
  backgroundSweepIntervalMinutes: normalizeSweepInterval(
    value?.backgroundSweepIntervalMinutes
  ),
});

export const getGoogleDriveSettings =
  async (): Promise<GoogleDriveSettings> => {
    try {
      const stored = await db.get<string, Partial<GoogleDriveSettings> | null>(
        levelKeys.googleDriveSettings,
        { valueEncoding: "json" }
      );
      return normalizeGoogleDriveSettings({
        ...stored,
        clientSecret: await readStoredClientSecret(),
      });
    } catch {
      return { ...DEFAULT_GOOGLE_DRIVE_SETTINGS };
    }
  };

/**
 * The client secret never lands in the plain settings record. It is written to
 * its own level key and encrypted with the OS-provided store, exactly like the
 * OAuth tokens in `google-drive-auth`.
 */
export const persistGoogleDriveSettings = async (
  settings: GoogleDriveSettings
) => {
  await db.put(
    levelKeys.googleDriveSettings,
    { ...settings, clientSecret: null },
    { valueEncoding: "json" }
  );
  await writeStoredClientSecret(settings.clientSecret);
};

export const updateGoogleDriveSettings = async (
  patch: Partial<GoogleDriveSettings>
): Promise<GoogleDriveSettings> => {
  const current = await getGoogleDriveSettings();
  const next = normalizeGoogleDriveSettings({ ...current, ...patch });
  await persistGoogleDriveSettings(next);
  return next;
};

interface StoredGoogleDriveClientSecret {
  version: 1;
  encrypted: boolean;
  value: string;
}

const isEncryptionAvailable = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

const encryptSecret = (value: string) =>
  safeStorage.encryptString(value).toString("base64");

const decryptSecret = (value: string) =>
  safeStorage.decryptString(Buffer.from(value, "base64"));

const readStoredClientSecret = async (): Promise<string | null> => {
  try {
    const stored = await db.get<string, StoredGoogleDriveClientSecret | null>(
      levelKeys.googleDriveClientSecret,
      { valueEncoding: "json" }
    );

    if (!stored?.value) return null;
    if (!stored.encrypted) return stored.value;

    if (!isEncryptionAvailable()) {
      logger.warn(
        "The Google Drive client secret cannot be decrypted without OS encryption support; reconnect without it"
      );
      return null;
    }

    return decryptSecret(stored.value);
  } catch (error) {
    logger.warn("Failed to read the Google Drive client secret", error);
    return null;
  }
};

const writeStoredClientSecret = async (clientSecret: string | null) => {
  if (!clientSecret) {
    await db.del(levelKeys.googleDriveClientSecret).catch(() => undefined);
    return;
  }

  const encrypted = isEncryptionAvailable();
  const record: StoredGoogleDriveClientSecret = {
    version: 1,
    encrypted,
    value: encrypted ? encryptSecret(clientSecret) : clientSecret,
  };

  await db.put(levelKeys.googleDriveClientSecret, record, {
    valueEncoding: "json",
  });
};
