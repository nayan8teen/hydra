import type { GoogleDriveManifestRef, RemoteSnapshotSummary } from "@types";

import { toGoogleDriveSnapshotSummary } from "../google-drive/google-drive-manifest.js";

/**
 * Builds a game's snapshot list from its Drive manifests. The head manifest is
 * the current snapshot; manifest history supplies the older versions.
 *
 * The history fallback matters for a game whose head manifest is missing while
 * restorable snapshots remain: reporting no cloud saves would hide both the
 * cloud panel's snapshot card and the snapshot-history restore browser.
 */
export const buildRemoteSnapshotSummaries = (
  head: GoogleDriveManifestRef | null,
  history: GoogleDriveManifestRef[]
): RemoteSnapshotSummary[] => {
  const unique = new Map<number, GoogleDriveManifestRef>();
  for (const ref of history) unique.set(ref.manifest.version, ref);
  if (head) unique.set(head.manifest.version, head);
  return [...unique.values()]
    .sort((left, right) => right.manifest.version - left.manifest.version)
    .map(toGoogleDriveSnapshotSummary);
};
