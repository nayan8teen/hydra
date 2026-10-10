import assert from "node:assert/strict";
import test from "node:test";

import { planFitGirlPackage } from "./fitgirl-package.js";

test("detects a single setup executable next to its companion data", () => {
  const plan = planFitGirlPackage({
    files: ["setup.exe", "data.bin", "readme.txt"],
  });

  assert.equal(plan.setupPath, "setup.exe");
  assert.equal(plan.workingDirectory, ".");
  assert.equal(plan.setupIsAmbiguous, false);
  assert.deepEqual(plan.archiveGroups, []);
  assert.deepEqual(plan.incompleteArchiveGroups, []);
});

test("supports a setup executable nested in the package and Windows separators", () => {
  const plan = planFitGirlPackage({
    files: ["game\\SETUP.EXE", "game\\.\\fg-01.bin"],
  });

  assert.equal(plan.setupPath, "game/SETUP.EXE");
  assert.equal(plan.workingDirectory, "game");
});

test("rejects an ambiguous package with more than one setup executable", () => {
  const plan = planFitGirlPackage({
    files: ["setup.exe", "nested/Setup.exe"],
  });

  assert.equal(plan.setupIsAmbiguous, true);
  assert.equal(plan.setupPath, null);
  assert.equal(plan.workingDirectory, null);
});

test("groups a multipart RAR set once through its first volume", () => {
  const plan = planFitGirlPackage({
    files: ["game.part01.rar", "game.part02.rar", "game.part03.rar"],
  });

  assert.equal(plan.archiveGroups.length, 1);
  assert.equal(plan.archiveGroups[0].firstVolume, "game.part01.rar");
  assert.deepEqual(plan.archiveGroups[0].volumes, [
    "game.part01.rar",
    "game.part02.rar",
    "game.part03.rar",
  ]);
});

test("keeps separate multipart sets in different directories apart", () => {
  const plan = planFitGirlPackage({
    files: [
      "one/game.part01.rar",
      "one/game.part02.rar",
      "two/game.part01.rar",
      "two/game.part02.rar",
    ],
  });

  assert.equal(plan.archiveGroups.length, 2);
  assert.deepEqual(
    plan.archiveGroups.map((group) => group.firstVolume),
    ["one/game.part01.rar", "two/game.part01.rar"]
  );
});

test("reports a multipart set with a missing volume instead of extracting it", () => {
  const plan = planFitGirlPackage({
    files: ["game.part01.rar", "game.part03.rar"],
  });

  assert.deepEqual(plan.archiveGroups, []);
  assert.deepEqual(plan.incompleteArchiveGroups, [
    { basePath: "game.part01.rar", lowestPart: 1 },
  ]);
});

test("reports a multipart set that starts after part one", () => {
  const plan = planFitGirlPackage({
    files: ["game.part02.rar", "game.part03.rar"],
  });

  assert.deepEqual(plan.archiveGroups, []);
  assert.deepEqual(plan.incompleteArchiveGroups, [
    { basePath: "game.part02.rar", lowestPart: 2 },
  ]);
});

test("recognizes old-style volumes with a plain first volume", () => {
  const plan = planFitGirlPackage({
    files: ["game.rar", "game.r00", "game.r01"],
  });

  assert.equal(plan.archiveGroups.length, 1);
  assert.deepEqual(plan.archiveGroups[0].volumes, [
    "game.rar",
    "game.r00",
    "game.r01",
  ]);
});

test("reports an old-style set whose first numbered volume is missing", () => {
  const plan = planFitGirlPackage({ files: ["game.rar", "game.r01"] });

  assert.deepEqual(plan.archiveGroups, []);
  assert.deepEqual(plan.incompleteArchiveGroups, [
    { basePath: "game.rar", lowestPart: 1 },
  ]);
});

test("treats a lone archive as a single volume set", () => {
  const plan = planFitGirlPackage({
    files: ["game.rar", "art.zip", "extra.7z"],
  });

  assert.deepEqual(
    plan.archiveGroups.map((group) => group.volumes),
    [["art.zip"], ["extra.7z"], ["game.rar"]]
  );
});

test("ignores files that try to escape the package root", () => {
  const plan = planFitGirlPackage({
    files: [
      "../evil/setup.exe",
      "..\\evil\\game.part01.rar",
      "/absolute/setup.exe",
      "C:/windows/setup.exe",
    ],
  });

  assert.equal(plan.setupPath, null);
  assert.equal(plan.setupIsAmbiguous, false);
  assert.deepEqual(plan.archiveGroups, []);
});

test("keeps archive sets discoverable while a setup executable already exists", () => {
  const plan = planFitGirlPackage({
    files: ["setup.exe", "game.part01.rar", "game.part02.rar"],
  });

  assert.equal(plan.setupPath, "setup.exe");
  assert.equal(plan.archiveGroups.length, 1);
});
