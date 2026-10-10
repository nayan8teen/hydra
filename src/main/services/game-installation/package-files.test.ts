import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { InstallError } from "./install-adapter.js";
import { listPackageFiles } from "./package-files.js";

const withTempDirectory = async (
  callback: (directory: string) => Promise<void>
) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-package-"));

  try {
    await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
};

test("lists nested files as forward-slash paths relative to the root", async () => {
  await withTempDirectory(async (directory) => {
    await fs.mkdir(path.join(directory, "game", "data"), { recursive: true });
    await fs.writeFile(path.join(directory, "setup.exe"), "one");
    await fs.writeFile(
      path.join(directory, "game", "data", "fg-01.bin"),
      "two"
    );

    const files = await listPackageFiles(directory);

    assert.deepEqual(files.sort(), ["game/data/fg-01.bin", "setup.exe"]);
  });
});

test("rejects a package that is larger than the listing limit", async () => {
  await withTempDirectory(async (directory) => {
    await fs.writeFile(path.join(directory, "one.txt"), "1");
    await fs.writeFile(path.join(directory, "two.txt"), "2");
    await fs.writeFile(path.join(directory, "three.txt"), "3");

    await assert.rejects(
      listPackageFiles(directory, 2),
      (error: unknown) =>
        error instanceof InstallError && error.code === "unsupported-layout"
    );
  });
});

test("fails when the package folder does not exist", async () => {
  await assert.rejects(
    listPackageFiles(path.join(os.tmpdir(), "hydra-missing-package"))
  );
});
