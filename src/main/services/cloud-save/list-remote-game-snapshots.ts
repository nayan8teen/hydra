import type { GameShop, RemoteSnapshotSummary } from "@types";

import { GoogleDriveStorage } from "../google-drive";
import { toGoogleDriveSnapshotSummary } from "../google-drive/google-drive-manifest";

/** A game has at most one Drive snapshot: its head manifest. */
export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> => {
  const manifestRef = await GoogleDriveStorage.readManifest(shop, objectId);
  if (!manifestRef) return [];
  const history = await GoogleDriveStorage.listManifestHistory(shop, objectId);
  const unique = new Map<number, (typeof history)[number]>();
  for (const ref of history) unique.set(ref.manifest.version, ref);
  unique.set(manifestRef.manifest.version, manifestRef);
  return [...unique.values()]
    .sort((left, right) => right.manifest.version - left.manifest.version)
    .map(toGoogleDriveSnapshotSummary);
};
