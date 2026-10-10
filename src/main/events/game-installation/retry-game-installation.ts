import { retryGameInstallation } from "@main/services/game-installation";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const retryGameInstallationEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const job = await retryGameInstallation(shop, objectId);
  return job ?? null;
};

registerEvent("retryGameInstallation", retryGameInstallationEvent);
