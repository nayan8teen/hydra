import type {
  GameShop,
  UnlockedAchievement,
  UserAchievement,
  UserPreferences,
} from "@types";
import { db, levelKeys } from "@main/level";
import {
  GoogleDriveService,
  readGoogleDriveUnlockedAchievements,
} from "@main/services/google-drive";
import { achievementsLogger } from "@main/services/logger";
import { resolveGoogleDriveMediaUrl } from "@main/services/google-drive/google-drive-media";
import { AchievementSouvenirStore } from "./achievement-souvenir-store";

interface RemoteUserGameAchievements {
  souvenirs: Map<string, string>;
  unlocked: UnlockedAchievement[];
  achievements: UserAchievement[];
}

const emptyRemoteUserGameAchievements = (): RemoteUserGameAchievements => ({
  souvenirs: new Map<string, string>(),
  unlocked: [],
  achievements: [],
});

/**
 * Fork: the user's unlocked achievements live in their own Google Drive.
 * Souvenir image keys are carried on the achievement entries; the matching
 * image URLs are resolved separately (see the grouped souvenir worker).
 */
export const fetchRemoteUserGameAchievements = async (
  objectId: string,
  shop: GameShop,
  _language?: string
): Promise<RemoteUserGameAchievements> => {
  try {
    if (!(await GoogleDriveService.isSyncEnabled())) {
      return emptyRemoteUserGameAchievements();
    }

    const unlocks = await readGoogleDriveUnlockedAchievements(shop, objectId);
    const souvenirs = new Map<string, string>();

    await Promise.all(
      unlocks.map(async (achievement) => {
        if (!achievement.imageKey) return;

        const url = await resolveGoogleDriveMediaUrl(
          achievement.imageKey
        ).catch(() => null);
        if (url) souvenirs.set(achievement.name.toUpperCase(), url);
      })
    );

    return {
      ...emptyRemoteUserGameAchievements(),
      unlocked: unlocks,
      souvenirs,
    };
  } catch (error) {
    achievementsLogger.error(
      "Failed to read unlocked achievements from Google Drive",
      objectId,
      error
    );

    return emptyRemoteUserGameAchievements();
  }
};

const fetchAchievementSouvenirs = async (
  objectId: string,
  shop: GameShop,
  language: string
) => {
  const remote = await fetchRemoteUserGameAchievements(
    objectId,
    shop,
    language
  );
  return remote.souvenirs;
};

export const getAchievementSouvenirs = async (
  objectId: string,
  shop: GameShop,
  language?: string
) => {
  const cachedSouvenirs = AchievementSouvenirStore.get(shop, objectId);

  if (cachedSouvenirs) return cachedSouvenirs;

  const resolvedLanguage =
    language ??
    (await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .then((preferences) => preferences?.language ?? "en")
      .catch(() => "en"));

  try {
    const souvenirs = await fetchAchievementSouvenirs(
      objectId,
      shop,
      resolvedLanguage
    );
    AchievementSouvenirStore.set(shop, objectId, souvenirs);

    return souvenirs;
  } catch (error) {
    achievementsLogger.error(
      "Failed to fetch achievement souvenirs",
      objectId,
      error
    );

    return new Map<string, string>();
  }
};
