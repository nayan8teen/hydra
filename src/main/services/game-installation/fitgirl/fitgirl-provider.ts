import fs from "node:fs/promises";
import path from "node:path";

import { SevenZip } from "../../7zip.js";
import {
  InstallError,
  type InstallerProviderAdapter,
  type InstallPreparationContext,
  type InstallPreparationPhase,
  type PreparedInstall,
} from "../install-adapter.js";
import { isPathInside } from "../install-paths.js";
import { listPackageFiles } from "../package-files.js";
import {
  FITGIRL_SETUP_EXECUTABLE_NAME,
  planFitGirlPackage,
} from "./fitgirl-package.js";
import {
  runFitGirlSetup,
  terminateProcessTree,
} from "./fitgirl-windows-installer.js";

const resolveWithinPackage = (packageDirectory: string, relative: string) => {
  const resolved = path.resolve(packageDirectory, relative);

  if (!isPathInside(packageDirectory, resolved)) {
    throw new InstallError(
      "unsupported-layout",
      "The package references a path outside its own folder"
    );
  }

  return resolved;
};

const inspectPackage = (packageDirectory: string) =>
  listPackageFiles(packageDirectory).then((files) =>
    planFitGirlPackage({ files })
  );

/**
 * Extracts each archive set once through its first volume. Later volumes are
 * expanded by 7-Zip from that first volume; extracting them individually would
 * corrupt the set.
 */
const extractArchiveGroups = async (
  packageDirectory: string,
  groups: { firstVolume: string; volumes: string[] }[],
  signal: AbortSignal
): Promise<void> => {
  for (const group of groups) {
    signal.throwIfAborted();

    const firstVolume = resolveWithinPackage(
      packageDirectory,
      group.firstVolume
    );

    try {
      await SevenZip.extractFile({
        filePath: firstVolume,
        cwd: path.dirname(firstVolume),
      });
    } catch (error) {
      throw new InstallError(
        "extraction-failed",
        `Could not extract "${group.firstVolume}": ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }
};

const prepare = async (
  context: InstallPreparationContext,
  signal: AbortSignal,
  onPhase: (phase: InstallPreparationPhase) => void
): Promise<PreparedInstall> => {
  const packageDirectory = path.resolve(context.packageDirectory);
  const stats = await fs.lstat(packageDirectory).catch(() => null);

  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new InstallError(
      "missing-package",
      "The download folder is missing or is not a directory"
    );
  }

  if (context.attempt === 0) {
    const existingEntries = await fs
      .readdir(context.installDirectory)
      .catch(() => null);

    if (existingEntries && existingEntries.length > 0) {
      throw new InstallError(
        "target-conflict",
        `"${context.installDirectory}" already contains files`
      );
    }
  }

  let plan = await inspectPackage(packageDirectory);

  if (plan.setupIsAmbiguous) {
    throw new InstallError(
      "ambiguous-setup",
      `More than one ${FITGIRL_SETUP_EXECUTABLE_NAME} was found in the download folder`
    );
  }

  if (!plan.setupPath) {
    if (plan.incompleteArchiveGroups.length > 0) {
      throw new InstallError(
        "missing-archive-volumes",
        `The archive set starting at "${plan.incompleteArchiveGroups[0].basePath}" is incomplete`
      );
    }

    if (plan.archiveGroups.length === 0) {
      throw new InstallError(
        "missing-setup",
        `No ${FITGIRL_SETUP_EXECUTABLE_NAME} or supported archive was found in the download folder`
      );
    }

    if (!context.allowExtraction) {
      throw new InstallError(
        "extraction-required",
        "This package must be extracted before it can be installed"
      );
    }

    onPhase("extracting");
    await extractArchiveGroups(packageDirectory, plan.archiveGroups, signal);

    plan = await inspectPackage(packageDirectory);

    if (plan.setupIsAmbiguous) {
      throw new InstallError(
        "ambiguous-setup",
        `More than one ${FITGIRL_SETUP_EXECUTABLE_NAME} was found after extraction`
      );
    }

    if (!plan.setupPath) {
      throw new InstallError(
        "missing-setup",
        `${FITGIRL_SETUP_EXECUTABLE_NAME} was not found after extraction`
      );
    }
  }

  const setupExecutable = resolveWithinPackage(
    packageDirectory,
    plan.setupPath
  );
  const workingDirectory = resolveWithinPackage(
    packageDirectory,
    plan.workingDirectory ?? "."
  );

  return {
    setupExecutable,
    workingDirectory,
    installDirectory: context.installDirectory,
    options: { ...context.providerOptions },
  };
};

export const createFitGirlAdapter = (): InstallerProviderAdapter => ({
  providerId: "fitgirl",
  supportsAutomaticInstall: process.platform === "win32",
  prepare: (context, signal, onPhase) => prepare(context, signal, onPhase),
  install: (plan, onProgress, signal, onProcessStarted) =>
    runFitGirlSetup({ plan, onProgress, signal, onProcessStarted }),
  terminate: terminateProcessTree,
});
