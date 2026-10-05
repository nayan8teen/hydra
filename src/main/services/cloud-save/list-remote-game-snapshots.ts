import type { GameShop, RemoteSnapshotSummary } from "@types";

import { GoogleDriveStorage } from "../google-drive";
import { buildRemoteSnapshotSummaries } from "./remote-snapshot-list";

/**
 * A game's Drive snapshots: the head manifest is the current snapshot, with the
 * manifest history as older versions. History is still surfaced when the head
 * manifest is missing, so a restorable cloud save is never reported as absent.
 */
export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> => {
  const { head, history } = await GoogleDriveStorage.listGameManifests(
    shop,
    objectId
  );
  return buildRemoteSnapshotSummaries(head, history);
};
