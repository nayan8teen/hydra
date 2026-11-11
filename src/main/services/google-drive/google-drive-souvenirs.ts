import type { GameShop } from "@types";

import {
  getGoogleDriveAchievementsDocumentName,
  GOOGLE_DRIVE_ACHIEVEMENTS_SCHEMA_VERSION,
  type GoogleDriveUnlockedAchievementsDocument,
} from "./google-drive-achievements.js";
import { googleDriveDocuments } from "./google-drive-documents-instance.js";

/**
 * Fork: removing a souvenir means dropping its image key from the unlock
 * record stored in the user's Drive. The blob is content-addressed and may be
 * shared by several achievements, so it is left in place.
 */
export const clearGoogleDriveSouvenirImage = async (
  shop: GameShop,
  objectId: string,
  imageKey: string
) => {
  await googleDriveDocuments.update<GoogleDriveUnlockedAchievementsDocument>(
    getGoogleDriveAchievementsDocumentName(shop, objectId),
    (current) => ({
      schemaVersion: GOOGLE_DRIVE_ACHIEVEMENTS_SCHEMA_VERSION,
      shop,
      objectId,
      achievements: (current?.achievements ?? []).map((achievement) =>
        achievement.imageKey === imageKey
          ? {
              name: achievement.name,
              unlockTime: achievement.unlockTime,
              hardcoreUnlockTime: achievement.hardcoreUnlockTime,
            }
          : achievement
      ),
      updatedAt: new Date().toISOString(),
    })
  );
};
