import type { GameShop, UnlockedAchievement } from "@types";

import {
  GOOGLE_DRIVE_ACHIEVEMENTS_SCHEMA_VERSION,
  mergeGoogleDriveUnlockedAchievements,
  type GoogleDriveUnlockedAchievementsDocument,
} from "./google-drive-achievements-merge.js";
import { googleDriveDocuments } from "./google-drive-documents-instance.js";
import { googleDriveGameDocumentName } from "./google-drive-documents.js";

export {
  GOOGLE_DRIVE_ACHIEVEMENTS_SCHEMA_VERSION,
  mergeGoogleDriveUnlockedAchievements,
  type GoogleDriveUnlockedAchievementsDocument,
};

const DOCUMENT_PREFIX = "achievements";

export const getGoogleDriveAchievementsDocumentName = (
  shop: GameShop,
  objectId: string
) => googleDriveGameDocumentName(DOCUMENT_PREFIX, shop, objectId);

export const readGoogleDriveUnlockedAchievements = async (
  shop: GameShop,
  objectId: string
): Promise<UnlockedAchievement[]> => {
  const document =
    await googleDriveDocuments.read<GoogleDriveUnlockedAchievementsDocument>(
      getGoogleDriveAchievementsDocumentName(shop, objectId)
    );

  return document?.content.achievements ?? [];
};

/**
 * Merges the local unlocks into the Drive document and returns the merged
 * list, so the caller can reconcile its in-memory state with what is now
 * persisted.
 */
export const syncGoogleDriveUnlockedAchievements = async (
  shop: GameShop,
  objectId: string,
  achievements: UnlockedAchievement[]
): Promise<UnlockedAchievement[]> => {
  const document =
    await googleDriveDocuments.update<GoogleDriveUnlockedAchievementsDocument>(
      getGoogleDriveAchievementsDocumentName(shop, objectId),
      (current) => ({
        schemaVersion: GOOGLE_DRIVE_ACHIEVEMENTS_SCHEMA_VERSION,
        shop,
        objectId,
        achievements: mergeGoogleDriveUnlockedAchievements(
          current?.achievements ?? [],
          achievements
        ),
        updatedAt: new Date().toISOString(),
      })
    );

  return document.content.achievements;
};

export const deleteGoogleDriveUnlockedAchievements = async (
  shop: GameShop,
  objectId: string
) =>
  googleDriveDocuments.remove(
    getGoogleDriveAchievementsDocumentName(shop, objectId)
  );
