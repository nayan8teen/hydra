import { isAxiosError } from "axios";

import { GoogleDriveError } from "./google-drive-errors.js";

export type GoogleDriveOAuthFailureCode =
  | "google_drive_oauth_invalid_client"
  | "google_drive_oauth_redirect_mismatch"
  | "google_drive_oauth_invalid_grant"
  | "google_drive_oauth_access_denied"
  | "google_drive_oauth_network_error"
  | "google_drive_oauth_server_error"
  | "google_drive_oauth_failed";

/** Failures that happen in our own flow, before/around Google's response. */
export type GoogleDriveOAuthFlowFailureCode =
  | "google_drive_oauth_state_mismatch"
  | "google_drive_oauth_code_missing"
  | "google_drive_oauth_timeout"
  | "google_drive_oauth_listener_failed"
  | "google_drive_oauth_session_persist_failed";

/**
 * Every Drive authorization error carries a stable `google_drive_*` marker so
 * the renderer can pick an actionable message from the same string the log
 * shows, instead of collapsing every cause into "connection failed".
 */
export const createGoogleDriveOAuthError = (
  code: GoogleDriveOAuthFailureCode | GoogleDriveOAuthFlowFailureCode,
  detail?: string | null
) => new GoogleDriveError(detail ? `${code}: ${detail}` : code);

/** Google's machine-readable `error` field from an OAuth/token error body. */
export const getGoogleDriveOAuthErrorCode = (error: unknown) => {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { error?: unknown }).error;
  return typeof code === "string" && code.length > 0 ? code : null;
};

export const getGoogleDriveOAuthErrorDescription = (error: unknown) => {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data;
  if (typeof data !== "object" || data === null) return null;
  const description = (data as { error_description?: unknown })
    .error_description;

  return typeof description === "string" && description.length > 0
    ? description
    : null;
};

const getHttpStatus = (error: unknown) =>
  isAxiosError(error) ? (error.response?.status ?? null) : null;

const getStatusCodeDetail = (error: unknown) => {
  const status = getHttpStatus(error);
  return status === null ? null : `HTTP ${status}`;
};

export const classifyGoogleDriveOAuthFailure = (
  error: unknown
): GoogleDriveOAuthFailureCode => {
  const code = getGoogleDriveOAuthErrorCode(error)?.toLowerCase() ?? "";
  const description = (
    getGoogleDriveOAuthErrorDescription(error) ?? ""
  ).toLowerCase();
  const status = getHttpStatus(error);

  if (code === "redirect_uri_mismatch") {
    return "google_drive_oauth_redirect_mismatch";
  }
  if (code === "access_denied") return "google_drive_oauth_access_denied";
  if (code === "invalid_grant") return "google_drive_oauth_invalid_grant";
  if (
    code === "invalid_client" ||
    code === "unauthorized_client" ||
    description.includes("client_secret") ||
    status === 401
  ) {
    return "google_drive_oauth_invalid_client";
  }
  if (isAxiosError(error) && !error.response) {
    return "google_drive_oauth_network_error";
  }
  if (status !== null && status >= 500) {
    return "google_drive_oauth_server_error";
  }

  return "google_drive_oauth_failed";
};

/** Marker-prefixed message so the renderer and the logs both stay readable. */
export const describeGoogleDriveOAuthFailure = (error: unknown) => {
  const detail =
    getGoogleDriveOAuthErrorDescription(error) ??
    getGoogleDriveOAuthErrorCode(error) ??
    getStatusCodeDetail(error);
  const code = classifyGoogleDriveOAuthFailure(error);

  return detail ? `${code}: ${detail}` : code;
};

export const describeGoogleDriveAccountFailure = (error: unknown) => {
  const detail =
    getGoogleDriveOAuthErrorDescription(error) ??
    getGoogleDriveOAuthErrorCode(error) ??
    getStatusCodeDetail(error);

  return detail
    ? `google_drive_account_lookup_failed: ${detail}`
    : "google_drive_account_lookup_failed";
};
