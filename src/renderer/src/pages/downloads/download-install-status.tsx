import { useTranslation } from "react-i18next";

import type { InstallJob, InstallJobPhase } from "@types";

export interface DownloadInstallStatusProps {
  job: InstallJob | undefined;
  onCancel: () => void;
  onRetry: () => void;
  onOpenInstaller?: () => void;
}

const ACTIVE_PHASE_LABEL_KEYS: Partial<Record<InstallJobPhase, string>> = {
  queued: "installation_queued",
  preparing: "installation_preparing",
  extracting: "installation_extracting",
  installing: "installation_installing",
};

export function DownloadInstallStatus({
  job,
  onCancel,
  onRetry,
  onOpenInstaller,
}: Readonly<DownloadInstallStatusProps>) {
  const { t } = useTranslation("downloads");

  if (!job) return null;

  const activeLabelKey = ACTIVE_PHASE_LABEL_KEYS[job.phase];

  if (activeLabelKey) {
    return (
      <div className="download-group__install-status">
        <span className="download-group__install-status-text">
          {t(activeLabelKey)}
          {job.phase === "installing" &&
            ` (${Math.round(job.progress * 100)}%)`}
        </span>

        <button
          type="button"
          className="download-group__install-status-action"
          onClick={onCancel}
        >
          {t("installation_cancel")}
        </button>
      </div>
    );
  }

  if (job.phase === "awaiting-user") {
    return (
      <div className="download-group__install-status">
        <span className="download-group__install-status-text">
          {t("installation_awaiting_user")}
        </span>

        {onOpenInstaller && (
          <button
            type="button"
            className="download-group__install-status-action"
            onClick={onOpenInstaller}
          >
            {t("install")}
          </button>
        )}
      </div>
    );
  }

  if (job.phase === "succeeded") {
    return (
      <div className="download-group__install-status download-group__install-status--succeeded">
        <span className="download-group__install-status-text">
          {t("installation_succeeded")}
        </span>
      </div>
    );
  }

  const isFailed = job.phase === "failed";

  return (
    <div
      className={`download-group__install-status ${isFailed ? "download-group__install-status--failed" : ""}`}
    >
      <span className="download-group__install-status-text">
        {isFailed ? t("installation_failed") : t("installation_cancelled")}
        {isFailed && ` - ${t(`install_error_${job.errorCode ?? "unknown"}`)}`}
      </span>

      <button
        type="button"
        className="download-group__install-status-action"
        onClick={onRetry}
      >
        {t("installation_retry")}
      </button>
    </div>
  );
}
