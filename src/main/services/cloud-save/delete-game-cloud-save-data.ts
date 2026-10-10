import type { GameShop } from "@types";

import { GoogleDriveStorage } from "../google-drive";
import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { clearCloudSaveLocalState } from "./clear-cloud-save-local-state";
import { assertCloudSaveDriveConnected } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import { withCloudSaveCustomPathStoreMutation } from "./custom-path-store";
import { executeDeleteGameCloudSaveData } from "./delete-game-cloud-save-data-policy";
import { getDeletableGameCloudSaveSourceFiles } from "./delete-game-cloud-save-targets";
import { deleteLocalSaveTargets } from "./delete-local-save-targets";
import { assertCloudSaveEnvironmentCurrent } from "./environment-guard";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";
import {
  beginCloudSavePendingDeletion,
  clearCloudSavePendingDeletion,
  markCloudSaveRemoteDeletionStarted,
} from "./pending-deletion";

export const deleteGameCloudSaveData = async (
  objectId: string,
  shop: GameShop,
  assertGameNotRunning: () => void
) => {
  await assertCloudSaveDriveConnected();

  return cloudSaveOperationGate.runDeletion(
    cloudSaveOperationScopeKey(objectId, shop),
    "delete-game-cloud-save-data",
    () =>
      executeDeleteGameCloudSaveData({
        beginPendingDeletion: () =>
          beginCloudSavePendingDeletion(objectId, shop),
        markRemoteDeletionStarted: () =>
          markCloudSaveRemoteDeletionStarted(objectId, shop),
        clearPendingDeletion: () =>
          clearCloudSavePendingDeletion(objectId, shop),
        runWithLocalDeletionSnapshot: async (operation) => {
          const context = await getCloudSaveGameContext(objectId, shop);
          const customPathContext = cloudSaveCustomPathContextFromPathContext(
            context.pathContext
          );
          return withCloudSaveCustomPathStoreMutation(
            shop,
            objectId,
            customPathContext,
            async (customPathStorageKey, bindings) => {
              const analysis = await analyzeCloudSaveState(
                objectId,
                shop,
                context,
                "bidirectional",
                { customPathBindings: bindings }
              );
              const deletableSourceFiles = getDeletableGameCloudSaveSourceFiles(
                analysis.localSnapshotContext.sourceFiles,
                bindings,
                analysis.localSnapshotContext.pathContext.platform
              );
              const localEntryIds = deletableSourceFiles.map(cloudSaveFileKey);
              const cleanupRootPaths = deletableSourceFiles.map(
                (file) => file.localBindings.concretePath
              );

              await operation({
                deleteLocalFiles: async () => {
                  await deleteLocalSaveTargets(
                    analysis.localSnapshotContext,
                    localEntryIds,
                    "cloud-data-deletion",
                    async () => {
                      assertGameNotRunning();
                      await assertCloudSaveEnvironmentCurrent(
                        objectId,
                        shop,
                        analysis.environmentId
                      );
                    },
                    cleanupRootPaths
                  );
                },
                clearLocalState: () =>
                  clearCloudSaveLocalState(
                    objectId,
                    shop,
                    customPathStorageKey
                  ),
              });
            }
          );
        },
        assertGameNotRunning,
        // Fork: the remote snapshot lives in the game's Google Drive folder.
        deleteRemoteSnapshots: () =>
          GoogleDriveStorage.deleteGameFolder(shop, objectId),
      })
  );
};
