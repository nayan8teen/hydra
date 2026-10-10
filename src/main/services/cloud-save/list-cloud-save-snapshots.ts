import type { CloudSaveHistorySnapshot, GameShop } from "@types";

import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import {
  assertCloudSaveRemoteAccess,
  resolveCloudSaveProvider,
} from "./remote-backend";

export const listCloudSaveSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveHistorySnapshot[]> => {
  await assertCloudSaveRemoteAccess(
    await resolveCloudSaveProvider(objectId, shop)
  );

  const history = await listRemoteGameSnapshots(objectId, shop);
  const head = history[0] ?? null;
  return history.map((snapshot) => ({
    ...snapshot,
    isHead: snapshot.id === head?.id,
  }));
};
