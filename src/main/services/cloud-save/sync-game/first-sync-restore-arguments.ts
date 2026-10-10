import type { CloudSaveMergeResult } from "@types";

export const firstSyncRestoreArguments = (
  merge: Pick<
    CloudSaveMergeResult,
    "restoreEntryIds" | "unresolvedRemoteEntryIds"
  >,
  assertEnvironmentCurrent?: () => Promise<void>
) =>
  [
    merge.restoreEntryIds,
    true,
    merge.unresolvedRemoteEntryIds,
    assertEnvironmentCurrent,
  ] as const;
