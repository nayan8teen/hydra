import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type {
  AutomaticInstallationPreferences,
  AutomaticInstallationProviderPreferences,
  NetworkInterface,
  UserPreferences,
} from "@types";
import { SettingsGlobalTrackers } from "./settings-global-trackers";

import "./settings-general.scss";

const formatLimitInputValue = (
  value: number,
  useMegabytes: boolean
): string => {
  const unitValue = useMegabytes ? value / (1024 * 1024) : (value * 8) / 1e6;
  return Number.isInteger(unitValue)
    ? `${unitValue}`
    : `${Number(unitValue.toFixed(2))}`;
};

const buildForm = (preferences: UserPreferences | null) => ({
  seedAfterDownloadComplete: preferences?.seedAfterDownloadComplete ?? false,
  showDownloadSpeedInMegabytes:
    preferences?.showDownloadSpeedInMegabytes ?? false,
  extractFilesByDefault: preferences?.extractFilesByDefault ?? true,
  createStartMenuShortcut: preferences?.createStartMenuShortcut ?? true,
  maxDownloadSpeedMegabytes:
    typeof preferences?.maxDownloadSpeedBytesPerSecond === "number" &&
    preferences.maxDownloadSpeedBytesPerSecond > 0
      ? formatLimitInputValue(
          preferences.maxDownloadSpeedBytesPerSecond,
          preferences.showDownloadSpeedInMegabytes ?? false
        )
      : "",
  deleteArchiveFilesAfterExtractionByDefault:
    preferences?.deleteArchiveFilesAfterExtractionByDefault ?? false,
  torrentNetworkInterface: preferences?.torrentNetworkInterface ?? "",
  gameInstallationsPath:
    preferences?.automaticInstallation?.baseDirectory ?? "",
  fitgirlAutomaticInstallation:
    preferences?.automaticInstallation?.providers?.fitgirl?.enabled ?? false,
  fitgirlInstallDirectoryOverride:
    preferences?.automaticInstallation?.providers?.fitgirl?.installDirectory ??
    "",
  fitgirlUnattendedInstallation:
    preferences?.automaticInstallation?.providers?.fitgirl?.options
      ?.unattended === true,
});

export function SettingsContextDownloads() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const parseLimitInputToBytesPerSecond = (
    value: string,
    useMegabytes: boolean
  ): number | null | undefined => {
    const trimmed = value.trim();

    if (!trimmed) return null;

    const parsed = Number.parseFloat(trimmed);
    if (Number.isNaN(parsed)) return undefined;
    if (parsed <= 0) return null;

    return useMegabytes
      ? Math.floor(parsed * 1024 * 1024)
      : Math.floor((parsed * 1e6) / 8);
  };

  const [form, setForm] = useState(() => buildForm(userPreferences));

  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterface[]
  >([]);

  useEffect(() => {
    globalThis.electron
      .getNetworkInterfaces()
      .then(setNetworkInterfaces)
      .catch(() => setNetworkInterfaces([]));
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const networkInterfaceOptions = useMemo(() => {
    const options = [
      { key: "default", value: "", label: t("network_interface_default") },
      ...networkInterfaces.map((networkInterface) => {
        const ipv4 = networkInterface.addresses.find(
          (address) => !address.includes(":")
        );

        return {
          key: networkInterface.name,
          value: networkInterface.name,
          label: ipv4
            ? `${networkInterface.name} (${ipv4})`
            : networkInterface.name,
        };
      }),
    ];

    const selected = form.torrentNetworkInterface;
    if (selected && !options.some((option) => option.value === selected)) {
      options.push({
        key: selected,
        value: selected,
        label: `${selected} (${t("network_interface_unavailable")})`,
      });
    }

    return options;
  }, [networkInterfaces, form.torrentNetworkInterface, t]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  /**
   * `updateUserPreferences` merges top-level keys, so the whole
   * `automaticInstallation` object has to be sent on every edit.
   */
  const updateAutomaticInstallation = (
    overrides: {
      baseDirectory?: string | null;
      fitgirl?: AutomaticInstallationProviderPreferences;
    } = {}
  ) => {
    const current: AutomaticInstallationPreferences =
      userPreferences?.automaticInstallation ?? {};
    const automaticInstallation: AutomaticInstallationPreferences = {
      ...current,
      baseDirectory:
        overrides.baseDirectory !== undefined
          ? overrides.baseDirectory || null
          : (current.baseDirectory ?? null),
      providers: {
        ...current.providers,
        fitgirl: { ...current.providers?.fitgirl, ...overrides.fitgirl },
      },
    };

    setForm((prev) => ({
      ...prev,
      gameInstallationsPath: automaticInstallation.baseDirectory ?? "",
      fitgirlAutomaticInstallation:
        automaticInstallation.providers?.fitgirl?.enabled ?? false,
      fitgirlInstallDirectoryOverride:
        automaticInstallation.providers?.fitgirl?.installDirectory ?? "",
      fitgirlUnattendedInstallation:
        automaticInstallation.providers?.fitgirl?.options?.unattended === true,
    }));

    updateUserPreferences({ automaticInstallation });
  };

  const pickGameInstallationsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: form.gameInstallationsPath || undefined,
      properties: ["openDirectory", "createDirectory"],
    });

    const selectedPath = filePaths?.[0];

    if (selectedPath)
      updateAutomaticInstallation({ baseDirectory: selectedPath });
  };

  const pickFitgirlInstallationsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: form.fitgirlInstallDirectoryOverride || undefined,
      properties: ["openDirectory", "createDirectory"],
    });

    const selectedPath = filePaths?.[0];

    if (selectedPath)
      updateAutomaticInstallation({
        fitgirl: { installDirectory: selectedPath },
      });
  };

  const handleMaxDownloadSpeedBlur = () => {
    const parsedBytesPerSecond = parseLimitInputToBytesPerSecond(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );

    if (parsedBytesPerSecond === undefined) {
      setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: "" }));
      updateUserPreferences({ maxDownloadSpeedBytesPerSecond: null });
      return;
    }

    if (parsedBytesPerSecond === null) {
      setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: "" }));
      updateUserPreferences({ maxDownloadSpeedBytesPerSecond: null });
      return;
    }

    const nextLimitValue = formatLimitInputValue(
      parsedBytesPerSecond,
      form.showDownloadSpeedInMegabytes
    );
    setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: nextLimitValue }));
    updateUserPreferences({
      maxDownloadSpeedBytesPerSecond: parsedBytesPerSecond,
    });
  };

  const handleSpeedUnitChange = () => {
    const nextUseMegabytes = !form.showDownloadSpeedInMegabytes;
    const parsedBytesPerSecond = parseLimitInputToBytesPerSecond(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );

    const nextLimitInput =
      typeof parsedBytesPerSecond === "number" && parsedBytesPerSecond > 0
        ? formatLimitInputValue(parsedBytesPerSecond, nextUseMegabytes)
        : "";

    setForm((prev) => ({
      ...prev,
      showDownloadSpeedInMegabytes: nextUseMegabytes,
      maxDownloadSpeedMegabytes: nextLimitInput,
    }));

    updateUserPreferences({
      showDownloadSpeedInMegabytes: nextUseMegabytes,
    });
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("download_behavior")}</h3>

        <TextField
          type="number"
          min="0"
          step="0.1"
          label={t("max_download_speed", {
            unit: form.showDownloadSpeedInMegabytes ? "MB/s" : "Mbps",
          })}
          hint={t("max_download_speed_hint", {
            unit: form.showDownloadSpeedInMegabytes
              ? t("max_download_speed_unit_megabytes")
              : t("max_download_speed_unit_megabits"),
          })}
          value={form.maxDownloadSpeedMegabytes}
          onChange={(event) => {
            setForm((prev) => ({
              ...prev,
              maxDownloadSpeedMegabytes: event.target.value,
            }));
          }}
          onBlur={handleMaxDownloadSpeedBlur}
          placeholder={t("max_download_speed_unlimited")}
        />

        <div className="settings-general__network-interface">
          <SelectField
            label={t("network_interface")}
            value={form.torrentNetworkInterface}
            onChange={(event) =>
              handleChange({ torrentNetworkInterface: event.target.value })
            }
            options={networkInterfaceOptions}
          />
          <small className="settings-general__network-interface-hint">
            {t("network_interface_hint")}
          </small>
        </div>

        <CheckboxField
          label={t("seed_after_download_complete")}
          checked={form.seedAfterDownloadComplete}
          onChange={() =>
            handleChange({
              seedAfterDownloadComplete: !form.seedAfterDownloadComplete,
            })
          }
        />

        <CheckboxField
          label={t("extract_files_by_default")}
          checked={form.extractFilesByDefault}
          onChange={() =>
            handleChange({
              extractFilesByDefault: !form.extractFilesByDefault,
            })
          }
        />

        <CheckboxField
          label={t("show_download_speed_in_megabytes")}
          checked={form.showDownloadSpeedInMegabytes}
          onChange={handleSpeedUnitChange}
        />

        <CheckboxField
          label={t("delete_archive_files_after_extraction")}
          checked={form.deleteArchiveFilesAfterExtractionByDefault}
          onChange={() =>
            handleChange({
              deleteArchiveFilesAfterExtractionByDefault:
                !form.deleteArchiveFilesAfterExtractionByDefault,
            })
          }
        />

        <small>{t("automatic_installation_description")}</small>

        <TextField
          label={t("game_installations_path")}
          value={form.gameInstallationsPath}
          readOnly
          disabled
          rightContent={
            <Button theme="outline" onClick={pickGameInstallationsPath}>
              {t("change")}
            </Button>
          }
        />

        <CheckboxField
          label={t("fitgirl_automatic_installation")}
          checked={form.fitgirlAutomaticInstallation}
          onChange={() =>
            updateAutomaticInstallation({
              fitgirl: { enabled: !form.fitgirlAutomaticInstallation },
            })
          }
        />

        <TextField
          label={t("fitgirl_install_directory_override")}
          value={form.fitgirlInstallDirectoryOverride}
          readOnly
          disabled
          rightContent={
            <Button theme="outline" onClick={pickFitgirlInstallationsPath}>
              {t("change")}
            </Button>
          }
        />
        <small>{t("fitgirl_install_directory_override_hint")}</small>

        <CheckboxField
          label={t("fitgirl_unattended_installation")}
          checked={form.fitgirlUnattendedInstallation}
          onChange={() =>
            updateAutomaticInstallation({
              fitgirl: {
                options: {
                  ...userPreferences?.automaticInstallation?.providers?.fitgirl
                    ?.options,
                  unattended: !form.fitgirlUnattendedInstallation,
                },
              },
            })
          }
        />
        <small>{t("fitgirl_unattended_installation_hint")}</small>

        {(window.electron.platform === "win32" ||
          window.electron.platform === "linux") && (
          <CheckboxField
            label={t("create_shortcuts_on_download")}
            checked={form.createStartMenuShortcut}
            onChange={() =>
              handleChange({
                createStartMenuShortcut: !form.createStartMenuShortcut,
              })
            }
          />
        )}
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("global_trackers")}</h3>
        <SettingsGlobalTrackers />
      </div>
    </div>
  );
}
