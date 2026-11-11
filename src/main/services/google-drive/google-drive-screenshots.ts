import type {
  GameShop,
  ProfileVisibility,
  ScreenshotQuality,
  ScreenshotShop,
} from "@types";

import { googleDriveDocuments } from "./google-drive-documents-instance.js";
import {
  googleDriveGameDocumentName,
  type GoogleDriveDocumentRef,
} from "./google-drive-documents.js";

export const GOOGLE_DRIVE_SCREENSHOTS_SCHEMA_VERSION = 1;

export interface GoogleDriveScreenshotEntry {
  clientId: string;
  imageKey: string;
  thumbnailKey: string;
  width: number;
  height: number;
  capturedAt: number;
  uploadedAt: number;
  quality: ScreenshotQuality;
  gameTitle: string;
  customGameTitle: string | null;
  description: string | null;
  isSpoiler: boolean;
  visibility: ProfileVisibility;
  commentsEnabled: boolean;
}

export interface GoogleDriveScreenshotsDocument {
  schemaVersion: number;
  shop: ScreenshotShop;
  objectId: string | null;
  updatedAt: string;
  screenshots: GoogleDriveScreenshotEntry[];
}

const documentName = (shop: ScreenshotShop, objectId: string | null) =>
  googleDriveGameDocumentName("screenshots", shop, objectId ?? "custom");

export const readGoogleDriveScreenshots = async (
  shop: ScreenshotShop,
  objectId: string | null
): Promise<GoogleDriveScreenshotEntry[]> => {
  const document =
    await googleDriveDocuments.read<GoogleDriveScreenshotsDocument>(
      documentName(shop, objectId)
    );
  return document?.content.screenshots ?? [];
};

export const saveGoogleDriveScreenshot = async (
  entry: GoogleDriveScreenshotEntry & {
    shop: ScreenshotShop;
    objectId: string | null;
  }
): Promise<void> => {
  await googleDriveDocuments.update<GoogleDriveScreenshotsDocument>(
    documentName(entry.shop, entry.objectId),
    (current) => ({
      schemaVersion: GOOGLE_DRIVE_SCREENSHOTS_SCHEMA_VERSION,
      shop: entry.shop,
      objectId: entry.objectId,
      updatedAt: new Date().toISOString(),
      screenshots: [
        ...(current?.screenshots ?? []).filter(
          (screenshot) => screenshot.clientId !== entry.clientId
        ),
        {
          clientId: entry.clientId,
          imageKey: entry.imageKey,
          thumbnailKey: entry.thumbnailKey,
          width: entry.width,
          height: entry.height,
          capturedAt: entry.capturedAt,
          uploadedAt: entry.uploadedAt,
          quality: entry.quality,
          gameTitle: entry.gameTitle,
          customGameTitle: entry.customGameTitle,
          description: entry.description,
          isSpoiler: entry.isSpoiler,
          visibility: entry.visibility,
          commentsEnabled: entry.commentsEnabled,
        },
      ],
    })
  );
};

export const deleteGoogleDriveScreenshot = async (
  shop: GameShop | ScreenshotShop,
  objectId: string | null,
  clientId: string
): Promise<void> => {
  const name = documentName(shop, objectId);
  const document =
    await googleDriveDocuments.read<GoogleDriveScreenshotsDocument>(name);
  if (!document) return;

  const screenshots = document.content.screenshots.filter(
    (screenshot) => screenshot.clientId !== clientId
  );
  if (screenshots.length === document.content.screenshots.length) return;

  if (screenshots.length === 0) {
    await googleDriveDocuments.remove(name);
    return;
  }

  const next: GoogleDriveScreenshotsDocument = {
    ...document.content,
    updatedAt: new Date().toISOString(),
    screenshots,
  };
  await googleDriveDocuments.write(name, next);
};

export type GoogleDriveScreenshotsRef =
  GoogleDriveDocumentRef<GoogleDriveScreenshotsDocument>;
