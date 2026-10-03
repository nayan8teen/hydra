import type { GameShop, UnlockedAchievement } from "@types";

export const GOOGLE_DRIVE_ACHIEVEMENTS_SCHEMA_VERSION = 1;

/** Fork: replaces the Hydra Cloud `UpdatedUnlockedAchievements` record. */
export interface GoogleDriveUnlockedAchievementsDocument {
  schemaVersion: 1;
  shop: GameShop;
  objectId: string;
  achievements: UnlockedAchievement[];
  updatedAt: string;
}

const maxNullable = (
  left: number | null | undefined,
  right: number | null | undefined
) => {
  if (left == null) return right ?? null;
  if (right == null) return left;
  return Math.max(left, right);
};

/**
 * Unions two unlock lists by achievement name. The later unlock time wins and
 * the hardcore time / souvenir image key are preserved from whichever side
 * has them.
 */
export const mergeGoogleDriveUnlockedAchievements = (
  remote: UnlockedAchievement[],
  local: UnlockedAchievement[]
): UnlockedAchievement[] => {
  const byName = new Map<string, UnlockedAchievement>();

  for (const achievement of [...remote, ...local]) {
    const key = achievement.name.toUpperCase();
    const current = byName.get(key);
    if (!current) {
      byName.set(key, achievement);
      continue;
    }

    byName.set(key, {
      name:
        achievement.unlockTime >= current.unlockTime
          ? achievement.name
          : current.name,
      unlockTime: Math.max(current.unlockTime, achievement.unlockTime),
      hardcoreUnlockTime: maxNullable(
        current.hardcoreUnlockTime,
        achievement.hardcoreUnlockTime
      ),
      imageKey: current.imageKey ?? achievement.imageKey ?? null,
    });
  }

  return [...byName.values()];
};
