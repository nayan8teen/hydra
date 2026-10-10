import type { DownloadInstallerProvider, InstallErrorCode } from "@types";

/** Providers Hydra ships an installer for; everything else has none. */
export const DOWNLOAD_INSTALLER_PROVIDERS: DownloadInstallerProvider[] = [
  "fitgirl",
];

export interface InstallPreparationContext {
  title: string;
  providerId: DownloadInstallerProvider;
  downloadSourceId?: string;
  /** Directory holding the downloaded package, extracted or not. */
  packageDirectory: string;
  /** Destination resolved from the user's installation preferences. */
  installDirectory: string;
  /** Whether the download's extraction preference allows expanding archives. */
  allowExtraction: boolean;
  /** Provider-owned options the user configured in Settings. */
  providerOptions?: Record<string, boolean | number | string>;
  /** 0 for the first run; a retry may reuse a destination holding leftovers. */
  attempt: number;
}

/** Phases the preparation step may report while it works. */
export type InstallPreparationPhase = "preparing" | "extracting";

export interface PreparedInstall {
  /** Absolute path of the executable the installer runs. */
  setupExecutable: string;
  /** Absolute working directory; companion data files must stay reachable. */
  workingDirectory: string;
  /** Absolute destination the installer writes to. */
  installDirectory: string;
  /** Provider-owned, validated options. Never shell text. */
  options?: Record<string, boolean | number | string>;
}

export interface InstallerProviderAdapter {
  readonly providerId: DownloadInstallerProvider;
  /**
   * False when this host cannot run the provider's installer automatically; the
   * job then stops in `awaiting-user` with a manual next step instead of
   * pretending a different platform behaves like Windows.
   */
  readonly supportsAutomaticInstall: boolean;
  prepare(
    context: InstallPreparationContext,
    signal: AbortSignal,
    onPhase: (phase: InstallPreparationPhase) => void
  ): Promise<PreparedInstall>;
  install(
    plan: PreparedInstall,
    onProgress: (progress: number) => void,
    signal: AbortSignal,
    onProcessStarted: (pid: number) => void
  ): Promise<void>;
  /** Kills only the process tree owned by a cancelled job. */
  terminate?(pid: number): Promise<void>;
}

/** Failure an adapter can raise to produce a specific, translated message. */
export class InstallError extends Error {
  public readonly code: InstallErrorCode;

  constructor(code: InstallErrorCode, message: string) {
    super(message);
    this.name = "InstallError";
    this.code = code;
  }
}
