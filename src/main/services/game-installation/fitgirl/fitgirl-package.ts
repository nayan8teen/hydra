import path from "node:path";

export const FITGIRL_SETUP_EXECUTABLE_NAME = "setup.exe";

const ARCHIVE_EXTENSIONS = [".rar", ".zip", ".7z"];
const MULTIPART_RAR_PATTERN = /^(?<base>.+)\.part0*(?<part>\d+)\.rar$/i;
const OLD_STYLE_VOLUME_PATTERN = /^(?<base>.+)\.r(?<part>\d{2,})$/i;

export interface FitGirlArchiveGroup {
  /** Volume Hydra extracts once; the remaining volumes are expanded from it. */
  firstVolume: string;
  /** Every volume of the set, in ascending order. */
  volumes: string[];
}

export interface FitGirlIncompleteArchiveGroup {
  /** Relative path of a volume belonging to the incomplete set. */
  basePath: string;
  /** Lowest part number present; greater than 1 when the set is incomplete. */
  lowestPart: number;
}

export interface FitGirlPackagePlan {
  /** Relative path of the single setup executable, if there is exactly one. */
  setupPath: string | null;
  /** Relative directory holding the setup executable and its companion data. */
  workingDirectory: string | null;
  /** True when the manifest holds more than one setup executable. */
  setupIsAmbiguous: boolean;
  archiveGroups: FitGirlArchiveGroup[];
  incompleteArchiveGroups: FitGirlIncompleteArchiveGroup[];
}

const normalizeRelativePath = (value: string) =>
  value.replaceAll("\\", "/").replace(/^\.\//, "");

/**
 * Rejects absolute paths and traversal segments, so a hostile archive listing
 * can never point outside the package root.
 */
const isSafeRelativePath = (value: string) => {
  if (!value || value.startsWith("/") || /^[a-zA-Z]:/.test(value)) {
    return false;
  }

  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
};

const isArchive = (entry: string) => {
  const lowered = entry.toLowerCase();

  // Old-style RAR volumes (`game.r00`) carry data but not a `.rar` extension.
  return (
    ARCHIVE_EXTENSIONS.some((extension) => lowered.endsWith(extension)) ||
    OLD_STYLE_VOLUME_PATTERN.test(entry)
  );
};

/**
 * Plans how to prepare a FitGirl download from a manifest of files relative to
 * the package root. It only describes the layout; extraction and validation
 * happen in the provider, which can fail with an actionable error.
 *
 * A FitGirl repack ships one `setup.exe` plus either the game data, `.bin`
 * companions, or a multipart RAR set that expands to them. Extracting every
 * part independently corrupts such a set, so each set is grouped and only its
 * first volume is meant to be extracted.
 */
export const planFitGirlPackage = ({
  files,
}: {
  files: string[];
}): FitGirlPackagePlan => {
  const entries = Array.from(
    new Set(files.map(normalizeRelativePath).filter(isSafeRelativePath))
  );

  const setupCandidates = entries.filter(
    (entry) =>
      path.posix.basename(entry).toLowerCase() === FITGIRL_SETUP_EXECUTABLE_NAME
  );
  const setupIsAmbiguous = setupCandidates.length > 1;
  const setupPath = setupCandidates.length === 1 ? setupCandidates[0] : null;

  const archiveEntries = entries.filter(isArchive);

  const oldStyleVolumes = new Map<string, Map<number, string>>();
  const mainVolumes = new Map<string, string>();
  const multipartParts = new Map<string, Map<number, string>>();

  for (const entry of archiveEntries) {
    const oldStyleMatch = entry.match(OLD_STYLE_VOLUME_PATTERN);

    if (oldStyleMatch?.groups) {
      const key = oldStyleMatch.groups.base.toLowerCase();
      const parts = oldStyleVolumes.get(key) ?? new Map<number, string>();
      parts.set(Number(oldStyleMatch.groups.part), entry);
      oldStyleVolumes.set(key, parts);
      continue;
    }

    const multipartMatch = entry.match(MULTIPART_RAR_PATTERN);

    if (multipartMatch?.groups) {
      const key = multipartMatch.groups.base.toLowerCase();
      const parts = multipartParts.get(key) ?? new Map<number, string>();
      parts.set(Number(multipartMatch.groups.part), entry);
      multipartParts.set(key, parts);
      continue;
    }

    if (entry.toLowerCase().endsWith(".rar")) {
      mainVolumes.set(entry.slice(0, -".rar".length).toLowerCase(), entry);
    }
  }

  const archiveGroups: FitGirlArchiveGroup[] = [];
  const incompleteArchiveGroups: FitGirlIncompleteArchiveGroup[] = [];
  const consumedEntries = new Set<string>();

  const consume = (entriesToConsume: string[]) => {
    for (const entry of entriesToConsume) {
      consumedEntries.add(entry.toLowerCase());
    }
  };

  const pushGroup = (volumes: string[]) => {
    archiveGroups.push({ firstVolume: volumes[0], volumes });
    consume(volumes);
  };

  // Old-style sets: `game.rar` plus `game.r00`, `game.r01`, …
  for (const [key, parts] of oldStyleVolumes) {
    const partNumbers = [...parts.keys()].sort((left, right) => left - right);
    const volumes = partNumbers.map((part) => parts.get(part)!);
    const firstVolume = mainVolumes.get(key);

    consume(volumes);

    if (!firstVolume) {
      incompleteArchiveGroups.push({
        basePath: volumes[0],
        lowestPart: partNumbers[0],
      });
      continue;
    }

    consume([firstVolume]);

    const isComplete = partNumbers.every((part, index) => part === index);

    if (!isComplete) {
      incompleteArchiveGroups.push({
        basePath: firstVolume,
        lowestPart: partNumbers[0],
      });
      continue;
    }

    pushGroup([firstVolume, ...volumes]);
  }

  // Modern sets: `game.part01.rar`, `game.part02.rar`, …
  for (const [, parts] of multipartParts) {
    const partNumbers = [...parts.keys()].sort((left, right) => left - right);
    const volumes = partNumbers.map((part) => parts.get(part)!);

    consume(volumes);

    const isComplete =
      parts.has(1) && partNumbers.every((part, index) => part === index + 1);

    if (!isComplete) {
      incompleteArchiveGroups.push({
        basePath: volumes[0],
        lowestPart: partNumbers[0],
      });
      continue;
    }

    pushGroup(volumes);
  }

  // Everything left (a lone `.rar`, or a `.zip`/`.7z`) is a single-volume set.
  for (const entry of archiveEntries) {
    if (consumedEntries.has(entry.toLowerCase())) continue;
    pushGroup([entry]);
  }

  archiveGroups.sort((left, right) =>
    left.firstVolume.localeCompare(right.firstVolume)
  );
  incompleteArchiveGroups.sort((left, right) =>
    left.basePath.localeCompare(right.basePath)
  );

  return {
    setupPath,
    workingDirectory: setupPath ? path.posix.dirname(setupPath) || "." : null,
    setupIsAmbiguous,
    archiveGroups,
    incompleteArchiveGroups,
  };
};
