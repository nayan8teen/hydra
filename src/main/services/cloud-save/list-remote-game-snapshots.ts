import type { GameShop, RemoteSnapshotSummary } from "@types";

import { GoogleDriveStorage } from "../google-drive";
import { toGoogleDriveSnapshotSummary } from "../google-drive/google-drive-manifest";

/** A game has at most one Drive snapshot: its head manifest. */
export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> => {
  const manifestRef = await GoogleDriveStorage.readManifest(shop, objectId);
  return manifestRef ? [toGoogleDriveSnapshotSummary(manifestRef)] : [];
};
