import { getInstallJobs } from "@main/services/game-installation";
import { registerEvent } from "../register-event";

const getInstallJobsEvent = async (_event: Electron.IpcMainInvokeEvent) => {
  return getInstallJobs();
};

registerEvent("getInstallJobs", getInstallJobsEvent);
