import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { logger } from "../logger.js";
import { GoogleDriveStorage } from "./google-drive-storage.js";

/**
 * Fork: media that used to live on Hydra's object store (screenshots, souvenir
 * images, custom artwork) is stored as a content-addressed blob in the user's
 * own Drive. The key keeps the extension so the renderer's `local:` protocol
 * can serve the cached file with the right MIME type.
 */
export const GOOGLE_DRIVE_MEDIA_KEY_PATTERN =
  /^([a-f0-9]{64})\.([a-z0-9]{1,8})$/;

const MEDIA_CACHE_FOLDER = "google-drive-media";
const MEDIA_TEMP_FOLDER = "hydra-drive-media";

const getCacheDirectory = () =>
  path.join(app.getPath("userData"), MEDIA_CACHE_FOLDER);

const getTempDirectory = () =>
  path.join(app.getPath("temp"), MEDIA_TEMP_FOLDER);

const sanitizeExtension = (extension: string) => {
  const normalized = extension.trim().toLowerCase().replace(/^\./, "");
  return /^[a-z0-9]{1,8}$/.test(normalized) ? normalized : "bin";
};

export const parseGoogleDriveMediaKey = (key: string) => {
  const match = GOOGLE_DRIVE_MEDIA_KEY_PATTERN.exec(key);
  return match ? { hash: match[1], extension: match[2] } : null;
};

export const isGoogleDriveMediaKey = (key: string) =>
  parseGoogleDriveMediaKey(key) !== null;

/** Uploads the bytes unless an identical blob already exists. */
export const uploadGoogleDriveMedia = async (params: {
  data: Buffer;
  extension: string;
}): Promise<string> => {
  const extension = sanitizeExtension(params.extension);
  const hash = createHash("sha256").update(params.data).digest("hex");
  const tempDirectory = getTempDirectory();
  const tempPath = path.join(tempDirectory, `${hash}.${extension}`);

  await fs.promises.mkdir(tempDirectory, { recursive: true });
  await fs.promises.writeFile(tempPath, params.data);

  try {
    await GoogleDriveStorage.uploadBlob({
      hash,
      absolutePath: tempPath,
      sizeBytes: params.data.byteLength,
    });
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
  }

  return `${hash}.${extension}`;
};

/**
 * Downloads a media blob to the local cache once and returns the cached path.
 * Returns null when the key is not Drive media or the blob cannot be fetched
 * (offline, disconnected, deleted from Drive).
 */
export const ensureGoogleDriveMediaCached = async (
  key: string
): Promise<string | null> => {
  const parsed = parseGoogleDriveMediaKey(key);
  if (!parsed) return null;

  const cacheDirectory = getCacheDirectory();
  const destinationPath = path.join(cacheDirectory, key);

  try {
    await fs.promises.access(destinationPath);
    return destinationPath;
  } catch {
    // Not cached yet.
  }

  await fs.promises.mkdir(cacheDirectory, { recursive: true });

  try {
    await GoogleDriveStorage.downloadBlob({
      hash: parsed.hash,
      destinationPath,
    });
    return destinationPath;
  } catch (error) {
    await fs.promises
      .rm(destinationPath, { force: true })
      .catch(() => undefined);
    logger.warn("Could not cache Google Drive media", { key, error });
    return null;
  }
};

/** Resolves a blob key to a URL the renderer can load. */
export const resolveGoogleDriveMediaUrl = async (
  key: string
): Promise<string | null> => {
  const cachedPath = await ensureGoogleDriveMediaCached(key);
  return cachedPath ? `local:${encodeURI(cachedPath)}` : null;
};
