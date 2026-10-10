import { installJobsSublevel } from "@main/level";

import type { InstallJobStore } from "./install-job-manager.js";

/** Durable install job records, keyed by the game's download key. */
export const createInstallJobStore = (): InstallJobStore => ({
  get: async (id) =>
    (await installJobsSublevel.get(id).catch(() => null)) ?? null,
  put: (job) => installJobsSublevel.put(job.id, job),
  delete: (id) => installJobsSublevel.del(id).catch(() => undefined),
  values: () => installJobsSublevel.values().all(),
});
