import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { UserPreferences } from "@types";

import {
  getAutomaticInstallationPreferences,
  isAutomaticInstallationEnabledForProvider,
  resolveGameInstallDirectory,
  resolveInstallationBaseDirectory,
} from "./installation-preferences.js";

const baseDirectory = path.join(os.tmpdir(), "hydra-games");
const providerDirectory = path.join(os.tmpdir(), "fitgirl-games");

test("automatic installation stays disabled for existing profiles", () => {
  assert.equal(
    isAutomaticInstallationEnabledForProvider(null, "fitgirl"),
    false
  );
  assert.equal(isAutomaticInstallationEnabledForProvider({}, "fitgirl"), false);
  assert.equal(
    isAutomaticInstallationEnabledForProvider(
      { automaticInstallation: { baseDirectory } },
      "fitgirl"
    ),
    false
  );
  assert.deepEqual(getAutomaticInstallationPreferences(null), {});
});

test("the provider override takes precedence over the global base directory", () => {
  const preferences: UserPreferences = {
    automaticInstallation: {
      baseDirectory,
      providers: {
        fitgirl: { enabled: true, installDirectory: providerDirectory },
      },
    },
  };

  assert.equal(
    isAutomaticInstallationEnabledForProvider(preferences, "fitgirl"),
    true
  );
  assert.equal(
    resolveInstallationBaseDirectory(preferences, "fitgirl"),
    providerDirectory
  );
});

test("a blank provider override falls back to the base directory", () => {
  const preferences: UserPreferences = {
    automaticInstallation: {
      baseDirectory,
      providers: { fitgirl: { enabled: true, installDirectory: "   " } },
    },
  };

  assert.equal(
    resolveInstallationBaseDirectory(preferences, "fitgirl"),
    baseDirectory
  );
});

test("the destination is the sanitized title inside the effective base directory", () => {
  const preferences: UserPreferences = {
    automaticInstallation: {
      baseDirectory,
      providers: { fitgirl: { enabled: true } },
    },
  };

  assert.equal(
    resolveGameInstallDirectory(preferences, "fitgirl", "Game: Repack"),
    path.join(baseDirectory, "Game_ Repack")
  );
});

test("no destination is produced before the user configures a base directory", () => {
  assert.equal(resolveGameInstallDirectory(null, "fitgirl", "Game"), null);
  assert.equal(
    resolveGameInstallDirectory(
      { automaticInstallation: { baseDirectory: null } },
      "fitgirl",
      "Game"
    ),
    null
  );
});
