import type { ArtworkAssetType, Game, GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

import { updateGameRecord } from "../game-record-updater";
import { logger } from "../logger";
import { readGoogleDriveArtwork } from "./google-drive-artwork";
import { resolveGoogleDriveMediaUrl } from "./google-drive-media";
import { GoogleDriveService } from "./google-drive-service";

const FIELD_BY_ASSET_TYPE: Record<
  ArtworkAssetType,
  | "customIconUrl"
  | "customLogoImageUrl"
  | "customHeroImageUrl"
  | "customCoverImageUrl"
> = {
  icon: "customIconUrl",
  logo: "customLogoImageUrl",
  hero: "customHeroImageUrl",
  grid: "customCoverImageUrl",
};

/**
 * Fork: artwork selections are stored in the user's Drive, so a machine with a
 * fresh library can repopulate them from the artwork document at startup or
 * right after the Drive account is connected.
 */
export const restoreGoogleDriveArtwork = async () => {
  try {
    if (!(await GoogleDriveService.isSyncEnabled())) return 0;

    const document = await readGoogleDriveArtwork();
    let restored = 0;

    for (const [gameKey, assets] of Object.entries(document.games)) {
      const separator = gameKey.indexOf(":");
      if (separator <= 0) continue;

      const shop = gameKey.slice(0, separator) as GameShop;
      const objectId = gameKey.slice(separator + 1);
      const key = levelKeys.game(shop, objectId);
      const game = await gamesSublevel.get(key).catch(() => null);
      if (!game || game.isDeleted) continue;

      const patch: Partial<Game> = {};
      for (const assetType of Object.keys(assets) as ArtworkAssetType[]) {
        const field = FIELD_BY_ASSET_TYPE[assetType];
        const entry = assets[assetType];
        if (!entry || game[field]) continue;

        const url =
          entry.kind === "url"
            ? entry.url
            : await resolveGoogleDriveMediaUrl(entry.imageKey).catch(
                () => null
              );
        if (!url) continue;

        patch[field] = url;
        restored += 1;
      }

      if (Object.keys(patch).length) {
        await updateGameRecord(key, patch);
      }
    }

    return restored;
  } catch (error) {
    logger.error("Failed to restore artwork from Google Drive", error);
    return 0;
  }
};
