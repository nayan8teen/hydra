import { downloadSourcesSublevel } from "@main/level";
import { isKnownInstallerProvider } from "@main/services/game-installation";
import { registerEvent } from "../register-event";

/**
 * Installer automation is only ever attached to a source explicitly, by the
 * user. Unknown or stale provider values clear the mapping instead of guessing.
 */
const setDownloadSourceInstallerProvider = async (
  _event: Electron.IpcMainInvokeEvent,
  sourceId: string,
  installerProvider: unknown
) => {
  const source = await downloadSourcesSublevel.get(sourceId);

  if (!source) throw new Error("Download source not found");

  const nextProvider = isKnownInstallerProvider(installerProvider)
    ? installerProvider
    : null;

  const updated = { ...source, installerProvider: nextProvider };
  await downloadSourcesSublevel.put(sourceId, updated);

  return updated;
};

registerEvent(
  "setDownloadSourceInstallerProvider",
  setDownloadSourceInstallerProvider
);
