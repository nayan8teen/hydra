import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { GoogleDriveConnectionStatus } from "@types";

/** Settings route that opens the Google Drive integration card. */
export const GOOGLE_DRIVE_SETTINGS_URL = "/settings?tab=integrations";

export interface GoogleDriveConnection {
  status: GoogleDriveConnectionStatus | null;
  /** True when Drive sync is enabled and an account is connected. */
  isConnected: boolean;
  isLoading: boolean;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
}

/**
 * Fork: cloud saves are gated by the Google Drive connection instead of a
 * Hydra Cloud subscription, so the renderer needs the same connection state
 * the settings card shows.
 */
/**
 * Fork: replaces the old "show Hydra Cloud paywall" action. Features that used
 * to nag for a subscription now send the user to the Drive integration card.
 */
export function useOpenGoogleDriveSettings(): () => void {
  const navigate = useNavigate();
  return useCallback(() => navigate(GOOGLE_DRIVE_SETTINGS_URL), [navigate]);
}

export function useGoogleDriveConnection(): GoogleDriveConnection {
  const [status, setStatus] = useState<GoogleDriveConnectionStatus | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setIsLoading(true);
    try {
      const next = await globalThis.window.electron.getGoogleDriveStatus();
      setStatus(next);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh({ silent: true });
    globalThis.window.addEventListener("focus", onFocus);
    return () => {
      globalThis.window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return {
    status,
    isConnected:
      status?.state === "connected" &&
      status.settings.driveSyncEnabled === true,
    isLoading,
    refresh,
  };
}
