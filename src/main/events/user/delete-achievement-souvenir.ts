import type { GameShop } from "@types";

import { registerEvent } from "../register-event";
import { GoogleDriveService } from "@main/services/google-drive/google-drive-service";
import { clearGoogleDriveSouvenirImage } from "@main/services/google-drive/google-drive-souvenirs";
import { AchievementSouvenirStore } from "@main/services/achievements/achievement-souvenir-store";
import { UnlockedAchievementsCache } from "@main/services/achievements/unlocked-achievements-cache";
import { achievementsLogger } from "@main/services/logger";
import { deleteLocalSouvenirAsset } from "@main/services/achievements/grouped-souvenir-worker";

interface DeleteAchievementSouvenirPayload {
  souvenirId: string;
}

export const parseDriveSouvenirId = (souvenirId: string) => {
  const firstSeparator = souvenirId.indexOf(":");
  const secondSeparator = souvenirId.indexOf(":", firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) return null;

  const imageKey = souvenirId.slice(secondSeparator + 1);
  if (!imageKey) return null;

  return {
    shop: souvenirId.slice(0, firstSeparator) as GameShop,
    objectId: souvenirId.slice(firstSeparator + 1, secondSeparator),
    imageKey,
  };
};

const deleteAchievementSouvenir = async (
  _event: Electron.IpcMainInvokeEvent,
  { souvenirId }: DeleteAchievementSouvenirPayload
) => {
  const target = parseDriveSouvenirId(souvenirId);

  if (target && (await GoogleDriveService.isSyncEnabled())) {
    await clearGoogleDriveSouvenirImage(
      target.shop,
      target.objectId,
      target.imageKey
    );
  }

  AchievementSouvenirStore.clear();
  UnlockedAchievementsCache.clear();

  await deleteLocalSouvenirAsset(souvenirId).catch((error) => {
    achievementsLogger.error(
      "Failed to delete local achievement souvenir",
      souvenirId,
      error
    );
  });
};

registerEvent("deleteAchievementSouvenir", deleteAchievementSouvenir);
