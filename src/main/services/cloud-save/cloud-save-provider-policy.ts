import type { CloudSaveRemoteProvider } from "@types";

export const DEFAULT_CLOUD_SAVE_REMOTE_PROVIDER: CloudSaveRemoteProvider =
  "hydra";

/** Snapshots from older builds carry no provider and are Hydra snapshots. */
export const normalizeCloudSaveProvider = (
  provider?: CloudSaveRemoteProvider | null
): CloudSaveRemoteProvider => provider ?? DEFAULT_CLOUD_SAVE_REMOTE_PROVIDER;

export const getCloudSaveProviderForSnapshot = (snapshot: {
  provider?: CloudSaveRemoteProvider;
}): CloudSaveRemoteProvider => normalizeCloudSaveProvider(snapshot.provider);

export const shouldUseGoogleDriveCloudSave = (params: {
  driveSyncEnabled: boolean;
  driveConnected: boolean;
}): boolean => params.driveSyncEnabled && params.driveConnected;

/**
 * Sync anchors are scoped per remote backend: Hydra anchors are keyed by the
 * Hydra account and Drive anchors by the Google account, so both can coexist
 * and a backend switch never reads the other backend's base state.
 */
export const getCloudSaveAnchorIdentity = (params: {
  provider: CloudSaveRemoteProvider;
  hydraUserId: string;
  driveAccountEmail?: string | null;
}): string =>
  params.provider === "google-drive"
    ? `google-drive:${params.driveAccountEmail ?? "unknown-account"}`
    : params.hydraUserId;
