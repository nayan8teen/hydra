import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, PersonIcon, SyncIcon } from "@primer/octicons-react";
import { isValidGoogleDriveClientId } from "@shared";
import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { useCloudSaveBulkSync } from "@renderer/hooks/use-cloud-save-bulk-sync";
import { logger } from "@renderer/logger";
import type { GoogleDriveConnectionStatus, GoogleDriveSettings } from "@types";
import GoogleDriveLogo from "@renderer/assets/google-drive-logo.svg?react";

import { SettingsIntegrationCard } from "./settings-integration-card";
import {
  getPendingGoogleDriveConnect,
  runGoogleDriveConnect,
} from "./google-drive-connect-state";
import {
  getGoogleDriveConnectErrorMessageKey,
  getGoogleDriveIntegrationPresentation,
} from "./settings-google-drive-state";
import { getCloudSaveSyncAllPresentation } from "./settings-cloud-save-sync-progress";

import "./settings-google-drive.scss";

const STATUS_ICON_SIZE = 14;
const AVATAR_FALLBACK_ICON_SIZE = 28;

export function SettingsGoogleDrive() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const [status, setStatus] = useState<GoogleDriveConnectionStatus | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(
    () => getPendingGoogleDriveConnect() !== null
  );
  const [hasConnectFailed, setHasConnectFailed] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [sweepIntervalDraft, setSweepIntervalDraft] = useState("");
  const [avatarError, setAvatarError] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [deleteRemoteData, setDeleteRemoteData] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const didInitializeDrafts = useRef(false);
  const {
    progress: syncAllProgress,
    isRunning: isSyncAllRunning,
    runSyncAll,
  } = useCloudSaveBulkSync();

  const syncAllPresentation = getCloudSaveSyncAllPresentation(
    syncAllProgress,
    isSyncAllRunning
  );

  const presentation = getGoogleDriveIntegrationPresentation({
    status,
    isConnecting,
    hasConnectFailed,
  });
  const account = status?.state === "connected" ? status.account : null;
  const isClientIdValid = isValidGoogleDriveClientId(clientIdDraft);
  const clientIdError =
    clientIdDraft.trim().length > 0 && !isClientIdValid
      ? t("google_drive_client_id_invalid")
      : undefined;

  useEffect(() => {
    setAvatarError(false);
  }, [account?.photoUrl]);

  const refreshStatus = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setIsLoading(true);

    try {
      const next = await globalThis.window.electron.getGoogleDriveStatus();
      setStatus(next);

      if (!didInitializeDrafts.current) {
        didInitializeDrafts.current = true;
        setClientIdDraft(next.settings.clientId ?? "");
        setFolderDraft(next.settings.folderName);
        setSweepIntervalDraft(
          String(next.settings.backgroundSweepIntervalMinutes)
        );
      }

      if (next.state !== "disconnected") setHasConnectFailed(false);
    } catch (error) {
      logger.error(error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const pending = getPendingGoogleDriveConnect();
    if (!pending) return;

    let cancelled = false;

    void pending.promise
      .then(() => {
        if (cancelled) return;
        showSuccessToast(t("google_drive_connected"));
        setHasConnectFailed(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setHasConnectFailed(true);
        logger.error(error);
      })
      .finally(() => {
        if (cancelled) return;
        setIsConnecting(false);
        void refreshStatus({ silent: true });
      });

    return () => {
      cancelled = true;
    };
  }, [refreshStatus, showSuccessToast, t]);

  useEffect(() => {
    const onFocus = () => {
      void refreshStatus({ silent: true });
    };

    globalThis.window.addEventListener("focus", onFocus);

    return () => {
      globalThis.window.removeEventListener("focus", onFocus);
    };
  }, [refreshStatus]);

  const saveSettings = useCallback(
    async (patch: Partial<GoogleDriveSettings>) => {
      setIsSaving(true);

      try {
        const settings =
          await globalThis.window.electron.setGoogleDriveSettings(patch);
        setStatus((current) => (current ? { ...current, settings } : current));
        return settings;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const handleConnect = async () => {
    if (!isClientIdValid) {
      showErrorToast(t("google_drive_client_id_invalid"));
      return;
    }

    const clientId = clientIdDraft.trim();
    setIsConnecting(true);
    setHasConnectFailed(false);

    try {
      await saveSettings({ clientId });
      await runGoogleDriveConnect(() =>
        globalThis.window.electron.connectGoogleDrive(clientId)
      );
      showSuccessToast(t("google_drive_connected"));
      await refreshStatus({ silent: true });
    } catch (error) {
      logger.error(error);
      setHasConnectFailed(true);
      showErrorToast(t(getGoogleDriveConnectErrorMessageKey(error)));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCancelConnect = async () => {
    await globalThis.window.electron.cancelGoogleDriveConnect();
  };

  const handleSyncToggle = async (enabled: boolean) => {
    try {
      await saveSettings({ driveSyncEnabled: enabled });
      if (enabled) {
        showSuccessToast(t("google_drive_sync_enabled_toast"));
      }
    } catch (error) {
      logger.error(error);
      showErrorToast(t("google_drive_settings_error"));
    }
  };

  const handleFolderBlur = async () => {
    if (!status || folderDraft === status.settings.folderName) return;

    try {
      await saveSettings({ folderName: folderDraft });
    } catch (error) {
      logger.error(error);
      showErrorToast(t("google_drive_settings_error"));
    }
  };

  const handleSweepToggle = async (enabled: boolean) => {
    try {
      await saveSettings({ backgroundSweepEnabled: enabled });
    } catch (error) {
      logger.error(error);
      showErrorToast(t("google_drive_settings_error"));
    }
  };

  const handleSweepIntervalBlur = async () => {
    const minutes = Number.parseInt(sweepIntervalDraft, 10);
    if (!Number.isFinite(minutes)) {
      setSweepIntervalDraft(
        String(status?.settings.backgroundSweepIntervalMinutes ?? "")
      );
      return;
    }

    try {
      const settings = await saveSettings({
        backgroundSweepIntervalMinutes: minutes,
      });
      setSweepIntervalDraft(String(settings.backgroundSweepIntervalMinutes));
    } catch (error) {
      logger.error(error);
      showErrorToast(t("google_drive_settings_error"));
    }
  };

  const handleSyncAll = async () => {
    const result = await runSyncAll();

    if (!result || result.failed > 0) {
      showErrorToast(t("google_drive_sync_all_failed"));
      return;
    }

    showSuccessToast(
      t("google_drive_sync_all_done", {
        synced: result.synced,
        skipped: result.skipped,
        conflicts: result.conflicts,
      })
    );
  };

  const handleDisconnect = async () => {
    setShowDisconnectModal(false);
    setIsDisconnecting(true);

    try {
      await globalThis.window.electron.disconnectGoogleDrive({
        deleteRemoteData,
      });
      showSuccessToast(t("google_drive_disconnected"));
      setHasConnectFailed(false);
      setDeleteRemoteData(false);
      didInitializeDrafts.current = false;
      await refreshStatus({ silent: true });
    } catch (error) {
      logger.error(error);
      showErrorToast(t("google_drive_disconnect_error"));
    } finally {
      setIsDisconnecting(false);
    }
  };

  const renderBody = () => {
    if (isLoading && !status) {
      return <p>{t("google_drive_loading")}</p>;
    }

    if (presentation.viewState === "connecting") {
      return (
        <div className="settings-google-drive__progress" role="status">
          <p className="settings-integration-card__message">
            {t("google_drive_connecting_hint")}
          </p>
          <div className="settings-integration-card__progress-track">
            <div className="settings-integration-card__progress-fill settings-integration-card__progress-fill--indeterminate" />
          </div>
        </div>
      );
    }

    if (account) {
      return (
        <>
          <div className="settings-integration-card__profile">
            <div className="settings-integration-card__avatar">
              {account.photoUrl && !avatarError ? (
                <img
                  src={account.photoUrl}
                  alt={account.displayName}
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <PersonIcon size={AVATAR_FALLBACK_ICON_SIZE} />
              )}
            </div>

            <div className="settings-integration-card__account">
              <span className="settings-integration-card__username">
                {account.displayName}
              </span>
              <span className="settings-integration-card__meta">
                {account.email}
              </span>
            </div>
          </div>

          <div className="settings-google-drive__options">
            <CheckboxField
              label={t("google_drive_sync_enabled_label")}
              checked={status?.settings.driveSyncEnabled === true}
              disabled={isSaving || isDisconnecting}
              onChange={() =>
                void handleSyncToggle(
                  status?.settings.driveSyncEnabled !== true
                )
              }
            />

            <TextField
              label={t("google_drive_folder_label")}
              hint={t("google_drive_folder_hint")}
              value={folderDraft}
              disabled={isSaving || isDisconnecting}
              onChange={(event) => setFolderDraft(event.target.value)}
              onBlur={() => void handleFolderBlur()}
            />

            <CheckboxField
              label={t("google_drive_background_sweep_label")}
              checked={status?.settings.backgroundSweepEnabled === true}
              disabled={
                isSaving ||
                isDisconnecting ||
                status?.settings.driveSyncEnabled !== true
              }
              onChange={() =>
                void handleSweepToggle(
                  status?.settings.backgroundSweepEnabled !== true
                )
              }
            />

            {status?.settings.driveSyncEnabled === true &&
              status?.settings.backgroundSweepEnabled === true && (
                <TextField
                  label={t("google_drive_sweep_interval_label")}
                  hint={t("google_drive_sweep_interval_hint")}
                  value={sweepIntervalDraft}
                  disabled={isSaving || isDisconnecting}
                  onChange={(event) =>
                    setSweepIntervalDraft(event.target.value)
                  }
                  onBlur={() => void handleSweepIntervalBlur()}
                />
              )}
          </div>

          <div className="settings-google-drive__sync-all">
            <Button
              theme="outline"
              onClick={() => void handleSyncAll()}
              disabled={isSaving || isDisconnecting || isSyncAllRunning}
            >
              <SyncIcon size={STATUS_ICON_SIZE} />
              {t("google_drive_sync_all_action")}
            </Button>

            {syncAllPresentation.isVisible && (
              <div
                className="settings-integration-card__progress"
                role="status"
              >
                <div className="settings-integration-card__progress-header">
                  <span>
                    {t("google_drive_sync_all_progress", {
                      processed: syncAllPresentation.processed,
                      total: syncAllPresentation.total,
                    })}
                  </span>
                  {syncAllPresentation.currentLabel && (
                    <span className="settings-integration-card__progress-count">
                      {syncAllPresentation.currentLabel}
                    </span>
                  )}
                </div>
                <div className="settings-integration-card__progress-track">
                  <div
                    className={`settings-integration-card__progress-fill ${
                      syncAllPresentation.percent === null
                        ? "settings-integration-card__progress-fill--indeterminate"
                        : "settings-integration-card__progress-fill--determinate"
                    }`}
                    style={
                      syncAllPresentation.percent === null
                        ? undefined
                        : { width: `${syncAllPresentation.percent}%` }
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </>
      );
    }

    return (
      <>
        <p className="settings-integration-card__description">
          {presentation.viewState === "needs-reauth"
            ? t("google_drive_reauth_description")
            : t("google_drive_description")}
        </p>

        <TextField
          label={t("google_drive_client_id_label")}
          hint={t("google_drive_client_id_hint")}
          error={clientIdError}
          placeholder="xxxxxxxx.apps.googleusercontent.com"
          value={clientIdDraft}
          disabled={isSaving || isDisconnecting}
          onChange={(event) => setClientIdDraft(event.target.value)}
        />
      </>
    );
  };

  const renderActions = () => {
    if (isLoading && !status) return null;

    if (presentation.viewState === "connecting") {
      return (
        <Button theme="outline" onClick={() => void handleCancelConnect()}>
          {t("cancel")}
        </Button>
      );
    }

    if (account) {
      return (
        <Button
          theme="danger"
          onClick={() => setShowDisconnectModal(true)}
          disabled={isDisconnecting}
        >
          {t("integration_disconnect")}
        </Button>
      );
    }

    return (
      <Button
        onClick={() => void handleConnect()}
        disabled={isSaving || !isClientIdValid}
      >
        <LinkExternalIcon size={STATUS_ICON_SIZE} />
        {presentation.viewState === "needs-reauth"
          ? t("integration_reconnect")
          : t("integration_connect")}
      </Button>
    );
  };

  return (
    <>
      <SettingsIntegrationCard
        title={t("google_drive")}
        logo={<GoogleDriveLogo />}
        status={t(presentation.statusKey)}
        statusTone={presentation.statusTone}
        actions={renderActions()}
        loading={isLoading && !status}
      >
        {renderBody()}
      </SettingsIntegrationCard>

      <Modal
        visible={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        clickOutsideToClose={!isDisconnecting}
        title={t("google_drive_disconnect_title")}
        description={t("google_drive_disconnect_description")}
      >
        <div className="settings-google-drive__modal">
          <CheckboxField
            label={t("google_drive_delete_data_label")}
            checked={deleteRemoteData}
            disabled={isDisconnecting}
            onChange={() => setDeleteRemoteData((current) => !current)}
          />

          <div className="settings-google-drive__modal-actions">
            <Button
              theme="outline"
              onClick={() => setShowDisconnectModal(false)}
              disabled={isDisconnecting}
            >
              {t("cancel")}
            </Button>
            <Button
              theme="danger"
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting}
            >
              {t("integration_disconnect")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
