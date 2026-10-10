import { useCallback, useEffect, useState } from "react";

import type { GameShop, InstallJob } from "@types";

type InstallJobMap = Record<string, InstallJob>;

export const getInstallJobKey = (shop: GameShop, objectId: string) =>
  `${shop}:${objectId}`;

export function useInstallJobs() {
  const [installJobs, setInstallJobs] = useState<InstallJobMap>({});

  useEffect(() => {
    let isMounted = true;

    window.electron
      .getInstallJobs()
      .then((jobs) => {
        if (!isMounted) return;

        const nextJobs: InstallJobMap = {};

        for (const job of jobs) {
          nextJobs[job.id] = job;
        }

        setInstallJobs(nextJobs);
      })
      .catch(() => {
        if (isMounted) setInstallJobs({});
      });

    const unsubscribe = window.electron.onInstallJobUpdated((job) => {
      setInstallJobs((previousJobs) => ({
        ...previousJobs,
        [job.id]: job,
      }));
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const applyJob = useCallback((job: InstallJob | null) => {
    if (!job) return;

    setInstallJobs((previousJobs) => ({ ...previousJobs, [job.id]: job }));
  }, []);

  const getInstallJob = useCallback(
    (shop: GameShop, objectId: string) =>
      installJobs[getInstallJobKey(shop, objectId)],
    [installJobs]
  );

  const cancelInstallation = useCallback(
    async (shop: GameShop, objectId: string) => {
      applyJob(await window.electron.cancelGameInstallation(shop, objectId));
    },
    [applyJob]
  );

  const retryInstallation = useCallback(
    async (shop: GameShop, objectId: string) => {
      applyJob(await window.electron.retryGameInstallation(shop, objectId));
    },
    [applyJob]
  );

  return {
    installJobs,
    getInstallJob,
    cancelInstallation,
    retryInstallation,
  };
}
