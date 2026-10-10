import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isPathInside,
  resolveInstallDirectory,
  sanitizeInstallDirectoryName,
} from "./install-paths.js";

const baseDirectory = path.join(os.tmpdir(), "hydra-install-base");

test("sanitizeInstallDirectoryName strips path separators and reserved characters", () => {
  assert.equal(
    sanitizeInstallDirectoryName("../../Evil/Game: Deluxe?"),
    ".._.._Evil_Game_ Deluxe_"
  );
  assert.equal(
    sanitizeInstallDirectoryName("Trailing dots... "),
    "Trailing dots"
  );
  assert.equal(sanitizeInstallDirectoryName(".."), "Hydra game");
  assert.equal(sanitizeInstallDirectoryName("   "), "Hydra game");
  assert.equal(sanitizeInstallDirectoryName("con"), "_con");
});

test("resolveInstallDirectory keeps the destination inside its base directory", () => {
  assert.equal(
    resolveInstallDirectory(baseDirectory, "Some Game"),
    path.join(baseDirectory, "Some Game")
  );

  const traversal = resolveInstallDirectory(baseDirectory, "..\\..\\windows");
  assert.equal(isPathInside(baseDirectory, traversal), true);
  assert.equal(path.dirname(traversal), baseDirectory);
});

test("isPathInside rejects sibling paths sharing a prefix", () => {
  const root = path.join(os.tmpdir(), "games");

  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, path.join(root, "title")), true);
  assert.equal(
    isPathInside(root, path.join(os.tmpdir(), "games-evil", "title")),
    false
  );
  assert.equal(isPathInside(root, path.join(os.tmpdir(), "games2")), false);
});
