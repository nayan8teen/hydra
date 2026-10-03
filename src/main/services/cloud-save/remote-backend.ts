import { isCloudSaveV2Eligible } from "@shared";
import type { CloudSaveRemoteProvider, GameShop } from "@types";

import { gamesSublevel, levelKeys } from "@main/level";
import {
  GoogleDriveAuth,
  GoogleDriveNotConnectedError,
  GoogleDriveService,
} from "../google-drive";
import { getCloudSaveAnchorIdentity } from "./cloud-save-provider-policy.js";

export type { CloudSaveRemoteProvider };
export {
  getCloudSaveProviderForSnapshot,
  normalizeCloudSaveProvider,
} from "./cloud-save-provider-policy.js";

/**
 * Fork: Google Drive is the only cloud-save remote. "Enabled" means the user
 * turned Drive sync on *and* an account is connected.
 */
export const isGoogleDriveCloudSaveEnabled = () =>
  GoogleDriveService.isSyncEnabled();

/**
 * Drive is the only backend. Games the sync engine cannot handle still fall
 * back to the Hydra label so their snapshots stay inert rather than being
 * read from Drive.
 */
export const resolveCloudSaveProvider = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveRemoteProvider> => {
  if (!(await isGoogleDriveCloudSaveEnabled())) return "hydra";

  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  if (!game || !isCloudSaveV2Eligible(shop, game.platform)) return "hydra";

  return "google-drive";
};

/**
 * A connected Drive account is by itself enough access: Drive users do not
 * need a Hydra login or an active subscription.
 */
export const assertCloudSaveRemoteAccess = async (
  provider?: CloudSaveRemoteProvider | null
) => {
  if (provider === "hydra" || !(await isGoogleDriveCloudSaveEnabled())) {
    throw new GoogleDriveNotConnectedError(
      "Google Drive save sync is not enabled or not connected"
    );
  }
};

export const canAccessCloudSaveRemote = async (
  provider: CloudSaveRemoteProvider
) => (provider === "google-drive" ? isGoogleDriveCloudSaveEnabled() : false);

/**
 * Anchor identity for the only backend: the connected Google account, so a
 * Drive-only user never needs a Hydra login to sync.
 */
export const getCloudSaveAnchorIdentityForProvider = async (
  provider: CloudSaveRemoteProvider,
  hydraUserId: string
) => {
  const status = await GoogleDriveAuth.getStatus();
  return getCloudSaveAnchorIdentity({
    provider,
    hydraUserId,
    driveAccountEmail: status.account?.email ?? null,
  });
};
