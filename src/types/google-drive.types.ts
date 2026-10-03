import type { SnapshotFile, SnapshotVariant } from "./cloud-save.types";
import type { GameShop } from "./game.types";

export interface GoogleDriveAccount {
  email: string;
  displayName: string;
  photoUrl: string | null;
  connectedAt: string;
}

export interface GoogleDriveSettings {
  clientId: string | null;
  /**
   * Google OAuth client secret. Only needed for "Web application" clients;
   * "Desktop app" clients authenticate with PKCE alone. Never sent anywhere
   * but Google's token endpoint.
   */
  clientSecret: string | null;
  driveSyncEnabled: boolean;
  backgroundSweepEnabled: boolean;
  backgroundSweepIntervalMinutes: number;
}

export type GoogleDriveConnectionState =
  | "disconnected"
  | "connected"
  | "needs-reauth";

/**
 * Why the last authorization attempt failed, kept as a stable marker plus the
 * provider's own description so the settings card can show the real cause.
 */
export interface GoogleDriveConnectError {
  marker: string | null;
  detail: string;
  clientId: string | null;
  at: string;
}

export interface GoogleDriveConnectionStatus {
  state: GoogleDriveConnectionState;
  account: GoogleDriveAccount | null;
  settings: GoogleDriveSettings;
  connectError: GoogleDriveConnectError | null;
}

export interface GoogleDriveFolderRef {
  id: string;
  name: string;
  webViewLink: string | null;
}

export type GoogleDrivePlatform = "windows" | "mac" | "linux";

/**
 * Remote snapshot manifest stored as `manifest.json` inside each game folder.
 * The Drive file id of that file becomes the snapshot id used by the sync engine.
 */
export interface GoogleDriveStorageManifest {
  schemaVersion: 1;
  provider: "google-drive";
  shop: GameShop;
  objectId: string;
  version: number;
  previousSnapshotId: string | null;
  aggregateHash: string;
  createdAt: string;
  updatedAt: string;
  environmentId: string;
  hostname: string;
  platform: GoogleDrivePlatform;
  appVersion: string;
  customPathRawPaths: string[];
  variants: SnapshotVariant[];
  files: SnapshotFile[];
}

export interface GoogleDriveManifestRef {
  fileId: string;
  etag: string;
  modifiedTime: string;
  manifest: GoogleDriveStorageManifest;
}

export interface GoogleDriveFileMetadata {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  headRevisionId?: string;
  modifiedTime?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

export interface GoogleDriveBlobUploadResult {
  fileId: string;
  uploaded: boolean;
}
