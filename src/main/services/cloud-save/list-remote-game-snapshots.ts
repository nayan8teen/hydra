import { HydraApi } from "@main/services/hydra-api";
import type { GameShop, RemoteSnapshotSummary } from "@types";

import { GoogleDriveStorage } from "../google-drive";
import { toGoogleDriveSnapshotSummary } from "../google-drive/google-drive-manifest";
import { validateRemoteSnapshotSummary } from "./cloud-save-contract";
import { resolveCloudSaveProvider } from "./remote-backend";

const validateRemoteSnapshots = (value: unknown): RemoteSnapshotSummary[] => {
  if (!Array.isArray(value)) throw new Error("Invalid snapshots response");
  if (value.length > 1) {
    throw new Error("Cloud Save API returned more than one active snapshot");
  }
  return value.map(validateRemoteSnapshotSummary);
};

const listHydraRemoteGameSnapshots = async (objectId: string, shop: GameShop) =>
  validateRemoteSnapshots(
    await HydraApi.get<unknown>(
      "/profile/cloud-saves/snapshots",
      {
        shop,
        objectId,
      },
      {
        needsAuth: true,
        needsSubscription: true,
      }
    )
  );

/** A game has at most one Drive snapshot: its head manifest. */
const listGoogleDriveRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> => {
  const manifestRef = await GoogleDriveStorage.readManifest(shop, objectId);
  return manifestRef ? [toGoogleDriveSnapshotSummary(manifestRef)] : [];
};

export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> =>
  (await resolveCloudSaveProvider(objectId, shop)) === "google-drive"
    ? listGoogleDriveRemoteGameSnapshots(objectId, shop)
    : listHydraRemoteGameSnapshots(objectId, shop);
