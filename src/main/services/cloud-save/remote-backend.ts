import { isCloudSaveV2Eligible } from "@shared";
import type { CloudSaveRemoteProvider, GameShop } from "@types";

import { gamesSublevel, levelKeys } from "@main/level";
import {
  getGoogleDriveSettings,
  GoogleDriveAuth,
  GoogleDriveNotConnectedError,
} from "../google-drive";
import {
  assertCloudSaveSubscription,
  canAccessCloudSavesNow,
} from "./cloud-save-access.js";
import {
  getCloudSaveAnchorIdentity,
  getCloudSaveProviderForSnapshot,
  normalizeCloudSaveProvider,
  shouldUseGoogleDriveCloudSave,
} from "./cloud-save-provider-policy.js";

export type { CloudSaveRemoteProvider };
export { getCloudSaveProviderForSnapshot, normalizeCloudSaveProvider };

/**
 * Google Drive is the active remote only while the user enabled Drive sync and
 * an account is connected; anything else keeps using Hydra unchanged.
 */
export const isGoogleDriveCloudSaveEnabled = async () => {
  const [settings, driveConnected] = await Promise.all([
    getGoogleDriveSettings(),
    GoogleDriveAuth.isConnected(),
  ]);

  return shouldUseGoogleDriveCloudSave({
    driveSyncEnabled: settings.driveSyncEnabled,
    driveConnected,
  });
};

/** Resolves which remote backend owns a game's cloud saves right now. */
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
  if (normalizeCloudSaveProvider(provider) !== "google-drive") {
    assertCloudSaveSubscription();
    return;
  }
  if (!(await isGoogleDriveCloudSaveEnabled())) {
    throw new GoogleDriveNotConnectedError(
      "Google Drive save sync is not enabled or not connected"
    );
  }
};

/**
 * Automatic sync needs the same access as the manual flow: a Hydra login and
 * subscription, or simply a connected Drive account.
 */
export const canAccessCloudSaveRemote = async (
  provider: CloudSaveRemoteProvider
) =>
  provider === "google-drive"
    ? isGoogleDriveCloudSaveEnabled()
    : canAccessCloudSavesNow();

/**
 * Anchor identity for the active backend: the Hydra account for Hydra and the
 * Google account for Drive, so both backends' anchors coexist per game.
 */
export const getCloudSaveAnchorIdentityForProvider = async (
  provider: CloudSaveRemoteProvider,
  hydraUserId: string
) => {
  if (provider !== "google-drive") {
    return getCloudSaveAnchorIdentity({ provider, hydraUserId });
  }

  const status = await GoogleDriveAuth.getStatus();
  return getCloudSaveAnchorIdentity({
    provider,
    hydraUserId,
    driveAccountEmail: status.account?.email ?? null,
  });
};
