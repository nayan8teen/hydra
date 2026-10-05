import type {
  CloudSaveConflictResolution,
  CloudSaveMergeResult,
  CloudSaveSyncAnchor,
  LocalGameSnapshotContext,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import {
  parseRetroArchGameRawPath,
  parseRetroArchStateRelativePath,
  parseRpcs3SaveRawPath,
} from "./emulator-provider-identity.js";
import { isRetroArchBatteryRelativePath } from "./retroarch-snapshot-migration.js";
import { areSnapshotVariantsEqual } from "./snapshot-variant.js";
import type { SyncDirection } from "./sync-game/policy.js";

interface MergeUserVariantSnapshotsInput {
  local: LocalGameSnapshotContext;
  remoteVariants: SnapshotVariant[];
  remoteFiles: SnapshotFile[];
  base: CloudSaveSyncAnchor | null;
  direction?: SyncDirection;
  resolutions?: ReadonlyMap<string, CloudSaveConflictResolution>;
  preserveLocalMissingRawPaths?: ReadonlySet<string>;
  preserveLocalMissingEntryIds?: ReadonlySet<string>;
  preserveCloudOnlyEntryIds?: ReadonlySet<string>;
  treatLocalAsNewRawPaths?: ReadonlySet<string>;
}

const indexUnique = <T extends SnapshotFile>(files: T[]) => {
  const result = new Map<string, T>();
  for (const file of files) {
    const key = cloudSaveFileKey(file);
    if (result.has(key)) {
      throw new Error("Duplicate composite Cloud Save file identity");
    }
    result.set(key, file);
  }
  return result;
};

const sameBytes = (
  left: Pick<SnapshotFile, "hash" | "sizeBytes"> | undefined,
  right: Pick<SnapshotFile, "hash" | "sizeBytes"> | undefined
) => {
  if (!left || !right) return false;
  return left.hash === right.hash && left.sizeBytes === right.sizeBytes;
};

const rpcs3SlotKey = (
  file: Pick<SnapshotFile, "variantId" | "rawPath" | "relativePath"> | undefined
) => {
  if (!file || !parseRpcs3SaveRawPath(file.rawPath)) return null;
  const [slot, child] = file.relativePath.split("/");
  return slot && child
    ? JSON.stringify([file.variantId, file.rawPath, slot])
    : null;
};

const retroArchGroupKey = (
  file: Pick<SnapshotFile, "variantId" | "rawPath" | "relativePath"> | undefined
) => {
  if (!file || !parseRetroArchGameRawPath(file.rawPath)) return null;
  const state = parseRetroArchStateRelativePath(file.relativePath);
  if (state) {
    return JSON.stringify([
      file.variantId,
      file.rawPath,
      "state",
      state.stateId,
    ]);
  }
  if (isRetroArchBatteryRelativePath(file.relativePath)) {
    return JSON.stringify([file.variantId, file.rawPath, "battery"]);
  }
  return null;
};

const atomicGroupKey = (
  file: Pick<SnapshotFile, "variantId" | "rawPath" | "relativePath"> | undefined
) => rpcs3SlotKey(file) ?? retroArchGroupKey(file);

const mergeVariantMetadata = (
  local: SnapshotVariant[],
  remote: SnapshotVariant[],
  usedVariantIds: Set<string>
) => {
  const variants = new Map<string, SnapshotVariant>();
  for (const variant of [...local, ...remote]) {
    const current = variants.get(variant.variantId);
    if (current && !areSnapshotVariantsEqual(current, variant)) {
      throw new Error("Divergent Cloud Save metadata for the same variant");
    }
    variants.set(variant.variantId, variant);
  }
  return [...usedVariantIds]
    .sort((left, right) => left.localeCompare(right))
    .map((variantId) => {
      const variant = variants.get(variantId);
      if (!variant) throw new Error("Cloud Save file has no variant metadata");
      return variant;
    });
};

export const mergeUserVariantSnapshots = ({
  local,
  remoteVariants,
  remoteFiles,
  base,
  direction = "bidirectional",
  resolutions,
  preserveLocalMissingRawPaths = new Set<string>(),
  preserveLocalMissingEntryIds = new Set<string>(),
  preserveCloudOnlyEntryIds = new Set<string>(),
  treatLocalAsNewRawPaths = new Set<string>(),
}: MergeUserVariantSnapshotsInput): CloudSaveMergeResult => {
  const localById = indexUnique(local.files);
  const remoteById = indexUnique(remoteFiles);
  // Entries flagged unresolved in the anchor still describe the last-synced
  // cloud state, so they remain a valid merge base: content-compared against
  // them, a one-sided change resolves directionally instead of conflicting.
  const unresolvedBaseIds = new Set(base?.unresolvedRemoteEntryIds ?? []);
  const baseById = new Map(
    (base?.entries ?? [])
      .map((entry) => [cloudSaveFileKey(entry), entry] as const)
      .filter(([, entry]) => !treatLocalAsNewRawPaths.has(entry.rawPath))
  );
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const files: SnapshotFile[] = [];
  const conflicts: CloudSaveMergeResult["conflicts"] = [];
  const restoreEntryIds = new Set<string>();
  const deleteRemoteEntryIds = new Set<string>();
  const deleteLocalEntryIds = new Set<string>();
  const unresolvedRemoteEntryIds = new Set<string>();

  const coverageFor = (file: SnapshotFile) =>
    local.coverage.filter(
      (item) =>
        (!item.variantId || item.variantId === file.variantId) &&
        (!item.rawPath || item.rawPath === file.rawPath) &&
        (!item.relativePath || item.relativePath === file.relativePath)
    );
  const coverageStateFor = (file: SnapshotFile) => {
    const coverage = coverageFor(file);
    const foreignEnvironment =
      coverage.length > 0 &&
      coverage.every((item) => item.outcome === "foreign-environment");
    const incomplete = coverage.some(
      (item) =>
        item.outcome !== "foreign-environment" &&
        (!item.enumeratedCompletely ||
          item.outcome === "failed" ||
          item.outcome === "partial" ||
          item.outcome === "unresolved")
    );
    const selectedCompleteRoot = coverage.some(
      (item) =>
        item.selectedRoot &&
        item.outcome === "scanned" &&
        item.enumeratedCompletely
    );
    return {
      hasCoverage: coverage.length > 0,
      foreignEnvironment,
      incomplete,
      provesDeletion: selectedCompleteRoot && !incomplete,
    };
  };

  // Empty local snapshots are never an authorization to restore cloud data.
  // The cloud-only case is retained below as unresolved until the user chooses
  // a restore in the cloud-save browser.

  const slotChanges = new Map<string, { local: boolean; remote: boolean }>();
  for (const entryId of ids) {
    const localFile = localById.get(entryId);
    const remoteFile = remoteById.get(entryId);
    const baseEntry = baseById.get(entryId);
    const slotKey = atomicGroupKey(localFile ?? remoteFile ?? baseEntry);
    if (!slotKey || sameBytes(localFile, remoteFile)) continue;
    const changes = slotChanges.get(slotKey) ?? {
      local: false,
      remote: false,
    };
    changes.local ||= Boolean(
      (localFile && !sameBytes(localFile, baseEntry)) ||
        (!localFile &&
          baseEntry &&
          remoteFile &&
          coverageStateFor(remoteFile).provesDeletion)
    );
    changes.remote ||= Boolean(
      (remoteFile && !sameBytes(remoteFile, baseEntry)) ||
        (!remoteFile && baseEntry)
    );
    slotChanges.set(slotKey, changes);
  }
  const divergentSlots = new Set(
    [...slotChanges]
      .filter(([, changes]) => changes.local && changes.remote)
      .map(([slotKey]) => slotKey)
  );

  for (const entryId of [...ids].sort((left, right) =>
    left.localeCompare(right)
  )) {
    const localFile = localById.get(entryId);
    const remoteFile = remoteById.get(entryId);
    const baseEntry = baseById.get(entryId);
    const slotKey = atomicGroupKey(localFile ?? remoteFile ?? baseEntry);

    if (
      slotKey &&
      divergentSlots.has(slotKey) &&
      (retroArchGroupKey(localFile ?? remoteFile ?? baseEntry) ||
        localFile ||
        !remoteFile ||
        coverageStateFor(remoteFile).provesDeletion)
    ) {
      if (sameBytes(localFile, remoteFile)) {
        if (remoteFile) files.push(remoteFile);
        continue;
      }
      const resolution = resolutions?.get(entryId);
      if (resolution === "keep-local") {
        if (localFile) files.push(localFile);
        else deleteRemoteEntryIds.add(entryId);
      } else if (resolution === "keep-remote") {
        if (remoteFile) {
          files.push(remoteFile);
          restoreEntryIds.add(entryId);
        } else {
          deleteLocalEntryIds.add(entryId);
        }
      } else {
        if (remoteFile) files.push(remoteFile);
        conflicts.push({
          entryId,
          local: localFile ?? null,
          remote: remoteFile ?? null,
        });
      }
      continue;
    }

    if (localFile && !remoteFile) {
      if (!baseEntry) {
        files.push(localFile);
        continue;
      }
      // The cloud no longer lists a file that exists locally. Whether the local
      // copy changed since the base or not, deleting it implicitly is never
      // safe: it may be an intentional remote deletion or a partial/lost cloud
      // manifest. Surface a deletion conflict so the user chooses (keep local
      // keeps or re-uploads the file, keep remote deletes it explicitly).
      const resolution = resolutions?.get(entryId);
      if (resolution === "keep-remote") {
        deleteLocalEntryIds.add(entryId);
      } else {
        files.push(localFile);
        if (!resolution) {
          conflicts.push({ entryId, local: localFile, remote: null });
        }
      }
      continue;
    }
    if (!localFile && remoteFile) {
      if (preserveCloudOnlyEntryIds.has(entryId)) {
        files.push(remoteFile);
        continue;
      }
      if (preserveLocalMissingEntryIds.has(entryId)) {
        files.push(remoteFile);
        unresolvedRemoteEntryIds.add(entryId);
        continue;
      }
      if (preserveLocalMissingRawPaths.has(remoteFile.rawPath)) {
        files.push(remoteFile);
        unresolvedRemoteEntryIds.add(entryId);
        continue;
      }

      const coverage = coverageStateFor(remoteFile);
      if (coverage.foreignEnvironment) {
        files.push(remoteFile);
        continue;
      }
      const resolution = resolutions?.get(entryId);
      if (baseEntry && coverage.provesDeletion) {
        if (resolution === "keep-remote") {
          files.push(remoteFile);
          restoreEntryIds.add(entryId);
        } else if (resolution === "keep-local") {
          deleteRemoteEntryIds.add(entryId);
        } else {
          files.push(remoteFile);
          conflicts.push({ entryId, local: null, remote: remoteFile });
        }
        continue;
      }
      if (unresolvedBaseIds.has(entryId)) {
        if (resolution === "keep-remote") {
          files.push(remoteFile);
          restoreEntryIds.add(entryId);
        } else if (resolution === "keep-local") {
          deleteRemoteEntryIds.add(entryId);
        } else {
          files.push(remoteFile);
          unresolvedRemoteEntryIds.add(entryId);
        }
        continue;
      }
      // A cloud-only file without proven prior local ownership is retained as
      // pending. Sync must not materialize it locally; the user can explicitly
      // restore this file or snapshot in the cloud-save browser.
      files.push(remoteFile);
      unresolvedRemoteEntryIds.add(entryId);
      continue;
    }
    if (!localFile && !remoteFile) {
      continue;
    }
    if (!localFile || !remoteFile) {
      continue;
    }
    if (sameBytes(localFile, remoteFile)) {
      files.push(remoteFile);
      continue;
    }

    const localEqualsBase = sameBytes(localFile, baseEntry);
    const remoteEqualsBase = sameBytes(remoteFile, baseEntry);
    if (baseEntry && remoteEqualsBase && !localEqualsBase) {
      files.push(localFile);
      continue;
    }
    // A remote-only change to an existing local file is never applied without
    // an explicit user request; surface it as a conflict instead.
    const resolution = resolutions?.get(entryId);
    if (resolution === "keep-local") {
      files.push(localFile);
    } else if (resolution === "keep-remote") {
      files.push(remoteFile);
      restoreEntryIds.add(entryId);
    } else {
      files.push(remoteFile);
      conflicts.push({ entryId, local: localFile, remote: remoteFile });
    }
  }

  const incompleteCoverage = local.coverage.some(
    (item) =>
      item.outcome !== "foreign-environment" &&
      (!item.enumeratedCompletely ||
        item.outcome === "failed" ||
        item.outcome === "partial" ||
        item.outcome === "unresolved")
  );
  const usedVariantIds = new Set(files.map((file) => file.variantId));
  return {
    variants: mergeVariantMetadata(
      local.variants,
      remoteVariants,
      usedVariantIds
    ),
    files,
    conflicts,
    restoreEntryIds: [...restoreEntryIds].sort((left, right) =>
      left.localeCompare(right)
    ),
    deleteRemoteEntryIds: [...deleteRemoteEntryIds].sort((left, right) =>
      left.localeCompare(right)
    ),
    deleteLocalEntryIds: [...deleteLocalEntryIds].sort((left, right) =>
      left.localeCompare(right)
    ),
    unresolvedRemoteEntryIds: [...unresolvedRemoteEntryIds].sort(
      (left, right) => left.localeCompare(right)
    ),
    partial:
      incompleteCoverage ||
      unresolvedRemoteEntryIds.size > 0 ||
      (direction === "upload-only" && deleteLocalEntryIds.size > 0),
  };
};
