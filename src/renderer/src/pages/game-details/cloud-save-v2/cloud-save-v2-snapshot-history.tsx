import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  CloudIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import type {
  CloudSaveHistorySnapshot,
  CloudSaveSnapshotFiles,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";
import { formatBytes } from "@shared";
import { Button, CheckboxField, Modal } from "@renderer/components";
import { useDate, useToast } from "@renderer/hooks";

/**
 * Mirrors the main-process `cloudSaveFileKey` identity so a selection maps back
 * to the exact manifest entry the restore service expects.
 */
const snapshotFileKey = ({
  variantId,
  rawPath,
  relativePath,
}: {
  variantId: string;
  rawPath: string;
  relativePath: string;
}) => JSON.stringify([variantId, rawPath, relativePath]);

interface CloudSaveV2SnapshotHistoryProps {
  visible: boolean;
  objectId: string;
  shop: GameShop;
  isGameRunning: boolean;
  onRestored: () => void;
  onClose: () => void;
}

export function CloudSaveV2SnapshotHistory({
  visible,
  objectId,
  shop,
  isGameRunning,
  onRestored,
  onClose,
}: Readonly<CloudSaveV2SnapshotHistoryProps>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const { showErrorToast, showSuccessToast } = useToast();
  const [snapshots, setSnapshots] = useState<CloudSaveHistorySnapshot[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [hasSnapshotsError, setHasSnapshotsError] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null
  );
  const [snapshotFiles, setSnapshotFiles] =
    useState<CloudSaveSnapshotFiles | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [hasFilesError, setHasFilesError] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set()
  );
  const [isRestoring, setIsRestoring] = useState(false);
  const [progress, setProgress] = useState<CloudSaveSyncProgressPayload | null>(
    null
  );

  const loadSnapshots = useCallback(async () => {
    setIsLoadingSnapshots(true);
    setHasSnapshotsError(false);
    try {
      const list = await window.electron.listCloudSaveSnapshots(objectId, shop);
      setSnapshots(list);
      setSelectedSnapshotId((current) =>
        current && list.some((snapshot) => snapshot.id === current)
          ? current
          : (list[0]?.id ?? null)
      );
    } catch {
      setHasSnapshotsError(true);
    } finally {
      setIsLoadingSnapshots(false);
    }
  }, [objectId, shop]);

  useEffect(() => {
    if (!visible) {
      setSnapshots([]);
      setSnapshotFiles(null);
      setSelectedSnapshotId(null);
      setSelectedEntryIds(new Set());
      setProgress(null);
      setIsRestoring(false);
      return;
    }
    void loadSnapshots();
  }, [visible, loadSnapshots]);

  useEffect(() => {
    if (!visible || !selectedSnapshotId) {
      setSnapshotFiles(null);
      setSelectedEntryIds(new Set());
      return;
    }

    let canceled = false;
    setIsLoadingFiles(true);
    setHasFilesError(false);
    setSnapshotFiles(null);
    setSelectedEntryIds(new Set());
    void window.electron
      .getCloudSaveSnapshotFiles(objectId, shop, selectedSnapshotId)
      .then((files) => {
        if (canceled) return;
        setSnapshotFiles(files);
      })
      .catch(() => {
        if (canceled) return;
        setHasFilesError(true);
      })
      .finally(() => {
        if (canceled) return;
        setIsLoadingFiles(false);
      });

    return () => {
      canceled = true;
    };
  }, [objectId, shop, selectedSnapshotId, visible]);

  const snapshotFileRows = useMemo(
    () =>
      (snapshotFiles?.files ?? []).map((file) => ({
        entryId: snapshotFileKey(file),
        file,
      })),
    [snapshotFiles?.files]
  );

  const allFilesSelected =
    snapshotFileRows.length > 0 &&
    selectedEntryIds.size === snapshotFileRows.length;

  const toggleEntry = (entryId: string) => {
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedEntryIds(
      allFilesSelected
        ? new Set()
        : new Set(snapshotFileRows.map((row) => row.entryId))
    );
  };

  const handleRestore = async () => {
    const snapshotId = selectedSnapshotId;
    const entryIds = [...selectedEntryIds];
    if (!snapshotId || entryIds.length === 0 || isRestoring) return;

    setIsRestoring(true);
    setProgress(null);
    try {
      const result = await window.electron.restoreCloudSaveSnapshot(
        objectId,
        shop,
        snapshotId,
        entryIds,
        (nextProgress) => setProgress(nextProgress)
      );
      showSuccessToast(
        t("cloud_save_v2_snapshot_restore_success_title"),
        t("cloud_save_v2_snapshot_restore_success_description", {
          count: result.restoredFiles,
        })
      );
      setSelectedEntryIds(new Set());
      await loadSnapshots();
      onRestored();
    } catch {
      showErrorToast(
        t("cloud_save_v2_snapshot_restore_error_title"),
        t("cloud_save_v2_snapshot_restore_error_description")
      );
    } finally {
      setIsRestoring(false);
      setProgress(null);
    }
  };

  const selectedSnapshot = snapshots.find(
    (snapshot) => snapshot.id === selectedSnapshotId
  );
  const actionsDisabled = isGameRunning || isRestoring;
  const progressLabel = progress
    ? t(`cloud_save_v2_progress_${progress.stage}`)
    : t("cloud_save_v2_snapshot_restoring");

  return (
    <Modal
      visible={visible}
      title={t("cloud_save_v2_snapshot_history_title")}
      description={t("cloud_save_v2_snapshot_history_description")}
      className="cloud-save-v2__file-browser-modal"
      onClose={() => {
        if (!isRestoring) onClose();
      }}
    >
      <div className="cloud-save-v2__snapshot-history">
        <div className="cloud-save-v2__snapshot-history-toolbar">
          <div className="cloud-save-v2__browser-source-summary">
            <span>
              <ClockCounterClockwiseIcon size={20} />
              <strong>{t("cloud_save_v2_snapshot_history_versions")}</strong>
            </span>
          </div>
          <Button
            theme="outline"
            disabled={isLoadingSnapshots || isRestoring}
            onClick={() => void loadSnapshots()}
          >
            {isLoadingSnapshots ? (
              <CircleNotchIcon className="cloud-save-v2__spinner" size={16} />
            ) : (
              <ArrowClockwiseIcon size={16} />
            )}
            <span>{t("cloud_save_v2_files_retry")}</span>
          </Button>
        </div>

        {isLoadingSnapshots && snapshots.length === 0 && (
          <div className="cloud-save-v2__browser-state">
            <CircleNotchIcon className="cloud-save-v2__spinner" size={20} />
            <span>{t("cloud_save_v2_snapshot_history_loading")}</span>
          </div>
        )}

        {hasSnapshotsError && (
          <div className="cloud-save-v2__browser-state cloud-save-v2__browser-state--error">
            <WarningCircleIcon size={20} />
            <span>{t("cloud_save_v2_snapshot_history_error")}</span>
            <Button theme="outline" onClick={() => void loadSnapshots()}>
              {t("cloud_save_v2_files_retry")}
            </Button>
          </div>
        )}

        {!isLoadingSnapshots &&
          !hasSnapshotsError &&
          snapshots.length === 0 && (
            <p className="cloud-save-v2__browser-empty">
              {t("cloud_save_v2_snapshot_history_empty")}
            </p>
          )}

        {snapshots.length > 0 && (
          <div className="cloud-save-v2__snapshot-version-list" role="listbox">
            {snapshots.map((snapshot) => (
              <button
                key={snapshot.id}
                type="button"
                role="option"
                aria-selected={snapshot.id === selectedSnapshotId}
                disabled={isRestoring}
                className={`cloud-save-v2__snapshot-version ${snapshot.id === selectedSnapshotId ? "cloud-save-v2__snapshot-version--active" : ""}`}
                onClick={() => setSelectedSnapshotId(snapshot.id)}
              >
                <CloudIcon size={18} />
                <span className="cloud-save-v2__snapshot-version-copy">
                  <strong>
                    {t("cloud_save_v2_snapshot_version_label", {
                      version: snapshot.version,
                    })}
                    {snapshot.isHead &&
                      ` · ${t("cloud_save_v2_snapshot_version_current")}`}
                  </strong>
                  <span>
                    {t("cloud_save_v2_source_summary", {
                      count: snapshot.fileCount,
                      size: formatBytes(snapshot.totalSizeBytes),
                    })}
                    {snapshot.updatedAt &&
                      ` · ${formatDateTime(snapshot.updatedAt)}`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {selectedSnapshotId && (
          <div className="cloud-save-v2__snapshot-files">
            <div className="cloud-save-v2__browser-toolbar">
              <div className="cloud-save-v2__browser-source-summary">
                <span>
                  {isLoadingFiles ? (
                    <CircleNotchIcon
                      className="cloud-save-v2__spinner"
                      size={20}
                    />
                  ) : (
                    <CloudIcon size={20} />
                  )}
                  <strong>
                    {t("cloud_save_v2_snapshot_files_title", {
                      version: selectedSnapshot?.version ?? "",
                    })}
                  </strong>
                </span>
              </div>
              {snapshotFileRows.length > 0 && (
                <div className="cloud-save-v2__browser-toolbar-actions">
                  <div className="cloud-save-v2__browser-filter">
                    <CheckboxField
                      label={t("cloud_save_v2_snapshot_select_all")}
                      checked={allFilesSelected}
                      disabled={actionsDisabled}
                      onChange={toggleAll}
                    />
                  </div>
                  <Button
                    theme="primary"
                    disabled={actionsDisabled || selectedEntryIds.size === 0}
                    onClick={() => void handleRestore()}
                  >
                    {isRestoring ? (
                      <CircleNotchIcon
                        className="cloud-save-v2__spinner"
                        size={16}
                      />
                    ) : (
                      <ClockCounterClockwiseIcon size={16} />
                    )}
                    <span>
                      {isRestoring
                        ? progressLabel
                        : t("cloud_save_v2_snapshot_restore_selected", {
                            count: selectedEntryIds.size,
                          })}
                    </span>
                  </Button>
                </div>
              )}
            </div>

            {hasFilesError && (
              <div className="cloud-save-v2__browser-inline-error">
                <WarningCircleIcon size={16} />
                <span>{t("cloud_save_v2_snapshot_files_error")}</span>
              </div>
            )}

            {!isLoadingFiles &&
              !hasFilesError &&
              snapshotFileRows.length === 0 && (
                <p className="cloud-save-v2__browser-empty">
                  {t("cloud_save_v2_snapshot_files_empty")}
                </p>
              )}

            {snapshotFileRows.length > 0 && (
              <ul className="cloud-save-v2__snapshot-file-list">
                {snapshotFileRows.map(({ entryId, file }) => (
                  <li
                    key={entryId}
                    className="cloud-save-v2__snapshot-file-row"
                  >
                    <CheckboxField
                      label={
                        file.relativePath.split("/").pop() ?? file.relativePath
                      }
                      checked={selectedEntryIds.has(entryId)}
                      disabled={actionsDisabled}
                      onChange={() => toggleEntry(entryId)}
                    />
                    <span
                      className="cloud-save-v2__snapshot-file-path"
                      title={file.rawPath}
                    >
                      {file.rawPath}
                    </span>
                    <span className="cloud-save-v2__browser-file-metadata">
                      <span>{formatBytes(file.sizeBytes)}</span>
                      {file.lastModifiedAt && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatDateTime(file.lastModifiedAt)}</span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
