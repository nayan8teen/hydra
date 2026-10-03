import type { GameShop } from "@types";

export const isCloudSaveSyncAnchorKeyForGame = (
  key: string,
  userId: string,
  shop: GameShop,
  objectId: string
) => {
  let parts: unknown;
  try {
    parts = JSON.parse(key);
  } catch {
    return false;
  }

  if (
    !Array.isArray(parts) ||
    parts[0] !== userId ||
    parts[1] !== shop ||
    parts[2] !== objectId
  ) {
    return false;
  }

  return (
    parts.length === 3 ||
    (parts.length === 5 &&
      parts[3] === "environment" &&
      typeof parts[4] === "string")
  );
};

/**
 * Matches a game's anchors from any backend identity, so local state can be
 * cleared for Hydra and Drive accounts alike.
 */
export const isCloudSaveSyncAnchorKeyForAnyIdentity = (
  key: string,
  shop: GameShop,
  objectId: string
) => {
  let parts: unknown;
  try {
    parts = JSON.parse(key);
  } catch {
    return false;
  }

  if (
    !Array.isArray(parts) ||
    typeof parts[0] !== "string" ||
    parts[0].length === 0 ||
    parts[1] !== shop ||
    parts[2] !== objectId
  ) {
    return false;
  }

  return (
    parts.length === 3 ||
    (parts.length === 5 &&
      parts[3] === "environment" &&
      typeof parts[4] === "string")
  );
};

export const getCloudSaveSyncAnchorEnvironmentFromKey = (
  key: string,
  userId: string,
  shop: GameShop,
  objectId: string
) => {
  let parts: unknown;
  try {
    parts = JSON.parse(key);
  } catch {
    return null;
  }

  if (
    !Array.isArray(parts) ||
    parts.length !== 5 ||
    parts[0] !== userId ||
    parts[1] !== shop ||
    parts[2] !== objectId ||
    parts[3] !== "environment" ||
    typeof parts[4] !== "string"
  ) {
    return null;
  }

  return parts[4];
};
