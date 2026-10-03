import type { GoogleDriveConnectionStatus } from "@types";

export type GoogleDriveViewState =
  | "loading"
  | "not-configured"
  | "disconnected"
  | "connecting"
  | "connected"
  | "needs-reauth"
  | "failed";

export interface GoogleDrivePresentation {
  viewState: GoogleDriveViewState;
  statusKey: string;
  statusTone: "neutral" | "success" | "warning";
}

export const getGoogleDriveIntegrationPresentation = (params: {
  status: GoogleDriveConnectionStatus | null;
  isConnecting: boolean;
  hasConnectFailed: boolean;
}): GoogleDrivePresentation => {
  const { status, isConnecting, hasConnectFailed } = params;

  if (!status) {
    return {
      viewState: "loading",
      statusKey: "integration_status_not_connected",
      statusTone: "neutral",
    };
  }

  if (isConnecting) {
    return {
      viewState: "connecting",
      statusKey: "google_drive_status_connecting",
      statusTone: "neutral",
    };
  }

  if (status.state === "connected") {
    return {
      viewState: "connected",
      statusKey: "google_drive_status_connected",
      statusTone: "success",
    };
  }

  if (status.state === "needs-reauth") {
    return {
      viewState: "needs-reauth",
      statusKey: "steam_status_reconnect_required",
      statusTone: "warning",
    };
  }

  if (hasConnectFailed) {
    return {
      viewState: "failed",
      statusKey: "google_drive_status_connect_failed",
      statusTone: "warning",
    };
  }

  if (!status.settings.clientId) {
    return {
      viewState: "not-configured",
      statusKey: "integration_status_not_connected",
      statusTone: "neutral",
    };
  }

  return {
    viewState: "disconnected",
    statusKey: "integration_status_not_connected",
    statusTone: "neutral",
  };
};
