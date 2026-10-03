import type {
  GoogleDriveAccount,
  GoogleDriveConnectionStatus,
  GoogleDriveFolderRef,
  GoogleDriveSettings,
} from "@types";

import { logger } from "../logger.js";
import { GoogleDriveAuth } from "./google-drive-auth.js";
import {
  getGoogleDriveSettings,
  updateGoogleDriveSettings,
} from "./google-drive-settings.js";
import { GoogleDriveStorage } from "./google-drive-storage.js";

export class GoogleDriveService {
  /** Restores a persisted session on startup; never prompts the user. */
  static async setup() {
    await GoogleDriveAuth.setup();
  }

  static getStatus(): Promise<GoogleDriveConnectionStatus> {
    return GoogleDriveAuth.getStatus();
  }

  static getSettings(): Promise<GoogleDriveSettings> {
    return getGoogleDriveSettings();
  }

  static async updateSettings(
    patch: Partial<GoogleDriveSettings>
  ): Promise<GoogleDriveSettings> {
    const previous = await getGoogleDriveSettings();
    const next = await updateGoogleDriveSettings(patch);

    if (next.clientId !== previous.clientId) {
      // Tokens are bound to the OAuth client that issued them.
      await GoogleDriveAuth.clearConnection();
      GoogleDriveStorage.resetCache();
    } else if (next.folderName !== previous.folderName) {
      GoogleDriveStorage.resetCache();
    }

    return next;
  }

  static async connect(clientId?: string): Promise<GoogleDriveAccount> {
    const account = await GoogleDriveAuth.connect(clientId);
    GoogleDriveStorage.resetCache();
    return account;
  }

  static cancelConnect() {
    GoogleDriveAuth.cancelConnect();
  }

  static async disconnect(options?: {
    deleteRemoteData?: boolean;
  }): Promise<void> {
    if (options?.deleteRemoteData) {
      await GoogleDriveStorage.deleteAllData().catch((error) =>
        logger.warn("Failed to delete Google Drive save data", error)
      );
    }

    await GoogleDriveAuth.disconnect();
    GoogleDriveStorage.resetCache();
  }

  static isConnected(): Promise<boolean> {
    return GoogleDriveAuth.isConnected();
  }

  static getRootFolder(): Promise<GoogleDriveFolderRef | null> {
    return GoogleDriveStorage.getRootFolder();
  }
}
