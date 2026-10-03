import type { GoogleDriveAccount } from "@types";

interface PendingGoogleDriveConnect {
  promise: Promise<GoogleDriveAccount>;
}

let pendingConnect: PendingGoogleDriveConnect | null = null;

export const getPendingGoogleDriveConnect = () => pendingConnect;

/**
 * Keeps the authorization flow observable after the card unmounts, so returning
 * to settings still shows it as pending and still reports its outcome.
 */
export const runGoogleDriveConnect = (
  connect: () => Promise<GoogleDriveAccount>
) => {
  const promise: Promise<GoogleDriveAccount> = connect().finally(() => {
    if (pendingConnect?.promise === promise) pendingConnect = null;
  });

  pendingConnect = { promise };

  return promise;
};
