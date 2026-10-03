import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnlockedAchievement } from "@types";

import { mergeGoogleDriveUnlockedAchievements } from "./google-drive-achievements-merge.js";

const unlock = (
  name: string,
  unlockTime: number,
  extra: Partial<UnlockedAchievement> = {}
): UnlockedAchievement => ({ name, unlockTime, ...extra });

describe("mergeGoogleDriveUnlockedAchievements", () => {
  it("unions unlocks from both sides", () => {
    const merged = mergeGoogleDriveUnlockedAchievements(
      [unlock("A", 100)],
      [unlock("B", 200)]
    );

    assert.deepEqual(merged.map((achievement) => achievement.name).sort(), [
      "A",
      "B",
    ]);
  });

  it("keeps the later unlock time for the same achievement", () => {
    const merged = mergeGoogleDriveUnlockedAchievements(
      [unlock("A", 500)],
      [unlock("a", 100)]
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0].unlockTime, 500);
    // The winning entry keeps its own casing.
    assert.equal(merged[0].name, "A");
  });

  it("preserves hardcore time and souvenir image key from either side", () => {
    const merged = mergeGoogleDriveUnlockedAchievements(
      [unlock("A", 100, { imageKey: "hash-1" })],
      [unlock("A", 200, { hardcoreUnlockTime: 300 })]
    );

    assert.equal(merged[0].unlockTime, 200);
    assert.equal(merged[0].hardcoreUnlockTime, 300);
    assert.equal(merged[0].imageKey, "hash-1");
  });

  it("returns the winning name casing when local is later", () => {
    const merged = mergeGoogleDriveUnlockedAchievements(
      [unlock("A", 100)],
      [unlock("a", 300)]
    );

    assert.equal(merged[0].name, "a");
    assert.equal(merged[0].unlockTime, 300);
  });

  it("handles an empty remote document", () => {
    const merged = mergeGoogleDriveUnlockedAchievements([], [unlock("A", 1)]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].hardcoreUnlockTime, undefined);
  });
});
