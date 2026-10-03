import {
  cloudSaveCustomPathsSublevel,
  cloudSaveLocalHashCacheSublevel,
  cloudSaveSyncAnchorsSublevel,
  db,
  levelKeys,
} from "@main/level";
import type { GameShop } from "@types";

import { isCloudSaveSyncAnchorKeyForAnyIdentity } from "./sync-anchor-key";

export const clearCloudSaveLocalState = async (
  objectId: string,
  shop: GameShop,
  customPathStorageKey: string
) => {
  const cacheKey = levelKeys.game(shop, objectId);
  const anchorKeys: string[] = [];
  for await (const [key] of cloudSaveSyncAnchorsSublevel.iterator()) {
    if (isCloudSaveSyncAnchorKeyForAnyIdentity(key, shop, objectId)) {
      anchorKeys.push(key);
    }
  }

  const batch = db.batch();
  batch.del(customPathStorageKey, {
    sublevel: cloudSaveCustomPathsSublevel,
  });
  batch.del(cacheKey, {
    sublevel: cloudSaveLocalHashCacheSublevel,
  });
  for (const anchorKey of anchorKeys) {
    batch.del(anchorKey, {
      sublevel: cloudSaveSyncAnchorsSublevel,
    });
  }
  await batch.write();
};
