import { cancelGameInstallation } from "@main/services/game-installation";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const cancelGameInstallationEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const job = await cancelGameInstallation(shop, objectId);
  return job ?? null;
};

registerEvent("cancelGameInstallation", cancelGameInstallationEvent);
