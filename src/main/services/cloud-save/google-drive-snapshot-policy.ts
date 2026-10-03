import type {
  GoogleDriveStorageManifest,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";

/** The head manifest a Drive commit would replace, if the game has one. */
export interface GoogleDriveSnapshotHead {
  fileId: string;
  etag: string;
  version: number;
}

export type GoogleDriveSnapshotWritePlan =
  | { kind: "conflict"; reason: "snapshot-changed" | "version-changed" }
  | {
      kind: "write";
      version: number;
      previousManifestFileId: string | null;
      previousEtag: string | null;
      previousSnapshotId: string | null;
    };

/**
 * Decides whether a Drive commit may proceed. A head manifest that moved since
 * the caller analyzed the game is a conflict, mirroring the Hydra engine's
 * `expectedSnapshotId`/`baseVersion` preconditions.
 */
export const planGoogleDriveSnapshotWrite = (params: {
  head: GoogleDriveSnapshotHead | null;
  baseVersion: number;
  expectedSnapshotId?: string | null;
}): GoogleDriveSnapshotWritePlan => {
  const head = params.head;
  const expectedSnapshotId = params.expectedSnapshotId ?? null;
  if (expectedSnapshotId !== null && head?.fileId !== expectedSnapshotId) {
    return { kind: "conflict", reason: "snapshot-changed" };
  }
  const headVersion = head?.version ?? 0;
  if (headVersion !== params.baseVersion) {
    return { kind: "conflict", reason: "version-changed" };
  }

  return {
    kind: "write",
    version: headVersion + 1,
    previousManifestFileId: head?.fileId ?? null,
    previousEtag: head?.etag ?? null,
    previousSnapshotId: head?.fileId ?? null,
  };
};

const summarizeFiles = (files: SnapshotFile[]) =>
  files
    .map((file) => `${cloudSaveFileKey(file)}|${file.hash}|${file.sizeBytes}`)
    .sort((left, right) => left.localeCompare(right));

const summarizeVariants = (variants: SnapshotVariant[]) =>
  variants
    .map((variant) => `${variant.variantId}|${variant.kind}`)
    .sort((left, right) => left.localeCompare(right));

const sameValues = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, i) => value === right[i]);

/**
 * Re-checks what was written to Drive against the proposal the engine asked to
 * commit, the same way the Hydra path verifies its commit response.
 */
export const verifyGoogleDriveSnapshotCommit = (params: {
  manifest: GoogleDriveStorageManifest;
  version: number;
  aggregateHash: string;
  customPathRawPaths: string[];
  variants: SnapshotVariant[];
  files: SnapshotFile[];
}): boolean => {
  const { manifest } = params;
  const manifestFiles = summarizeFiles(manifest.files);
  const expectedFiles = summarizeFiles(params.files);

  return (
    manifest.version === params.version &&
    manifest.aggregateHash === params.aggregateHash &&
    sameValues(manifestFiles, expectedFiles) &&
    sameValues(
      summarizeVariants(manifest.variants),
      summarizeVariants(params.variants)
    ) &&
    sameValues(
      [...manifest.customPathRawPaths].sort((a, b) => a.localeCompare(b)),
      [...params.customPathRawPaths].sort((a, b) => a.localeCompare(b))
    ) &&
    manifest.files.reduce((total, file) => total + file.sizeBytes, 0) ===
      params.files.reduce((total, file) => total + file.sizeBytes, 0)
  );
};
