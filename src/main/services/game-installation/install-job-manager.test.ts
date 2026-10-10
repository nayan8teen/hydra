import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  DownloadInstallerProvider,
  InstallJob,
  InstallJobRequest,
  UserPreferences,
} from "@types";

import {
  InstallError,
  type InstallPreparationContext,
  type InstallerProviderAdapter,
  type PreparedInstall,
} from "./install-adapter.js";
import {
  InstallJobManager,
  getInstallJobId,
  type InstallJobStore,
} from "./install-job-manager.js";

const installBaseDirectory = path.join(os.tmpdir(), "hydra-install-tests");
const packageDirectory = path.join(os.tmpdir(), "hydra-packages", "game");

const preferences: UserPreferences = {
  automaticInstallation: {
    baseDirectory: installBaseDirectory,
    providers: { fitgirl: { enabled: true } },
  },
};

const createStore = () => {
  const jobs = new Map<string, InstallJob>();

  const store: InstallJobStore = {
    get: async (id) => jobs.get(id) ?? null,
    put: async (job) => {
      jobs.set(job.id, job);
    },
    delete: async (id) => {
      jobs.delete(id);
    },
    values: async () => [...jobs.values()],
  };

  return { store, jobs };
};

const createRequest = (
  overrides: Partial<InstallJobRequest> = {}
): InstallJobRequest => ({
  shop: "steam",
  objectId: "123",
  title: "Example Game",
  providerId: "fitgirl",
  downloadTimestamp: 1000,
  packageDirectory,
  allowExtraction: true,
  ...overrides,
});

interface TestAdapter extends InstallerProviderAdapter {
  prepareCalls: string[];
  preparedContexts: InstallPreparationContext[];
  installCalls: string[];
  maxConcurrentInstalls: number;
  terminatedPids: number[];
}

const createAdapter = (
  options: {
    providerId?: DownloadInstallerProvider;
    supportsAutomaticInstall?: boolean;
    reportExtracting?: boolean;
    prepare?: (context: InstallPreparationContext) => Promise<PreparedInstall>;
    install?: (
      plan: PreparedInstall,
      onProgress: (progress: number) => void,
      signal: AbortSignal,
      onProcessStarted: (pid: number) => void
    ) => Promise<void>;
  } = {}
): TestAdapter => {
  let activeInstalls = 0;

  const adapter: TestAdapter = {
    providerId: options.providerId ?? "fitgirl",
    supportsAutomaticInstall: options.supportsAutomaticInstall ?? true,
    prepareCalls: [],
    preparedContexts: [],
    installCalls: [],
    maxConcurrentInstalls: 0,
    terminatedPids: [],
    prepare: async (context, _signal, onPhase) => {
      adapter.prepareCalls.push(context.title);
      adapter.preparedContexts.push(context);

      if (options.reportExtracting) onPhase("extracting");

      if (options.prepare) return options.prepare(context);

      return {
        setupExecutable: path.join(context.packageDirectory, "setup.exe"),
        workingDirectory: context.packageDirectory,
        installDirectory: context.installDirectory,
      };
    },
    install: async (plan, onProgress, signal, onProcessStarted) => {
      adapter.installCalls.push(plan.installDirectory);
      activeInstalls += 1;
      adapter.maxConcurrentInstalls = Math.max(
        adapter.maxConcurrentInstalls,
        activeInstalls
      );

      try {
        if (options.install) {
          await options.install(plan, onProgress, signal, onProcessStarted);
          return;
        }

        onProcessStarted(4242);
        onProgress(1);
      } finally {
        activeInstalls -= 1;
      }
    },
    terminate: async (pid) => {
      adapter.terminatedPids.push(pid);
    },
  };

  return adapter;
};

const createManager = (
  overrides: {
    store?: InstallJobStore;
    adapters?: InstallerProviderAdapter[];
    preferences?: UserPreferences | null;
    now?: () => number;
  } = {}
) => {
  const { store, jobs } = createStore();
  const adapters = overrides.adapters ?? [createAdapter()];
  const updates: InstallJob[] = [];
  const finished: InstallJob[] = [];

  const manager = new InstallJobManager({
    store: overrides.store ?? store,
    resolveAdapter: (providerId) =>
      adapters.find((adapter) => adapter.providerId === providerId) ?? null,
    getPreferences: async () =>
      overrides.preferences === undefined ? preferences : overrides.preferences,
    onJobUpdated: (job) => updates.push(job),
    onJobFinished: (job) => {
      finished.push(job);
    },
    now: overrides.now,
  });

  return { manager, jobs, updates, finished };
};

const waitFor = async (
  predicate: () => Promise<boolean>,
  timeoutMs = 2000
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for an install job state");
};

test("queues one job per game and installs it to the configured destination", async () => {
  const adapter = createAdapter();
  const { manager } = createManager({ adapters: [adapter] });

  const job = await manager.enqueue(createRequest());

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "succeeded"
  );

  const finishedJob = await manager.getJob(job.id);

  assert.equal(finishedJob?.progress, 1);
  assert.equal(finishedJob?.installerPid, null);
  assert.equal(finishedJob?.errorCode, null);
  assert.equal(
    finishedJob?.installDirectory,
    path.join(installBaseDirectory, "Example Game")
  );
  assert.deepEqual(adapter.installCalls, [finishedJob?.installDirectory]);
});

test("repeated completion events for the same download never install twice", async () => {
  const adapter = createAdapter();
  const { manager } = createManager({ adapters: [adapter] });

  const first = await manager.enqueue(createRequest());
  const second = await manager.enqueue(createRequest());

  await waitFor(
    async () => (await manager.getJob(first.id))?.phase === "succeeded"
  );
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(first.id, second.id);
  assert.equal(adapter.prepareCalls.length, 1);
  assert.equal(adapter.installCalls.length, 1);
});

test("a running job is not replaced by a new download of the same game", async () => {
  let release: (() => void) | undefined;
  const adapter = createAdapter({
    install: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const { manager } = createManager({ adapters: [adapter] });

  const job = await manager.enqueue(createRequest());

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "installing"
  );

  const second = await manager.enqueue(
    createRequest({ downloadTimestamp: 2000 })
  );

  assert.equal(second.downloadTimestamp, 1000);

  release?.();
  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "succeeded"
  );
});

test("runs one installer at a time, in the order jobs were queued", async () => {
  const adapter = createAdapter();
  const { manager } = createManager({ adapters: [adapter] });

  await manager.enqueue(createRequest({ objectId: "1", title: "First" }));
  await manager.enqueue(createRequest({ objectId: "2", title: "Second" }));

  await waitFor(async () => {
    const jobs = await manager.listJobs();
    return jobs.every((job) => job.phase === "succeeded");
  });

  assert.deepEqual(adapter.prepareCalls, ["First", "Second"]);
  assert.equal(adapter.maxConcurrentInstalls, 1);
});

test("fails with an actionable reason when no installation directory is configured", async () => {
  const adapter = createAdapter();
  const { manager } = createManager({
    adapters: [adapter],
    preferences: {
      automaticInstallation: { providers: { fitgirl: { enabled: true } } },
    },
  });

  const job = await manager.enqueue(createRequest());

  await waitFor(async () => (await manager.getJob(job.id))?.phase === "failed");

  const failedJob = await manager.getJob(job.id);

  assert.equal(failedJob?.errorCode, "install-directory-required");
  assert.equal(adapter.installCalls.length, 0);
});

test("keeps a provider without automatic support in awaiting-user instead of installing", async () => {
  const adapter = createAdapter({ supportsAutomaticInstall: false });
  const { manager } = createManager({ adapters: [adapter] });

  const job = await manager.enqueue(createRequest());

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "awaiting-user"
  );

  const awaitingJob = await manager.getJob(job.id);

  assert.equal(awaitingJob?.manualStepReason, "unsupported-platform");
  assert.equal(adapter.installCalls.length, 0);
});

test("fails when the source has no known installer provider", async () => {
  const { manager } = createManager({ adapters: [] });
  const job = await manager.enqueue(createRequest());

  await waitFor(async () => (await manager.getJob(job.id))?.phase === "failed");

  const failedJob = await manager.getJob(job.id);

  assert.equal(failedJob?.errorCode, "unsupported-provider");
});

test("surfaces an adapter failure with its stable error code", async () => {
  const adapter = createAdapter({
    prepare: async () => {
      throw new InstallError("missing-archive-volumes", "Part 2 is missing");
    },
  });
  const { manager } = createManager({ adapters: [adapter] });

  const job = await manager.enqueue(createRequest());

  await waitFor(async () => (await manager.getJob(job.id))?.phase === "failed");

  const failedJob = await manager.getJob(job.id);

  assert.equal(failedJob?.errorCode, "missing-archive-volumes");
  assert.equal(failedJob?.errorMessage, "Part 2 is missing");
});

test("cancels a running install and kills only its process tree", async () => {
  const adapter = createAdapter({
    install: async (_plan, _onProgress, signal, onProcessStarted) => {
      onProcessStarted(9001);

      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });

      signal.throwIfAborted();
    },
  });
  const { manager } = createManager({ adapters: [adapter] });

  const job = await manager.enqueue(createRequest());

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "installing"
  );

  const cancelled = await manager.cancel(job.id);

  assert.equal(cancelled?.phase, "cancelled");
  assert.deepEqual(adapter.terminatedPids, [9001]);

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "cancelled"
  );

  assert.equal((await manager.getJob(job.id))?.errorCode, "cancelled");
});

test("retries a failed install and counts the attempt", async () => {
  let attempts = 0;
  const adapter = createAdapter({
    install: async (_plan, onProgress) => {
      attempts += 1;

      if (attempts === 1) {
        throw new InstallError("installer-failed", "Installer crashed");
      }

      onProgress(1);
    },
  });
  const { manager } = createManager({ adapters: [adapter] });

  const job = await manager.enqueue(createRequest());

  await waitFor(async () => (await manager.getJob(job.id))?.phase === "failed");

  const retried = await manager.retry(job.id);

  assert.equal(retried?.attempt, 1);
  assert.equal(retried?.phase, "queued");

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "succeeded"
  );

  const succeededJob = await manager.getJob(job.id);

  assert.equal(succeededJob?.attempt, 1);
  assert.equal(succeededJob?.errorCode, null);
  assert.equal(adapter.installCalls.length, 2);
});

test("retry is refused for a job that already succeeded", async () => {
  const { manager } = createManager();
  const job = await manager.enqueue(createRequest());

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "succeeded"
  );

  const retried = await manager.retry(job.id);

  assert.equal(retried?.phase, "succeeded");
  assert.equal(retried?.attempt, 0);
});

test("throttles progress notifications but keeps the final progress", async () => {
  const adapter = createAdapter({
    install: async (_plan, onProgress) => {
      onProgress(0.25);
      onProgress(0.5);
      onProgress(0.75);
    },
  });
  const { manager, updates } = createManager({
    adapters: [adapter],
    now: () => 1_000_000,
  });

  const job = await manager.enqueue(createRequest());

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "succeeded"
  );

  const reportedProgress = updates.map((update) => update.progress);

  assert.deepEqual(
    reportedProgress.filter((progress) => progress === 0.5),
    []
  );
  assert.equal((await manager.getJob(job.id))?.progress, 1);
});

test("passes the user's provider options to the adapter and reports the extracting phase", async () => {
  const adapter = createAdapter({ reportExtracting: true });
  const { manager, updates } = createManager({
    adapters: [adapter],
    preferences: {
      automaticInstallation: {
        baseDirectory: installBaseDirectory,
        providers: {
          fitgirl: { enabled: true, options: { unattended: true } },
        },
      },
    },
  });

  const job = await manager.enqueue(createRequest());

  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "succeeded"
  );

  assert.equal(adapter.preparedContexts[0].providerOptions?.unattended, true);
  assert.ok(updates.some((update) => update.phase === "extracting"));
});

test("reconciles interrupted jobs on start without relaunching an installer", async () => {
  const adapter = createAdapter();
  const { store } = createStore();
  const interrupted: InstallJob = {
    id: getInstallJobId("steam", "999"),
    shop: "steam",
    objectId: "999",
    title: "Interrupted Game",
    providerId: "fitgirl",
    downloadTimestamp: 500,
    packageDirectory,
    allowExtraction: true,
    installDirectory: path.join(installBaseDirectory, "Interrupted Game"),
    phase: "installing",
    progress: 0.4,
    attempt: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 2,
    finishedAt: null,
    installerPid: 8123,
  };

  await store.put(interrupted);

  const { manager } = createManager({ store, adapters: [adapter] });

  const reconciled = await manager.reconcileInterruptedJobs();

  assert.equal(reconciled.length, 1);

  const reconciledJob = await manager.getJob(interrupted.id);

  assert.equal(reconciledJob?.phase, "failed");
  assert.equal(reconciledJob?.errorCode, "interrupted");
  assert.equal(reconciledJob?.installerPid, null);

  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(adapter.prepareCalls.length, 0);
  assert.equal(adapter.installCalls.length, 0);
});

test("reconciliation ignores jobs that already finished", async () => {
  const { store } = createStore();
  const { manager } = createManager({ store });

  await store.put({
    id: getInstallJobId("steam", "555"),
    shop: "steam",
    objectId: "555",
    title: "Finished Game",
    providerId: "fitgirl",
    downloadTimestamp: 500,
    packageDirectory,
    allowExtraction: true,
    installDirectory: path.join(installBaseDirectory, "Finished Game"),
    phase: "succeeded",
    progress: 1,
    attempt: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 2,
    finishedAt: 2,
    installerPid: null,
  });

  const reconciled = await manager.reconcileInterruptedJobs();

  assert.deepEqual(reconciled, []);
  assert.equal((await manager.getJob("steam:555"))?.phase, "succeeded");
});

test("cancelling a finished job leaves it untouched", async () => {
  const adapter = createAdapter();
  const { manager } = createManager({ adapters: [adapter] });

  const job = await manager.enqueue(createRequest());
  await waitFor(
    async () => (await manager.getJob(job.id))?.phase === "succeeded"
  );

  const cancelled = await manager.cancel(job.id);

  assert.equal(cancelled?.phase, "succeeded");
  assert.deepEqual(adapter.terminatedPids, []);
});
