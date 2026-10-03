export const GOOGLE_DRIVE_PROVIDER = "google-drive" as const;

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
  "profile",
] as const;

export const GOOGLE_OAUTH_AUTHORIZATION_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_OAUTH_USERINFO_URL =
  "https://www.googleapis.com/oauth2/v3/userinfo";

export const GOOGLE_DRIVE_FILES_URL =
  "https://www.googleapis.com/drive/v3/files";
export const GOOGLE_DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files";

// Drive v3 removed `etag` from the File resource; `headRevisionId` changes on
// every content update and is used as the optimistic-concurrency token.
export const GOOGLE_DRIVE_FILE_FIELDS =
  "id,name,mimeType,size,headRevisionId,modifiedTime,webViewLink,appProperties";

export const GOOGLE_DRIVE_FOLDER_MIME_TYPE =
  "application/vnd.google-apps.folder";
export const GOOGLE_DRIVE_JSON_MIME_TYPE = "application/json";
export const GOOGLE_DRIVE_BLOB_MIME_TYPE = "application/octet-stream";

export const GOOGLE_DRIVE_DEFAULT_FOLDER_NAME = "Hydra Save Sync";
export const GOOGLE_DRIVE_GAMES_FOLDER_NAME = "games";
export const GOOGLE_DRIVE_BLOBS_FOLDER_NAME = "blobs";
export const GOOGLE_DRIVE_MANIFEST_FILE_NAME = "manifest.json";
export const GOOGLE_DRIVE_MANIFEST_HISTORY_PREFIX = "manifest-";
export const GOOGLE_DRIVE_MANIFEST_HISTORY_LIMIT = 5;

export const GOOGLE_DRIVE_ROOT_PARENT_ID = "root";
export const GOOGLE_DRIVE_ROLE_PROPERTY = "hydraRole";
export const GOOGLE_DRIVE_GAME_KEY_PROPERTY = "hydraGameKey";

export const GOOGLE_DRIVE_ACCESS_TOKEN_SKEW_MS = 60_000;
export const GOOGLE_DRIVE_REQUEST_TIMEOUT_MS = 30_000;
export const GOOGLE_DRIVE_AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

export const GOOGLE_DRIVE_CALLBACK_PATH = "/oauth2callback";
export const GOOGLE_DRIVE_LOOPBACK_HOST = "127.0.0.1";

export const GOOGLE_DRIVE_DEFAULT_SWEEP_INTERVAL_MINUTES = 30;
export const GOOGLE_DRIVE_MIN_SWEEP_INTERVAL_MINUTES = 15;
export const GOOGLE_DRIVE_MAX_SWEEP_INTERVAL_MINUTES = 24 * 60;
export const GOOGLE_DRIVE_MAX_FOLDER_NAME_LENGTH = 100;
