import type {
  CloudSaveBulkSyncProgress,
  CloudSaveBulkSyncResult,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

export interface CloudSaveBulkSyncGame {
  objectId: string;
  shop: GameShop;
  title: string;
}

export interface CloudSaveBulkSyncDeps {
  listGames: () => Promise<CloudSaveBulkSyncGame[]>;
  canSync: (objectId: string, shop: GameShop) => Promise<boolean>;
  sync: (objectId: string, shop: GameShop) => Promise<SyncGameCloudSaveResult>;
  onGameError?: (game: CloudSaveBulkSyncGame, error: unknown) => void;
}

/** A game that is running cannot sync; it is skipped, not reported as failed. */
export const isCloudSaveGameRunningError = (error: unknown) =>
  error instanceof Error && error.message === "cloud_save_game_running";

/**
 * Syncs games one after another, reporting progress after every game so a
 * single failure or a running game never aborts the rest of the pass.
 */
export const runCloudSaveBulkSyncWithDeps = async (
  deps: CloudSaveBulkSyncDeps,
  onProgress: (progress: CloudSaveBulkSyncProgress) => void
): Promise<CloudSaveBulkSyncResult> => {
  const games = await deps.listGames();
  const progress: CloudSaveBulkSyncProgress = {
    processed: 0,
    total: games.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    conflicts: 0,
    currentLabel: null,
  };
  onProgress({ ...progress });

  for (const game of games) {
    progress.currentLabel = game.title;
    onProgress({ ...progress });

    const canSync = await deps
      .canSync(game.objectId, game.shop)
      .catch(() => false);
    if (!canSync) {
      progress.skipped += 1;
    } else {
      try {
        const result = await deps.sync(game.objectId, game.shop);
        if (result.action === "conflict") progress.conflicts += 1;
        else progress.synced += 1;
      } catch (error) {
        if (isCloudSaveGameRunningError(error)) {
          progress.skipped += 1;
        } else {
          progress.failed += 1;
          deps.onGameError?.(game, error);
        }
      }
    }

    progress.processed += 1;
    onProgress({ ...progress });
  }

  return {
    total: progress.total,
    synced: progress.synced,
    skipped: progress.skipped,
    failed: progress.failed,
    conflicts: progress.conflicts,
  };
};
