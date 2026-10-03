import { isAxiosError } from "axios";

export class GoogleDriveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleDriveError";
  }
}

/** The user has not configured an OAuth client ID, or it is malformed. */
export class GoogleDriveNotConfiguredError extends GoogleDriveError {
  readonly code = "google_drive_not_configured";

  constructor(message = "Google Drive OAuth client ID is not configured") {
    super(message);
    this.name = "GoogleDriveNotConfiguredError";
  }
}

export class GoogleDriveNotConnectedError extends GoogleDriveError {
  readonly code = "google_drive_not_connected";

  constructor(message = "Google Drive is not connected") {
    super(message);
    this.name = "GoogleDriveNotConnectedError";
  }
}

/** The refresh token is no longer valid and the user must reconnect. */
export class GoogleDriveReauthRequiredError extends GoogleDriveError {
  readonly code = "google_drive_reauth_required";

  constructor(message = "Google Drive connection expired; reconnect required") {
    super(message);
    this.name = "GoogleDriveReauthRequiredError";
  }
}

export class GoogleDriveConnectInProgressError extends GoogleDriveError {
  readonly code = "google_drive_connect_in_progress";

  constructor(message = "Google Drive authorization is already in progress") {
    super(message);
    this.name = "GoogleDriveConnectInProgressError";
  }
}

export class GoogleDriveConnectCancelledError extends GoogleDriveError {
  readonly code = "google_drive_connect_cancelled";

  constructor(message = "Google Drive authorization was cancelled") {
    super(message);
    this.name = "GoogleDriveConnectCancelledError";
  }
}

/**
 * The remote manifest changed between analysis and commit. The engine treats
 * this like its existing HTTP 409 conflict: re-run the sync once.
 */
export class GoogleDriveManifestConflictError extends GoogleDriveError {
  readonly code = "google_drive_manifest_conflict";
  readonly status = 409;

  constructor(
    message = "Google Drive manifest changed while the snapshot was being committed"
  ) {
    super(message);
    this.name = "GoogleDriveManifestConflictError";
  }
}

export class GoogleDriveManifestInvalidError extends GoogleDriveError {
  readonly code = "google_drive_manifest_invalid";

  constructor(message = "Invalid Google Drive manifest") {
    super(message);
    this.name = "GoogleDriveManifestInvalidError";
  }
}

export class GoogleDriveRequestError extends GoogleDriveError {
  readonly code = "google_drive_request_failed";

  constructor(message = "Google Drive request failed") {
    super(message);
    this.name = "GoogleDriveRequestError";
  }
}

export class GoogleDriveBlobNotFoundError extends GoogleDriveError {
  readonly code = "google_drive_blob_not_found";

  constructor(message = "Google Drive save blob was not found") {
    super(message);
    this.name = "GoogleDriveBlobNotFoundError";
  }
}

export const isGoogleDriveManifestConflictError = (
  error: unknown
): error is GoogleDriveManifestConflictError =>
  error instanceof GoogleDriveManifestConflictError;

export const isGoogleDriveReauthRequiredError = (
  error: unknown
): error is GoogleDriveReauthRequiredError =>
  error instanceof GoogleDriveReauthRequiredError;

/** Drive answers stale `If-Match` writes with HTTP 412. */
export const isGoogleDrivePreconditionFailedError = (error: unknown) =>
  isAxiosError(error) && error.response?.status === 412;
