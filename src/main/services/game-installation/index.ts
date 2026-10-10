import path from "node:path";

import type {
  Download,
  DownloadInstallerProvider,
  Game,
  InstallJob,
  UserPreferences,
} from "@types";
import {
  db,
  downloadSourcesSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { getDirectorySize } from "@main/events/helpers/get-directory-size";
import { findGameExecutableInFolder } from "@main/helpers/find-game-executable";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";

import { GameExecutables } from "../game-executables.js";
import { logger } from "../logger.js";
import { WindowManager } from "../window-manager.js";
import { createFitGirlAdapter } from "./fitgirl/fitgirl-provider.js";
import {
  DOWNLOAD_INSTALLER_PROVIDERS,
  type InstallerProviderAdapter,
} from "./install-adapter.js";
import { InstallJobManager, getInstallJobId } from "./install-job-manager.js";
import { createInstallJobStore } from "./install-job-store.js";
import { isAutomaticInstallationEnabledForProvider } from "./installation-preferences.js";

export * from "./install-adapter.js";
export * from "./install-job-manager.js";
export * from "./installation-preferences.js";
export * from "./install-paths.js";
export * from "./fitgirl/fitgirl-package.js";

const adapters = new Map<DownloadInstallerProvider, InstallerProviderAdapter>([
  ["fitgirl", createFitGirlAdapter()],
]);

export const getInstallerAdapter = (
  providerId: DownloadInstallerProvider
): InstallerProviderAdapter | null => adapters.get(providerId) ?? null;

export const isKnownInstallerProvider = (
  value: unknown
): value is DownloadInstallerProvider =>
  DOWNLOAD_INSTALLER_PROVIDERS.includes(value as DownloadInstallerProvider);

const getUserPreferences = () =>
  db.get<string, UserPreferences | null>(levelKeys.userPreferences, {
    valueEncoding: "json",
  });

/**
 * Binds an executable and the installed size for a finished install. Hydra's
 * usual discovery runs against the download folder, so the install destination
 * needs its own pass; an executable the user already chose is never replaced.
 */
const bindInstalledGame = async (job: InstallJob): Promise<void> => {
  if (!job.installDirectory) return;

  const gameKey = levelKeys.game(job.shop, job.objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  if (!game) return;

  const executables = GameExecutables.getExecutablesForGame(job.objectId);

  if (!game.executablePath && executables && executables.length > 0) {
    const executablePath = await findGameExecutableInFolder(
      job.installDirectory,
      executables
    );

    if (executablePath) {
      await gamesSublevel.put(
        gameKey,
        updateGameExecutablePath(game, executablePath)
      );
    }
  }

  const installedSizeInBytes = await getDirectorySize(job.installDirectory);
  const currentGame = await gamesSublevel.get(gameKey).catch(() => null);

  if (currentGame) {
    await gamesSublevel.put(gameKey, { ...currentGame, installedSizeInBytes });
  }
};

const resolveProviderForDownload = async (
  download: Download
): Promise<DownloadInstallerProvider | null> => {
  if (!download.downloadSourceId) return null;

  const source = await downloadSourcesSublevel
    .get(download.downloadSourceId)
    .catch(() => null);

  if (!source?.installerProvider) return null;

  return isKnownInstallerProvider(source.installerProvider)
    ? source.installerProvider
    : null;
};

export const installJobManager = new InstallJobManager({
  store: createInstallJobStore(),
  resolveAdapter: getInstallerAdapter,
  getPreferences: getUserPreferences,
  onJobUpdated: (job) => {
    WindowManager.sendToAppWindows("on-install-job-updated", job);
    WindowManager.sendDownloadsUpdated();
  },
  onJobFinished: async (job) => {
    try {
      if (job.phase === "succeeded") {
        await bindInstalledGame(job);
      }
    } catch (error) {
      logger.error(
        `[InstallJobManager] Failed to bind installed game ${job.id}`,
        error
      );
    }
  },
});

export const getInstallJobs = () => installJobManager.listJobs();

export const getInstallJob = (
  shop: string,
  objectId: string
): Promise<InstallJob | null> =>
  installJobManager.getJob(getInstallJobId(shop, objectId));

export const cancelGameInstallation = (shop: string, objectId: string) =>
  installJobManager.cancel(getInstallJobId(shop, objectId));

export const retryGameInstallation = (shop: string, objectId: string) =>
  installJobManager.retry(getInstallJobId(shop, objectId));

export const reconcileInstallJobsOnStartup = () =>
  installJobManager
    .reconcileInterruptedJobs()
    .then((jobs) => {
      if (jobs.length > 0) {
        logger.warn(
          `[InstallJobManager] Marked ${jobs.length} interrupted installation(s) for review`
        );
      }
    })
    .catch((error) =>
      logger.error(
        "[InstallJobManager] Failed to reconcile install jobs",
        error
      )
    );

/**
 * Starts automatic installation for a completed download when the user asked
 * for it, the source has a known provider, and that provider is enabled in
 * Settings. Everything else keeps today's behavior.
 */
export const enqueueAutomaticInstallation = async (
  download: Download,
  game: Game
): Promise<InstallJob | null> => {
  try {
    if (!download.automaticallyInstall) return null;

    const providerId = await resolveProviderForDownload(download);

    if (!providerId) return null;

    const adapter = getInstallerAdapter(providerId);

    if (!adapter?.supportsAutomaticInstall) return null;

    const preferences = await getUserPreferences();

    if (!isAutomaticInstallationEnabledForProvider(preferences, providerId)) {
      return null;
    }

    return await installJobManager.enqueue({
      shop: download.shop,
      objectId: download.objectId,
      title: game.title,
      providerId,
      downloadSourceId: download.downloadSourceId,
      downloadTimestamp: download.timestamp,
      packageDirectory: download.folderName
        ? path.join(download.downloadPath, download.folderName)
        : download.downloadPath,
      allowExtraction: download.automaticallyExtract,
    });
  } catch (error) {
    logger.error(
      `[InstallJobManager] Failed to queue installation for ${download.shop}:${download.objectId}`,
      error
    );
    return null;
  }
};
