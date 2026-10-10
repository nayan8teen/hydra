import path from "node:path";

import type {
  DownloadInstallerProvider,
  InstallErrorCode,
  InstallJob,
  InstallJobPhase,
  InstallJobRequest,
  UserPreferences,
} from "@types";

import {
  InstallError,
  type InstallerProviderAdapter,
} from "./install-adapter.js";
import {
  getProviderInstallationPreferences,
  resolveGameInstallDirectory,
} from "./installation-preferences.js";

export interface InstallJobStore {
  get(id: string): Promise<InstallJob | null>;
  put(job: InstallJob): Promise<void>;
  delete(id: string): Promise<void>;
  values(): Promise<InstallJob[]>;
}

export interface InstallJobUpdate {
  phaseChanged: boolean;
}

export interface InstallJobManagerOptions {
  store: InstallJobStore;
  resolveAdapter: (
    providerId: DownloadInstallerProvider
  ) => InstallerProviderAdapter | null;
  getPreferences: () => Promise<UserPreferences | null>;
  onJobUpdated: (job: InstallJob, update: InstallJobUpdate) => void;
  /** Post-install work such as executable discovery; must never fail the job. */
  onJobFinished?: (job: InstallJob) => void | Promise<void>;
  now?: () => number;
  progressIntervalMs?: number;
}

const ACTIVE_INSTALL_JOB_PHASES: InstallJobPhase[] = [
  "queued",
  "preparing",
  "extracting",
  "installing",
];

export const getInstallJobId = (shop: string, objectId: string) =>
  `${shop}:${objectId}`;

export const isActiveInstallJobPhase = (phase: InstallJobPhase) =>
  ACTIVE_INSTALL_JOB_PHASES.includes(phase);

export const isRetryableInstallJobPhase = (phase: InstallJobPhase) =>
  phase === "failed" || phase === "cancelled" || phase === "awaiting-user";

const DEFAULT_PROGRESS_INTERVAL_MS = 500;

/**
 * Runs provider installers one at a time and keeps a durable record of every
 * job. Jobs are never relaunched after a restart: an interrupted job is turned
 * into a retryable failure so a second installer can only start when the user
 * asks for it.
 */
export class InstallJobManager {
  private readonly options: InstallJobManagerOptions;
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeProcessIds = new Map<string, number>();
  private readonly lastProgressEmitAt = new Map<string, number>();
  private readonly now: () => number;
  private readonly progressIntervalMs: number;
  private installerPidWrites: Promise<void> = Promise.resolve();
  private draining = false;

  constructor(options: InstallJobManagerOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.progressIntervalMs =
      options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  }

  async listJobs(): Promise<InstallJob[]> {
    const jobs = await this.options.store.values();
    return jobs.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async getJob(id: string): Promise<InstallJob | null> {
    return this.options.store.get(id);
  }

  /**
   * Registers an install request. Repeated completion events for the same
   * download return the existing job, and a job that is still running is never
   * replaced, so no two installers can be started for one game.
   */
  async enqueue(request: InstallJobRequest): Promise<InstallJob> {
    const id = getInstallJobId(request.shop, request.objectId);
    const existing = await this.options.store.get(id);

    if (
      existing &&
      (existing.downloadTimestamp === request.downloadTimestamp ||
        isActiveInstallJobPhase(existing.phase))
    ) {
      return existing;
    }

    const timestamp = this.now();
    const job: InstallJob = {
      id,
      shop: request.shop,
      objectId: request.objectId,
      title: request.title,
      providerId: request.providerId,
      downloadSourceId: request.downloadSourceId,
      downloadTimestamp: request.downloadTimestamp,
      packageDirectory: path.resolve(request.packageDirectory),
      allowExtraction: request.allowExtraction,
      installDirectory: null,
      phase: "queued",
      progress: 0,
      attempt: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
      installerPid: null,
    };

    await this.options.store.put(job);
    this.emit(job, true);
    void this.drain();

    return job;
  }

  /** Cancels a running job, killing only the process tree it started. */
  async cancel(id: string): Promise<InstallJob | null> {
    const job = await this.options.store.get(id);
    if (!job || !isActiveInstallJobPhase(job.phase)) return job;

    const controller = this.activeControllers.get(id);
    const installerPid =
      this.activeProcessIds.get(id) ?? job.installerPid ?? null;

    const cancelled: InstallJob = {
      ...job,
      phase: "cancelled",
      errorCode: "cancelled",
      errorMessage: "Installation was cancelled",
      finishedAt: this.now(),
      updatedAt: this.now(),
      installerPid: null,
    };

    await this.options.store.put(cancelled);
    this.emit(cancelled, true);

    controller?.abort(new Error("Installation was cancelled"));

    if (installerPid) {
      const adapter = this.options.resolveAdapter(job.providerId);
      await adapter?.terminate?.(installerPid).catch(() => undefined);
    }

    return cancelled;
  }

  /** Requeues a failed, cancelled or manual job; the caller asked for a retry. */
  async retry(id: string): Promise<InstallJob | null> {
    const job = await this.options.store.get(id);
    if (!job || !isRetryableInstallJobPhase(job.phase)) return job;

    const retried: InstallJob = {
      ...job,
      phase: "queued",
      progress: 0,
      attempt: job.attempt + 1,
      errorCode: null,
      errorMessage: null,
      manualStepReason: undefined,
      finishedAt: null,
      updatedAt: this.now(),
      installerPid: null,
    };

    await this.options.store.put(retried);
    this.emit(retried, true);
    void this.drain();

    return retried;
  }

  /**
   * Marks jobs left active by a previous session as interrupted. They are kept
   * for review instead of being relaunched, because the outcome of the previous
   * installer run cannot be proven.
   */
  async reconcileInterruptedJobs(): Promise<InstallJob[]> {
    const jobs = await this.options.store.values();
    const reconciled: InstallJob[] = [];

    for (const job of jobs) {
      if (!isActiveInstallJobPhase(job.phase)) continue;

      const interrupted: InstallJob = {
        ...job,
        phase: "failed",
        errorCode: "interrupted",
        errorMessage:
          "Hydra closed while this installation was running. Retry to install again.",
        finishedAt: this.now(),
        updatedAt: this.now(),
        installerPid: null,
      };

      await this.options.store.put(interrupted);
      this.emit(interrupted, true);
      reconciled.push(interrupted);
    }

    return reconciled;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;

    this.draining = true;

    try {
      let next = await this.findNextQueuedJob();

      while (next) {
        await this.runJob(next);
        next = await this.findNextQueuedJob();
      }
    } finally {
      this.draining = false;
    }

    // A job queued while the loop was unwinding would otherwise wait for the
    // next enqueue event.
    if (await this.findNextQueuedJob()) void this.drain();
  }

  private async findNextQueuedJob(): Promise<InstallJob | null> {
    const jobs = await this.options.store.values();
    const queued = jobs
      .filter((job) => job.phase === "queued")
      .sort((left, right) => left.createdAt - right.createdAt);

    return queued[0] ?? null;
  }

  private async runJob(job: InstallJob): Promise<void> {
    // The job may have been cancelled between being picked and being started.
    const latest = await this.options.store.get(job.id);

    if (!latest || latest.phase !== "queued") return;

    const adapter = this.options.resolveAdapter(job.providerId);

    if (!adapter) {
      await this.failJob(
        job,
        "unsupported-provider",
        `No installer is available for provider "${job.providerId}"`
      );
      return;
    }

    if (!adapter.supportsAutomaticInstall) {
      const awaitingUser = await this.persist({
        ...job,
        phase: "awaiting-user",
        manualStepReason: "unsupported-platform",
        updatedAt: this.now(),
      });
      await this.notifyFinished(awaitingUser);
      return;
    }

    const controller = new AbortController();
    this.activeControllers.set(job.id, controller);
    let current = job;

    try {
      const preferences = await this.options.getPreferences();
      const installDirectory = resolveGameInstallDirectory(
        preferences,
        job.providerId,
        job.title
      );

      if (!installDirectory) {
        await this.failJob(
          job,
          "install-directory-required",
          "No game installation directory is configured in Settings"
        );
        return;
      }

      current = await this.persist({
        ...current,
        phase: "preparing",
        progress: 0,
        installDirectory,
        errorCode: null,
        errorMessage: null,
        manualStepReason: undefined,
        updatedAt: this.now(),
      });

      const plan = await adapter.prepare(
        {
          title: job.title,
          providerId: job.providerId,
          downloadSourceId: job.downloadSourceId,
          packageDirectory: job.packageDirectory,
          installDirectory,
          allowExtraction: job.allowExtraction,
          providerOptions: getProviderInstallationPreferences(
            preferences,
            job.providerId
          )?.options,
          attempt: job.attempt,
        },
        controller.signal,
        (phase) => {
          if (phase === current.phase) return;
          current = { ...current, phase, updatedAt: this.now() };
          this.emit(current, true);
        }
      );

      controller.signal.throwIfAborted();

      current = await this.persist({
        ...current,
        phase: "installing",
        installDirectory: plan.installDirectory,
        updatedAt: this.now(),
      });

      await adapter.install(
        plan,
        (progress) => {
          const clamped = Math.min(Math.max(progress, 0), 1);
          const timestamp = this.now();

          if (
            clamped < 1 &&
            timestamp - (this.lastProgressEmitAt.get(job.id) ?? 0) <
              this.progressIntervalMs
          ) {
            return;
          }

          this.lastProgressEmitAt.set(job.id, timestamp);
          current = { ...current, progress: clamped, updatedAt: timestamp };
          this.emit(current, false);
        },
        controller.signal,
        (pid) => {
          this.activeProcessIds.set(job.id, pid);
          current = { ...current, installerPid: pid, updatedAt: this.now() };

          // The pid write is chained so it lands before the terminal state and
          // a finished job never keeps a stale process id.
          const snapshot = { ...current };
          this.installerPidWrites = this.installerPidWrites
            .then(() => this.options.store.put(snapshot))
            .catch(() => undefined);
        }
      );

      controller.signal.throwIfAborted();

      const succeeded = await this.persist({
        ...current,
        phase: "succeeded",
        progress: 1,
        errorCode: null,
        errorMessage: null,
        finishedAt: this.now(),
        updatedAt: this.now(),
        installerPid: null,
      });

      await this.notifyFinished(succeeded);
    } catch (error) {
      if (controller.signal.aborted) {
        const cancelled: InstallJob = {
          ...current,
          phase: "cancelled",
          errorCode: "cancelled",
          errorMessage: "Installation was cancelled",
          finishedAt: this.now(),
          updatedAt: this.now(),
          installerPid: null,
        };

        await this.persist(cancelled);
        await this.notifyFinished(cancelled);
        return;
      }

      const failure = this.describeFailure(error);
      await this.failJob(current, failure.code, failure.message);
    } finally {
      this.activeControllers.delete(job.id);
      this.activeProcessIds.delete(job.id);
      this.lastProgressEmitAt.delete(job.id);
    }
  }

  private describeFailure(error: unknown): {
    code: InstallErrorCode;
    message: string;
  } {
    if (error instanceof InstallError) {
      return { code: error.code, message: error.message };
    }

    if (error instanceof Error) {
      return { code: "unknown", message: error.message };
    }

    return { code: "unknown", message: "Unknown installation error" };
  }

  private async failJob(
    job: InstallJob,
    code: InstallErrorCode,
    message: string
  ): Promise<void> {
    const failed = await this.persist({
      ...job,
      phase: "failed",
      errorCode: code,
      errorMessage: message,
      finishedAt: this.now(),
      updatedAt: this.now(),
      installerPid: null,
    });

    await this.notifyFinished(failed);
  }

  private async persist(job: InstallJob): Promise<InstallJob> {
    await this.installerPidWrites;
    await this.options.store.put(job);
    this.emit(job, true);
    return job;
  }

  private async notifyFinished(job: InstallJob): Promise<void> {
    try {
      await this.options.onJobFinished?.(job);
    } catch {
      // Post-install bookkeeping must never turn a finished install into a
      // failure; the caller logs the reason.
    }
  }

  private emit(job: InstallJob, phaseChanged: boolean): void {
    this.options.onJobUpdated({ ...job }, { phaseChanged });
  }
}
