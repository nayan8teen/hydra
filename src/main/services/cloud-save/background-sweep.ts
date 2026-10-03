import type { GameShop } from "@types";

import { gamesSublevel } from "@main/level";

import { isGameRunning } from "../game-running-state";
import { getGoogleDriveSettings } from "../google-drive/google-drive-settings.js";
import { GoogleDriveService } from "../google-drive/google-drive-service.js";
import { logger } from "../logger";
import {
  canRunAutomaticCloudSaveSync,
  runAutomaticCloudSaveSyncDetailed,
} from "./automatic-sync";
import {
  getBackgroundCloudSaveSweepIntervalMs,
  isBackgroundCloudSaveSweepEnabled,
  shouldSkipGameForBackgroundSweep,
  shouldStartBackgroundCloudSaveSweep,
} from "./background-sweep-policy";
import { hasCloudSaveLaunchGuard } from "./launch-guard";

export interface BackgroundCloudSaveSweepResult {
  swept: number;
  skipped: number;
  failed: number;
}

let lastSweepStartedAt: number | null = null;

const sweepGame = async (objectId: string, shop: GameShop) => {
  if (
    shouldSkipGameForBackgroundSweep({
      isRunning: isGameRunning(objectId, shop),
      hasPendingLaunch: hasCloudSaveLaunchGuard(objectId, shop),
    })
  ) {
    return "skipped" as const;
  }

  const canSweep = await canRunAutomaticCloudSaveSync(objectId, shop).catch(
    () => false
  );
  if (!canSweep) return "skipped" as const;

  const outcome = await runAutomaticCloudSaveSyncDetailed(
    objectId,
    shop,
    "background-sweep"
  );

  if (outcome.status === "completed") return "swept" as const;
  if (outcome.status === "failed") return "failed" as const;
  return "skipped" as const;
};

/**
 * Best-effort sweep of every eligible game, one at a time. Failures are counted
 * instead of thrown so one broken game never stops the rest of the pass.
 */
export const runBackgroundCloudSaveSweep =
  async (): Promise<BackgroundCloudSaveSweepResult> => {
    const result: BackgroundCloudSaveSweepResult = {
      swept: 0,
      skipped: 0,
      failed: 0,
    };

    const games = await gamesSublevel.iterator().all();
    for (const [, game] of games) {
      const outcome = await sweepGame(game.objectId, game.shop);
      result[outcome] += 1;
    }

    return result;
  };

/**
 * Called from the main loop. Returns immediately unless Drive sync and the
 * opt-in sweep are both enabled and the configured interval has elapsed.
 */
export const runBackgroundCloudSaveSweepTick = async (): Promise<void> => {
  const settings = await getGoogleDriveSettings();

  if (
    !isBackgroundCloudSaveSweepEnabled(settings) ||
    !(await GoogleDriveService.isConnected())
  ) {
    // Re-enabling the sweep starts a fresh interval instead of an instant run.
    lastSweepStartedAt = null;
    return;
  }

  const now = Date.now();
  if (
    !shouldStartBackgroundCloudSaveSweep({
      now,
      lastStartedAt: lastSweepStartedAt,
      intervalMs: getBackgroundCloudSaveSweepIntervalMs(settings),
    })
  ) {
    return;
  }

  lastSweepStartedAt = now;
  const result = await runBackgroundCloudSaveSweep();

  if (result.swept > 0 || result.failed > 0) {
    logger.info("[Cloud Save] Background sweep finished", result);
  }
};
