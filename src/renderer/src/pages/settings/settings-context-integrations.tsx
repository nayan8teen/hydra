import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsGoogleDrive } from "./settings-google-drive";
import { SettingsRetroAchievements } from "./settings-retroachievements";
import { SettingsSteam } from "./settings-steam";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <SettingsSteam />
        <SettingsRetroAchievements />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("cloud_saves_section_title")}</h3>
        <SettingsGoogleDrive />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>
    </div>
  );
}
