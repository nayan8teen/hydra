import { cloudSaveSyncAnchorsSublevel, db, levelKeys } from "@main/level";
import type {
  CloudSaveRemoteProvider,
  CloudSaveSyncAnchor,
  GameShop,
  User,
} from "@types";

import {
  CLOUD_SAVE_HASH_PATTERN,
  cloudSaveFileKey,
} from "./cloud-save-contract";
import { normalizeCloudSaveProvider } from "./cloud-save-provider-policy.js";
import {
  getCloudSaveAnchorIdentityForProvider,
  resolveCloudSaveProvider,
} from "./remote-backend";
import {
  getCloudSaveSyncAnchorEnvironmentFromKey,
  isCloudSaveSyncAnchorKeyForAnyIdentity,
} from "./sync-anchor-key";
import { hasCloudSaveV4AnchorSchema } from "./sync-anchor-policy";

const isValidAnchor = (
  anchor: CloudSaveSyncAnchor | null,
  environmentId: string,
  provider: CloudSaveRemoteProvider
) => {
  if (
    !anchor ||
    !hasCloudSaveV4AnchorSchema(anchor) ||
    !anchor.environmentId ||
    anchor.environmentId !== environmentId ||
    normalizeCloudSaveProvider(anchor.provider) !== provider ||
    !anchor.baseSnapshotId ||
    !Number.isSafeInteger(anchor.baseVersion) ||
    anchor.baseVersion < 1 ||
    !CLOUD_SAVE_HASH_PATTERN.test(anchor.baseAggregateHash) ||
    !Array.isArray(anchor.entries) ||
    !Array.isArray(anchor.unresolvedRemoteEntryIds) ||
    !Number.isFinite(Date.parse(anchor.updatedAt))
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const entry of anchor.entries) {
    const id = cloudSaveFileKey(entry);
    if (
      !CLOUD_SAVE_HASH_PATTERN.test(entry.variantId) ||
      !entry.rawPath ||
      !entry.relativePath ||
      ids.has(id) ||
      !CLOUD_SAVE_HASH_PATTERN.test(entry.hash) ||
      !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes < 0
    ) {
      return false;
    }
    ids.add(id);
  }
  return anchor.unresolvedRemoteEntryIds.every((id) => ids.has(id));
};

const getCurrentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("Cloud save sync requires a signed-in user");
  return user.id;
};

/**
 * Anchor identity: the Hydra account for Hydra and the Google account for
 * Drive, so a Drive-only user never needs a Hydra login to sync.
 */
const getAnchorIdentity = async (provider: CloudSaveRemoteProvider) =>
  provider === "google-drive"
    ? getCloudSaveAnchorIdentityForProvider(provider, "")
    : getCloudSaveAnchorIdentityForProvider(provider, await getCurrentUserId());

const getLegacyAnchorKey = (
  identity: string,
  shop: GameShop,
  objectId: string
) => JSON.stringify([identity, shop, objectId]);

const getEnvironmentAnchorKey = (
  identity: string,
  shop: GameShop,
  objectId: string,
  environmentId: string
) => JSON.stringify([identity, shop, objectId, "environment", environmentId]);

export const getCloudSaveSyncAnchorForEnvironment = async (
  shop: GameShop,
  objectId: string,
  environmentId: string
) => {
  const provider = await resolveCloudSaveProvider(objectId, shop);
  const identity = await getAnchorIdentity(provider);
  const key = getEnvironmentAnchorKey(identity, shop, objectId, environmentId);
  const anchor = (await cloudSaveSyncAnchorsSublevel.get(key)) ?? null;
  if (!isValidAnchor(anchor, environmentId, provider)) {
    if (anchor) await cloudSaveSyncAnchorsSublevel.del(key);
    return null;
  }
  return anchor;
};

export const getCloudSaveSyncAnchorForSnapshot = async (
  shop: GameShop,
  objectId: string,
  snapshotId: string
) => {
  const provider = await resolveCloudSaveProvider(objectId, shop);
  const identity = await getAnchorIdentity(provider);
  let matched: CloudSaveSyncAnchor | null = null;
  for await (const [key, anchor] of cloudSaveSyncAnchorsSublevel.iterator()) {
    const environmentId = getCloudSaveSyncAnchorEnvironmentFromKey(
      key,
      identity,
      shop,
      objectId
    );
    if (
      environmentId &&
      isValidAnchor(anchor, environmentId, provider) &&
      anchor.baseSnapshotId === snapshotId &&
      (!matched || Date.parse(anchor.updatedAt) > Date.parse(matched.updatedAt))
    ) {
      matched = anchor;
    }
  }
  return matched;
};

export const getCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string,
  environmentId: string,
  options: { allowEnvironmentFallback?: boolean } = {}
) => {
  const provider = await resolveCloudSaveProvider(objectId, shop);
  const identity = await getAnchorIdentity(provider);
  const environmentAnchor = await getCloudSaveSyncAnchorForEnvironment(
    shop,
    objectId,
    environmentId
  );
  if (environmentAnchor) return environmentAnchor;

  await cloudSaveSyncAnchorsSublevel
    .del(getLegacyAnchorKey(identity, shop, objectId))
    .catch(() => undefined);
  if (!options.allowEnvironmentFallback) return null;

  let latestAnchor: CloudSaveSyncAnchor | null = null;
  let latestUpdatedAt = Number.NEGATIVE_INFINITY;

  for await (const [
    key,
    candidate,
  ] of cloudSaveSyncAnchorsSublevel.iterator()) {
    const candidateEnvironmentId = getCloudSaveSyncAnchorEnvironmentFromKey(
      key,
      identity,
      shop,
      objectId
    );
    if (
      !candidateEnvironmentId ||
      !isValidAnchor(candidate, candidateEnvironmentId, provider)
    ) {
      continue;
    }
    const updatedAt = Date.parse(candidate.updatedAt);
    if (updatedAt > latestUpdatedAt) {
      latestAnchor = candidate;
      latestUpdatedAt = updatedAt;
    }
  }

  return latestAnchor;
};

export const saveCloudSaveSyncAnchor = async (
  shop: GameShop,
  objectId: string,
  environmentId: string,
  anchor: CloudSaveSyncAnchor
) => {
  if (anchor.schemaVersion !== 4 || anchor.environmentId !== environmentId) {
    throw new Error("Invalid Cloud Save V4 sync anchor");
  }
  const provider = await resolveCloudSaveProvider(objectId, shop);
  const identity = await getAnchorIdentity(provider);
  const entries = [...anchor.entries].sort((left, right) =>
    cloudSaveFileKey(left).localeCompare(cloudSaveFileKey(right))
  );
  if (
    entries.some(
      (entry, index) =>
        index > 0 &&
        cloudSaveFileKey(entries[index - 1]) === cloudSaveFileKey(entry)
    )
  ) {
    throw new Error("Duplicate file identity in Cloud Save V4 sync anchor");
  }
  const environmentAnchor: CloudSaveSyncAnchor = {
    ...anchor,
    provider,
    entries,
    unresolvedRemoteEntryIds: [
      ...new Set(anchor.unresolvedRemoteEntryIds),
    ].sort((left, right) => left.localeCompare(right)),
  };
  if (!isValidAnchor(environmentAnchor, environmentId, provider)) {
    throw new Error("Invalid Cloud Save V4 sync anchor");
  }
  await cloudSaveSyncAnchorsSublevel.put(
    getEnvironmentAnchorKey(identity, shop, objectId, environmentId),
    environmentAnchor
  );
  await cloudSaveSyncAnchorsSublevel
    .del(getLegacyAnchorKey(identity, shop, objectId))
    .catch(() => undefined);
};

/** Clears every backend's anchors for a game, with or without a Hydra login. */
export const clearCloudSaveSyncAnchors = async (
  shop: GameShop,
  objectId: string
) => {
  const batch = cloudSaveSyncAnchorsSublevel.batch();
  let hasOperations = false;

  for await (const [key] of cloudSaveSyncAnchorsSublevel.iterator()) {
    if (isCloudSaveSyncAnchorKeyForAnyIdentity(key, shop, objectId)) {
      batch.del(key);
      hasOperations = true;
    }
  }

  if (hasOperations) await batch.write();
};
