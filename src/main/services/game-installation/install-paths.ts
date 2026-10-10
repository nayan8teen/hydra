import path from "node:path";

/** Characters Windows rejects in a directory name. */
const RESERVED_DIRECTORY_CHARACTERS = '<>:"/\\|?*';
const TRAILING_DOTS_AND_SPACES = /[. ]+$/g;
const WINDOWS_RESERVED_DEVICE_NAMES =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const FALLBACK_DIRECTORY_NAME = "Hydra game";

/** Control characters are rejected alongside the reserved punctuation. */
const isReservedDirectoryCharacter = (character: string) =>
  (character.codePointAt(0) ?? 0) < 32 ||
  RESERVED_DIRECTORY_CHARACTERS.includes(character);

/**
 * Turns a game title into a single, safe directory name. Titles come from
 * external catalogues, so they are treated as untrusted input.
 */
export const sanitizeInstallDirectoryName = (title: string): string => {
  const sanitized = [...(title ?? "")]
    .map((character) =>
      isReservedDirectoryCharacter(character) ? "_" : character
    )
    .join("")
    .replaceAll(TRAILING_DOTS_AND_SPACES, "")
    .trim();

  if (!sanitized || sanitized === "." || sanitized === "..") {
    return FALLBACK_DIRECTORY_NAME;
  }

  if (WINDOWS_RESERVED_DEVICE_NAMES.test(sanitized)) {
    return `_${sanitized}`;
  }

  return sanitized;
};

/** True when `target` is `root` itself or lives inside it. */
export const isPathInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

/**
 * Resolves `<baseDirectory>/<sanitized title>` and proves the result stays
 * inside the base directory.
 */
export const resolveInstallDirectory = (
  baseDirectory: string,
  title: string
): string => {
  const resolvedBase = path.resolve(baseDirectory);
  const target = path.resolve(
    resolvedBase,
    sanitizeInstallDirectoryName(title)
  );

  if (target === resolvedBase || !isPathInside(resolvedBase, target)) {
    throw new Error("Resolved installation directory escapes its base path");
  }

  return target;
};
