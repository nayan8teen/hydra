import fs from "node:fs";
import path from "node:path";

import { fileTypeFromFile } from "file-type";

import type { ArtworkAssetType, GameShop } from "@types";

import { GoogleDriveService } from "./google-drive/google-drive-service";
import { uploadGoogleDriveMedia } from "./google-drive/google-drive-media";
import {
  deleteGoogleDriveArtwork,
  setGoogleDriveArtwork,
} from "./google-drive/google-drive-artwork";
import { logger } from "./logger";

const MAX_ARTWORK_SIZE_IN_BYTES = 1024 * 1024 * 20;

const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

type AllowedImageExtension = (typeof ALLOWED_IMAGE_EXTENSIONS)[number];

const EXTENSION_BY_MIME: Record<string, AllowedImageExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const resolveLocalPath = (localUrl: string) =>
  localUrl.startsWith("local:") ? localUrl.slice("local:".length) : null;

const resolveImageExtension = async (
  localPath: string
): Promise<AllowedImageExtension | null> => {
  const rawExtension = path.extname(localPath).slice(1).toLowerCase();
  if ((ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(rawExtension)) {
    return rawExtension as AllowedImageExtension;
  }

  const fileType = await fileTypeFromFile(localPath);
  return fileType?.mime ? (EXTENSION_BY_MIME[fileType.mime] ?? null) : null;
};

// Fork: artwork follows the Google Drive connection instead of a paywalled
// Hydra Cloud subscription.
const canSyncArtwork = () => GoogleDriveService.isSyncEnabled();

export const uploadCustomArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType,
  localUrl: string
): Promise<void> => {
  if (!(await canSyncArtwork())) return;

  try {
    const localPath = resolveLocalPath(localUrl);
    if (!localPath) return;

    const stats = await fs.promises.stat(localPath).catch(() => null);
    if (!stats) return;

    if (stats.size <= 0 || stats.size > MAX_ARTWORK_SIZE_IN_BYTES) {
      logger.warn(
        `Skipping custom artwork upload for ${shop}/${objectId}: invalid size ${stats.size}`
      );
      return;
    }

    const imageExt = await resolveImageExtension(localPath);
    if (!imageExt) {
      logger.warn(
        `Skipping custom artwork upload for ${shop}/${objectId}: unsupported image type`
      );
      return;
    }

    const imageKey = await uploadGoogleDriveMedia({
      data: await fs.promises.readFile(localPath),
      extension: imageExt === "jpeg" ? "jpg" : imageExt,
    });

    await setGoogleDriveArtwork(shop, objectId, assetType, {
      kind: "upload",
      imageKey,
    });
  } catch (error) {
    logger.error(
      `Failed to sync custom artwork upload for ${shop}/${objectId}:`,
      error
    );
  }
};

export const saveSteamGridDbArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType,
  url: string
): Promise<boolean> => {
  if (!(await canSyncArtwork())) return false;

  try {
    await setGoogleDriveArtwork(shop, objectId, assetType, {
      kind: "url",
      url,
    });

    return true;
  } catch (error) {
    logger.error(
      `Failed to sync SteamGridDB artwork for ${shop}/${objectId}:`,
      error
    );

    return false;
  }
};

export const deleteCustomArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType
): Promise<void> => {
  if (!(await canSyncArtwork())) return;

  try {
    await deleteGoogleDriveArtwork(shop, objectId, assetType);
  } catch (error) {
    logger.error(
      `Failed to clear custom artwork for ${shop}/${objectId}:`,
      error
    );
  }
};
