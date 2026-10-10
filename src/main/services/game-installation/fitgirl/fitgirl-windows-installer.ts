import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

import { InstallError, type PreparedInstall } from "../install-adapter.js";

const execFileAsync = promisify(execFile);

export const FITGIRL_UNATTENDED_OPTION = "unattended";

/**
 * FitGirl repacks use an Inno Setup based `setup.exe`, where `/DIR=` preselects
 * the destination. Silent switches are only used after the user explicitly opts
 * in for a compatible package, because Inno's dialogs vary between repacks and
 * guessing a click sequence is not a safe substitute for a real installer.
 */
export const buildFitGirlSetupArguments = ({
  installDirectory,
  unattended,
}: {
  installDirectory: string;
  unattended: boolean;
}): string[] => {
  const directoryArgument = `/DIR=${installDirectory}`;

  if (!unattended) return [directoryArgument];

  return [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/NOCANCEL",
    directoryArgument,
  ];
};

/** Kills the process tree owned by a cancelled job, leaving files untouched. */
export const terminateProcessTree = async (pid: number): Promise<void> => {
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"]).catch(
      () => undefined
    );
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process already exited.
  }
};

const waitForProcessExit = (
  child: ReturnType<typeof spawn>,
  signal: AbortSignal
): Promise<{ code: number | null } | { error: Error }> =>
  new Promise((resolve) => {
    let settled = false;

    const settle = (value: { code: number | null } | { error: Error }) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };

    const onAbort = () => {
      if (child.pid) void terminateProcessTree(child.pid);
      child.kill();
    };

    child.once("error", (error: Error) => settle({ error }));
    child.once("exit", (code: number | null) => settle({ code }));
    signal.addEventListener("abort", onAbort, { once: true });

    if (signal.aborted) onAbort();
  });

/** Confirms the installer actually produced something at the destination. */
const verifyInstallation = async (installDirectory: string): Promise<void> => {
  const entries = await fs
    .readdir(installDirectory)
    .catch(() => [] as string[]);

  if (entries.length === 0) {
    throw new InstallError(
      "install-target-empty",
      "The installer finished but the destination is still empty"
    );
  }
};

export interface FitGirlSetupRunOptions {
  plan: PreparedInstall;
  onProgress: (progress: number) => void;
  onProcessStarted: (pid: number) => void;
  signal: AbortSignal;
}

/**
 * Runs the FitGirl installer. The window stays visible unless the user opted
 * into silent switches, elevation is left to the operating system, and success
 * requires both a clean exit and files at the destination.
 */
export const runFitGirlSetup = async ({
  plan,
  onProgress,
  onProcessStarted,
  signal,
}: FitGirlSetupRunOptions): Promise<void> => {
  if (process.platform !== "win32") {
    throw new InstallError(
      "unsupported-platform",
      "Automatic installation is only supported on Windows"
    );
  }

  const arguments_ = buildFitGirlSetupArguments({
    installDirectory: plan.installDirectory,
    unattended: plan.options?.[FITGIRL_UNATTENDED_OPTION] === true,
  });

  onProgress(0);

  const child = spawn(plan.setupExecutable, arguments_, {
    cwd: plan.workingDirectory,
    shell: false,
    windowsHide: false,
    stdio: "ignore",
  });

  if (child.pid) onProcessStarted(child.pid);

  const outcome = await waitForProcessExit(child, signal);

  signal.throwIfAborted();

  if ("error" in outcome) {
    throw new InstallError(
      "installer-launch-failed",
      `The installer could not be started: ${outcome.error.message}`
    );
  }

  if (outcome.code !== 0) {
    throw new InstallError(
      "installer-failed",
      `The installer exited with code ${outcome.code ?? "unknown"}`
    );
  }

  await verifyInstallation(plan.installDirectory);

  onProgress(1);
};
