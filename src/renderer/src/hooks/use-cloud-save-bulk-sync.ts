import { useCallback, useEffect, useState } from "react";

import type {
  CloudSaveBulkSyncProgress,
  CloudSaveBulkSyncResult,
} from "@types";

export function useCloudSaveBulkSync() {
  const [progress, setProgress] = useState<CloudSaveBulkSyncProgress | null>(
    null
  );
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let active = true;

    void globalThis.window.electron.getActiveCloudSaveBulkSync().then(
      (current) => {
        if (!active || !current) return;
        setProgress(current);
        setIsRunning(true);
      },
      () => undefined
    );

    const unsubscribe = globalThis.window.electron.onCloudSaveBulkSyncProgress(
      (payload) => {
        const finished = payload.processed >= payload.total;
        setProgress(finished ? null : payload);
        setIsRunning(!finished);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const runSyncAll =
    useCallback(async (): Promise<CloudSaveBulkSyncResult | null> => {
      setIsRunning(true);

      try {
        return await globalThis.window.electron.syncAllCloudSaves();
      } catch {
        return null;
      } finally {
        setIsRunning(false);
        setProgress(null);
      }
    }, []);

  return { progress, isRunning, runSyncAll };
}
