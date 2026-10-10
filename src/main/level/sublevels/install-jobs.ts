import type { InstallJob } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const installJobsSublevel = db.sublevel<string, InstallJob>(
  levelKeys.installJobs,
  {
    valueEncoding: "json",
  }
);
