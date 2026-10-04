/**
 * Fork: cloud saves are backed by the user's own Google Drive, so access
 * depends on a connected Drive account rather than a Hydra Cloud
 * subscription. There is no paywall state any more.
 */
export type CloudSaveAccessAction = "connect-drive" | "open";

export const getCloudSaveAccessAction = (
  driveConnected: boolean
): CloudSaveAccessAction => (driveConnected ? "open" : "connect-drive");
