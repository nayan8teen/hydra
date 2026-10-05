import type { CloudSaveSnapshotFiles, GameShop } from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets";
import { listCloudSaveSnapshots } from "./list-cloud-save-snapshots";

export const getCloudSaveSnapshotFiles = async (
  objectId: string,
  shop: GameShop,
  snapshotId: string
): Promise<CloudSaveSnapshotFiles> => {
  if (!snapshotId) throw new Error("cloud_save_restore_snapshot_not_found");

  const snapshots = await listCloudSaveSnapshots(objectId, shop);
  const snapshot = snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error("cloud_save_restore_snapshot_not_found");
  const manifest = await getRemoteSnapshotRestoreManifest(snapshot);
  if (
    manifest.snapshot.shop !== shop ||
    manifest.snapshot.objectId !== objectId ||
    manifest.snapshot.id !== snapshotId
  ) {
    throw new Error("Cloud save snapshot belongs to another game");
  }

  return {
    snapshot,
    variants: manifest.variants,
    files: manifest.files.map((file) => ({ ...file })),
  };
};

export const assertCloudSaveSnapshotFileSelection = (
  snapshot: CloudSaveSnapshotFiles,
  entryIds: string[]
) => {
  if (entryIds.length === 0) {
    throw new Error("cloud_save_restore_selection_empty");
  }
  const available = new Set(snapshot.files.map(cloudSaveFileKey));
  if (
    new Set(entryIds).size !== entryIds.length ||
    entryIds.some((entryId) => !available.has(entryId))
  ) {
    throw new Error("cloud_save_restore_selection_invalid");
  }
};
