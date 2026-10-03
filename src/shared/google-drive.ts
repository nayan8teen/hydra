export const GOOGLE_DRIVE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

export const isValidGoogleDriveClientId = (value: unknown): value is string =>
  typeof value === "string" && CLIENT_ID_PATTERN.test(value.trim());

/**
 * Every Drive authorization failure is reported as an error message prefixed
 * with one of these stable markers. The main process embeds the provider's own
 * description after the marker, and the renderer maps the marker back to
 * actionable copy, so the real cause never collapses into a generic failure.
 */
export const GOOGLE_DRIVE_ERROR_MARKER_PATTERN = /google_drive_[a-z0-9_]+/;

export const GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY =
  "google_drive_connect_error";
export const GOOGLE_DRIVE_CONNECT_CANCELLED_KEY =
  "google_drive_connect_cancelled";

export const GOOGLE_DRIVE_CONNECT_ERROR_TRANSLATION_KEYS = {
  // Google answered and rejected the request.
  google_drive_oauth_invalid_client:
    "google_drive_connect_error_invalid_client",
  google_drive_oauth_redirect_mismatch:
    "google_drive_connect_error_redirect_mismatch",
  google_drive_oauth_invalid_grant: "google_drive_connect_error_invalid_grant",
  google_drive_oauth_access_denied: "google_drive_connect_error_access_denied",
  google_drive_oauth_network_error: "google_drive_connect_error_network",
  google_drive_oauth_server_error: "google_drive_connect_error_server",
  google_drive_oauth_failed: GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY,
  // The hand-off between the browser and the app broke down.
  google_drive_oauth_state_mismatch:
    "google_drive_connect_error_state_mismatch",
  google_drive_oauth_code_missing: "google_drive_connect_error_code_missing",
  google_drive_oauth_timeout: "google_drive_connect_error_timeout",
  google_drive_oauth_listener_failed: "google_drive_connect_error_listener",
  google_drive_oauth_session_persist_failed:
    "google_drive_connect_error_session",
  google_drive_account_lookup_failed: "google_drive_connect_error_account",
} as const;

const TRANSLATION_KEYS_BY_MARKER: Readonly<Record<string, string>> =
  GOOGLE_DRIVE_CONNECT_ERROR_TRANSLATION_KEYS;

export const getGoogleDriveErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error ?? "");

export const getGoogleDriveErrorMarkerFromText = (text: string) =>
  GOOGLE_DRIVE_ERROR_MARKER_PATTERN.exec(text)?.[0] ?? null;

export const getGoogleDriveErrorMarker = (error: unknown) =>
  getGoogleDriveErrorMarkerFromText(getGoogleDriveErrorMessage(error));

/** The provider's own words, without the marker or the Electron IPC wrapper. */
export const getGoogleDriveErrorDetail = (error: unknown) => {
  const message = getGoogleDriveErrorMessage(error);
  const marker = getGoogleDriveErrorMarkerFromText(message);
  if (!marker) return message.trim().slice(0, 300);

  const start = message.indexOf(marker) + marker.length;
  return message
    .slice(start)
    .replace(/^[\s:]+/, "")
    .trim()
    .slice(0, 300);
};

export const getGoogleDriveConnectErrorTranslationKey = (
  marker: string | null
) =>
  marker
    ? (TRANSLATION_KEYS_BY_MARKER[marker] ??
      GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY)
    : GOOGLE_DRIVE_GENERIC_CONNECT_ERROR_KEY;

export interface GoogleDriveConnectFailure {
  /** Translation key naming the cause. */
  messageKey: string;
  /** The provider's own description, shown under the message. */
  detail: string;
  isCancelled: boolean;
}

interface RecordedConnectError {
  marker: string | null;
  detail: string;
}

/**
 * Turns a rejected `connectGoogleDrive` call into an actionable cause. The main
 * process marks every failure (`google_drive_oauth_invalid_client`, ...), so a
 * marker becomes a specific message instead of a generic "connection failed".
 */
export const getGoogleDriveConnectFailure = (
  error: unknown
): GoogleDriveConnectFailure => {
  const message = getGoogleDriveErrorMessage(error);
  const marker = getGoogleDriveErrorMarkerFromText(message);
  const isCancelled = marker === null && /cancel/i.test(message);

  return {
    messageKey: isCancelled
      ? GOOGLE_DRIVE_CONNECT_CANCELLED_KEY
      : getGoogleDriveConnectErrorTranslationKey(marker),
    detail: isCancelled ? "" : getGoogleDriveErrorDetail(error),
    isCancelled,
  };
};

/** The failure recorded by the main process, kept across restarts. */
export const getGoogleDriveConnectFailureFromStatus = (
  connectError: RecordedConnectError | null | undefined
): GoogleDriveConnectFailure | null =>
  connectError
    ? {
        messageKey: getGoogleDriveConnectErrorTranslationKey(
          connectError.marker
        ),
        detail: connectError.detail,
        isCancelled: false,
      }
    : null;
