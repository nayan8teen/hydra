import type {
  AutomaticInstallationPreferences,
  AutomaticInstallationProviderPreferences,
  DownloadInstallerProvider,
  UserPreferences,
} from "@types";

import { resolveInstallDirectory } from "./install-paths.js";

export const getAutomaticInstallationPreferences = (
  preferences: UserPreferences | null | undefined
): AutomaticInstallationPreferences => preferences?.automaticInstallation ?? {};

export const getProviderInstallationPreferences = (
  preferences: UserPreferences | null | undefined,
  providerId: DownloadInstallerProvider
): AutomaticInstallationProviderPreferences | undefined =>
  getAutomaticInstallationPreferences(preferences).providers?.[providerId];

/**
 * The global toggle is the master switch: a per-download request only runs when
 * the user already enabled automatic installation for that provider.
 */
export const isAutomaticInstallationEnabledForProvider = (
  preferences: UserPreferences | null | undefined,
  providerId: DownloadInstallerProvider
): boolean =>
  getProviderInstallationPreferences(preferences, providerId)?.enabled === true;

/** Provider override first, then the global base directory. */
export const resolveInstallationBaseDirectory = (
  preferences: UserPreferences | null | undefined,
  providerId: DownloadInstallerProvider
): string | null => {
  const providerDirectory = getProviderInstallationPreferences(
    preferences,
    providerId
  )?.installDirectory?.trim();

  if (providerDirectory) return providerDirectory;

  const baseDirectory =
    getAutomaticInstallationPreferences(preferences).baseDirectory?.trim();

  return baseDirectory || null;
};

/**
 * Final destination for a game, or null when the user has not configured one
 * yet (in which case the job fails with an actionable reason instead of
 * writing to an arbitrary location).
 */
export const resolveGameInstallDirectory = (
  preferences: UserPreferences | null | undefined,
  providerId: DownloadInstallerProvider,
  title: string
): string | null => {
  const baseDirectory = resolveInstallationBaseDirectory(
    preferences,
    providerId
  );

  if (!baseDirectory) return null;

  return resolveInstallDirectory(baseDirectory, title);
};
