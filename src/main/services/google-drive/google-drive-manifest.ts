import type {
  GameShop,
  GoogleDriveManifestRef,
  GoogleDrivePlatform,
  GoogleDriveStorageManifest,
  RemoteSnapshotSummary,
  RestoreManifestResponse,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import { CLOUD_SAVE_CUSTOM_PATH_PREFIX } from "../cloud-save/custom-path.js";
import { GOOGLE_DRIVE_PROVIDER } from "./google-drive-constants.js";
import {
  CLOUD_SAVE_HASH_PATTERN,
  validateCustomPathRawPaths,
  validateSnapshotFiles,
  validateSnapshotVariants,
} from "../cloud-save/cloud-save-contract.js";
import { GoogleDriveManifestInvalidError } from "./google-drive-errors.js";

export const GOOGLE_DRIVE_MANIFEST_SCHEMA_VERSION = 1;

const MANIFEST_KEYS = [
  "schemaVersion",
  "provider",
  "shop",
  "objectId",
  "version",
  "previousSnapshotId",
  "aggregateHash",
  "createdAt",
  "updatedAt",
  "environmentId",
  "hostname",
  "platform",
  "appVersion",
  "customPathRawPaths",
  "variants",
  "files",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isIsoDateString = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isPlatform = (value: unknown): value is GoogleDrivePlatform =>
  value === "windows" || value === "mac" || value === "linux";

const isGameShop = (value: unknown): value is GameShop =>
  value === "steam" || value === "custom" || value === "launchbox";

export interface BuildGoogleDriveManifestInput {
  shop: GameShop;
  objectId: string;
  version: number;
  previousSnapshotId: string | null;
  aggregateHash: string;
  environmentId: string;
  hostname: string;
  platform: GoogleDrivePlatform;
  appVersion: string;
  customPathRawPaths: string[];
  variants: SnapshotVariant[];
  files: SnapshotFile[];
  createdAt?: string;
  updatedAt?: string;
}

export const buildGoogleDriveManifest = (
  input: BuildGoogleDriveManifestInput
): GoogleDriveStorageManifest => {
  if (!isNonEmptyString(input.objectId)) {
    throw new GoogleDriveManifestInvalidError(
      "Google Drive manifest object id is required"
    );
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new GoogleDriveManifestInvalidError(
      "Google Drive manifest version must be a positive integer"
    );
  }
  if (!CLOUD_SAVE_HASH_PATTERN.test(input.aggregateHash)) {
    throw new GoogleDriveManifestInvalidError(
      "Google Drive manifest hash is invalid"
    );
  }

  const updatedAt = input.updatedAt ?? new Date().toISOString();

  return {
    schemaVersion: GOOGLE_DRIVE_MANIFEST_SCHEMA_VERSION,
    provider: GOOGLE_DRIVE_PROVIDER,
    shop: input.shop,
    objectId: input.objectId,
    version: input.version,
    previousSnapshotId: input.previousSnapshotId,
    aggregateHash: input.aggregateHash,
    createdAt: input.createdAt ?? updatedAt,
    updatedAt,
    environmentId: input.environmentId,
    hostname: input.hostname,
    platform: input.platform,
    appVersion: input.appVersion,
    customPathRawPaths: [...input.customPathRawPaths].sort((left, right) =>
      left.localeCompare(right)
    ),
    variants: input.variants,
    files: input.files,
  };
};

export const parseGoogleDriveManifest = (
  value: unknown
): GoogleDriveStorageManifest => {
  // Shared Cloud Save validators guarantee the rest of the manifest shape, so
  // every rejection is reported as one manifest error the engine can classify.
  if (!isRecord(value)) {
    throw new GoogleDriveManifestInvalidError();
  }

  const unexpectedKey = Object.keys(value).find(
    (key) => !(MANIFEST_KEYS as readonly string[]).includes(key)
  );
  if (unexpectedKey) {
    throw new GoogleDriveManifestInvalidError(
      `Unexpected Google Drive manifest field: ${unexpectedKey}`
    );
  }
  const missingKey = MANIFEST_KEYS.find((key) => !(key in value));
  if (missingKey) {
    throw new GoogleDriveManifestInvalidError(
      `Missing Google Drive manifest field: ${missingKey}`
    );
  }

  if (
    value.schemaVersion !== GOOGLE_DRIVE_MANIFEST_SCHEMA_VERSION ||
    value.provider !== GOOGLE_DRIVE_PROVIDER
  ) {
    throw new GoogleDriveManifestInvalidError(
      "Unsupported Google Drive manifest version"
    );
  }
  if (!isGameShop(value.shop) || !isNonEmptyString(value.objectId)) {
    throw new GoogleDriveManifestInvalidError(
      "Invalid Google Drive manifest game identity"
    );
  }
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    throw new GoogleDriveManifestInvalidError(
      "Invalid Google Drive manifest version"
    );
  }
  if (
    value.previousSnapshotId !== null &&
    !isNonEmptyString(value.previousSnapshotId)
  ) {
    throw new GoogleDriveManifestInvalidError(
      "Invalid Google Drive manifest previous snapshot id"
    );
  }
  if (
    !isNonEmptyString(value.aggregateHash) ||
    !CLOUD_SAVE_HASH_PATTERN.test(value.aggregateHash)
  ) {
    throw new GoogleDriveManifestInvalidError(
      "Invalid Google Drive manifest hash"
    );
  }
  if (!isIsoDateString(value.createdAt) || !isIsoDateString(value.updatedAt)) {
    throw new GoogleDriveManifestInvalidError(
      "Invalid Google Drive manifest timestamps"
    );
  }
  if (
    !isNonEmptyString(value.environmentId) ||
    !isNonEmptyString(value.hostname) ||
    !isNonEmptyString(value.appVersion)
  ) {
    throw new GoogleDriveManifestInvalidError(
      "Invalid Google Drive manifest environment"
    );
  }
  if (!isPlatform(value.platform)) {
    throw new GoogleDriveManifestInvalidError(
      "Invalid Google Drive manifest platform"
    );
  }

  let customPathRawPaths: string[];
  let variants: SnapshotVariant[];
  let files: SnapshotFile[];
  try {
    customPathRawPaths = validateCustomPathRawPaths(value.customPathRawPaths);
    variants = validateSnapshotVariants(value.variants, value.shop);
    files = validateSnapshotFiles(value.files, variants);
  } catch (error) {
    throw new GoogleDriveManifestInvalidError(
      error instanceof Error
        ? `Invalid Google Drive manifest: ${error.message}`
        : undefined
    );
  }

  const activeCustomPaths = new Set(customPathRawPaths);
  if (
    files.some(
      (file) =>
        file.rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX) &&
        !activeCustomPaths.has(file.rawPath)
    )
  ) {
    throw new GoogleDriveManifestInvalidError(
      "Google Drive manifest references an inactive custom path"
    );
  }

  // Every key and value above is validated, so the shape is now known.
  return value as unknown as GoogleDriveStorageManifest;
};

export const toGoogleDriveSnapshotSummary = (
  ref: GoogleDriveManifestRef
): RemoteSnapshotSummary => ({
  id: ref.fileId,
  version: ref.manifest.version,
  createdAt: ref.manifest.createdAt,
  updatedAt: ref.manifest.updatedAt,
  fileCount: ref.manifest.files.length,
  totalSizeBytes: ref.manifest.files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  ),
  aggregateHash: ref.manifest.aggregateHash,
  provider: GOOGLE_DRIVE_PROVIDER,
});

export const toGoogleDriveRestoreManifest = (
  ref: GoogleDriveManifestRef
): RestoreManifestResponse => ({
  snapshot: {
    id: ref.fileId,
    version: ref.manifest.version,
    shop: ref.manifest.shop,
    objectId: ref.manifest.objectId,
  },
  customPathRawPaths: [...ref.manifest.customPathRawPaths],
  variants: ref.manifest.variants,
  files: ref.manifest.files,
});
