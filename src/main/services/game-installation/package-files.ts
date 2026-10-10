import fs from "node:fs/promises";
import path from "node:path";

import { InstallError } from "./install-adapter.js";

const DEFAULT_MAX_ENTRIES = 20_000;

/**
 * Lists regular files under `root` as paths relative to it (forward slashes),
 * skipping symlinks so an untrusted package cannot point outside its folder.
 * A package that is unexpectedly large is rejected rather than scanned forever.
 */
export const listPackageFiles = async (
  root: string,
  maxEntries = DEFAULT_MAX_ENTRIES
): Promise<string[]> => {
  const resolvedRoot = path.resolve(root);
  const files: string[] = [];
  let visited = 0;

  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      visited += 1;

      if (visited > maxEntries) {
        throw new InstallError(
          "unsupported-layout",
          `The download folder holds more than ${maxEntries} entries and cannot be prepared safely`
        );
      }

      if (entry.isSymbolicLink()) continue;

      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(
          path.relative(resolvedRoot, entryPath).replaceAll("\\", "/")
        );
      }
    }
  };

  await walk(resolvedRoot);

  return files;
};
