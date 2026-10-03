import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as statusModule from "./achievements-sync-status.ts";

const { getAchievementsSyncStatus } = statusModule;

describe("achievements sync status", () => {
  it("shows the enabled notice when Drive sync is on and active", () => {
    assert.equal(
      getAchievementsSyncStatus({
        achievementsCount: 5,
        isLoading: false,
        isDriveSyncActive: true,
      }),
      "enabled"
    );
  });

  it("shows the warning when Drive sync is off or disconnected", () => {
    assert.equal(
      getAchievementsSyncStatus({
        achievementsCount: 5,
        isLoading: false,
        isDriveSyncActive: false,
      }),
      "disabled"
    );
  });

  it("hides the banner while the Drive status is still loading", () => {
    assert.equal(
      getAchievementsSyncStatus({
        achievementsCount: 5,
        isLoading: true,
        isDriveSyncActive: false,
      }),
      "hidden"
    );

    assert.equal(
      getAchievementsSyncStatus({
        achievementsCount: 5,
        isLoading: true,
        isDriveSyncActive: true,
      }),
      "hidden"
    );
  });

  it("hides the banner when the game has no achievements", () => {
    for (const isLoading of [false, true]) {
      for (const isDriveSyncActive of [false, true]) {
        assert.equal(
          getAchievementsSyncStatus({
            achievementsCount: 0,
            isLoading,
            isDriveSyncActive,
          }),
          "hidden"
        );
      }
    }
  });
});
