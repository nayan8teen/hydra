import type { GameShop } from "./game.types";

/**
 * Stable identifiers for download sources whose packages Hydra knows how to
 * install. A source only gets a provider when a maintainer maps it explicitly;
 * packages are never recognized from file names, URLs or titles.
 */
export type DownloadInstallerProvider = "fitgirl";

/**
 * Lifecycle of an install job. Install state is intentionally separate from
 * `Download.status` so extraction and installation never share a flag.
 */
export type InstallJobPhase =
  | "queued"
  | "preparing"
  | "extracting"
  | "installing"
  | "awaiting-user"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Machine-readable failure reason. The renderer maps these to translated,
 * actionable messages, so they must stay stable.
 */
export type InstallErrorCode =
  | "unsupported-provider"
  | "unsupported-platform"
  | "missing-package"
  | "missing-archive-volumes"
  | "missing-setup"
  | "ambiguous-setup"
  | "unsupported-layout"
  | "extraction-required"
  | "extraction-failed"
  | "install-directory-required"
  | "target-conflict"
  | "installer-launch-failed"
  | "installer-failed"
  | "install-target-empty"
  | "interrupted"
  | "cancelled"
  | "unknown";

/** Reason an install cannot be completed automatically on this host. */
export type InstallManualStepReason = "unsupported-platform";

export interface InstallJob {
  /** Stable job id: one job per game, keyed by `shop:objectId`. */
  id: string;
  shop: GameShop;
  objectId: string;
  title: string;
  providerId: DownloadInstallerProvider;
  downloadSourceId?: string;
  /** Timestamp of the download that requested the install, for deduplication. */
  downloadTimestamp: number;
  /** Directory holding the downloaded (and possibly extracted) package. */
  packageDirectory: string;
  /** Extraction preference of the download that requested the install. */
  allowExtraction: boolean;
  /** Destination chosen from the user's installation preferences. */
  installDirectory: string | null;
  phase: InstallJobPhase;
  /** Overall progress of the job, 0..1. */
  progress: number;
  attempt: number;
  errorCode: InstallErrorCode | null;
  errorMessage: string | null;
  manualStepReason?: InstallManualStepReason;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /**
   * Process id of a launched installer while one runs. Persisted so a restart
   * can tell an interrupted job apart from a safely retryable one.
   */
  installerPid?: number | null;
}

export interface AutomaticInstallationProviderPreferences {
  enabled?: boolean;
  /** Provider-specific destination; falls back to the global base directory. */
  installDirectory?: string | null;
  /** Provider-owned, validated installer options. Never shell text. */
  options?: Record<string, boolean | number | string>;
}

export interface AutomaticInstallationPreferences {
  baseDirectory?: string | null;
  providers?: Partial<
    Record<DownloadInstallerProvider, AutomaticInstallationProviderPreferences>
  >;
}

export interface InstallJobRequest {
  shop: GameShop;
  objectId: string;
  title: string;
  providerId: DownloadInstallerProvider;
  downloadSourceId?: string;
  downloadTimestamp: number;
  packageDirectory: string;
  allowExtraction: boolean;
}
