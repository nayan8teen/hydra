interface DeleteGameCloudSaveDataDependencies {
  beginPendingDeletion: () => Promise<"prepared" | "remote-started">;
  markRemoteDeletionStarted: () => Promise<void>;
  clearPendingDeletion: () => Promise<void>;
  runWithLocalDeletionSnapshot: (
    operation: (snapshot: {
      deleteLocalFiles: () => Promise<void>;
      clearLocalState: () => Promise<void>;
    }) => Promise<void>
  ) => Promise<void>;
  assertGameNotRunning: () => void;
  deleteRemoteSnapshots: () => Promise<void>;
}

export const executeDeleteGameCloudSaveData = async ({
  beginPendingDeletion,
  markRemoteDeletionStarted,
  clearPendingDeletion,
  runWithLocalDeletionSnapshot,
  assertGameNotRunning,
  deleteRemoteSnapshots,
}: DeleteGameCloudSaveDataDependencies) => {
  let pendingPhase = await beginPendingDeletion();

  const advanceToRemoteStarted = async () => {
    pendingPhase = "remote-started";
    await markRemoteDeletionStarted();
  };

  const rollbackIsSafe = () => pendingPhase === "prepared";

  try {
    await runWithLocalDeletionSnapshot(
      async ({ deleteLocalFiles, clearLocalState }) => {
        assertGameNotRunning();
        await advanceToRemoteStarted();
        await deleteRemoteSnapshots();
        assertGameNotRunning();
        await deleteLocalFiles();
        await clearLocalState();
        await clearPendingDeletion();
      }
    );
  } catch (error) {
    if (rollbackIsSafe()) {
      try {
        await clearPendingDeletion();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "cloud_save_delete_rollback_failed"
        );
      }
    }
    throw error;
  }
};
