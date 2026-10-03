import { GOOGLE_DRIVE_FOLDER_MIME_TYPE } from "./google-drive-constants.js";

const MANIFEST_HISTORY_PATTERN = /^manifest-(\d+)\.json$/;

/** Drive query values are single-quoted; backslashes and quotes must escape. */
export const escapeGoogleDriveQueryValue = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export const buildGoogleDriveFileQuery = (params: {
  name: string;
  parentId: string;
  mimeType?: string;
}) => {
  const clauses = [
    `name = '${escapeGoogleDriveQueryValue(params.name)}'`,
    `'${escapeGoogleDriveQueryValue(params.parentId)}' in parents`,
    "trashed = false",
  ];
  if (params.mimeType) {
    clauses.push(
      `mimeType = '${escapeGoogleDriveQueryValue(params.mimeType)}'`
    );
  }
  return clauses.join(" and ");
};

export const buildGoogleDriveFolderQuery = (params: {
  name: string;
  parentId: string;
}) =>
  buildGoogleDriveFileQuery({
    ...params,
    mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  });

export const buildGoogleDriveAppPropertyClause = (params: {
  key: string;
  value: string;
}) =>
  `appProperties has { key='${escapeGoogleDriveQueryValue(params.key)}' and value='${escapeGoogleDriveQueryValue(params.value)}' }`;

export const buildGoogleDriveChildrenQuery = (parentId: string) =>
  `'${escapeGoogleDriveQueryValue(parentId)}' in parents and trashed = false`;

export const buildGoogleDriveNamePrefixQuery = (params: {
  namePrefix: string;
  parentId: string;
}) =>
  `name contains '${escapeGoogleDriveQueryValue(params.namePrefix)}' and '${escapeGoogleDriveQueryValue(params.parentId)}' in parents and trashed = false`;

/**
 * Builds a `multipart/related` body for a small JSON file (one metadata part
 * and one media part).
 */
export const buildGoogleDriveMultipartBody = (params: {
  metadata: Record<string, unknown>;
  content: string;
  boundary: string;
}) => {
  const partHeader = "Content-Type: application/json; charset=UTF-8";
  return Buffer.concat([
    Buffer.from(
      `--${params.boundary}\r\n${partHeader}\r\n\r\n${JSON.stringify(params.metadata)}\r\n`,
      "utf8"
    ),
    Buffer.from(
      `--${params.boundary}\r\n${partHeader}\r\n\r\n${params.content}\r\n`,
      "utf8"
    ),
    Buffer.from(`--${params.boundary}--\r\n`, "utf8"),
  ]);
};

/** `manifest-<version>.json` history file names; returns null otherwise. */
export const parseGoogleDriveManifestHistoryVersion = (fileName: string) => {
  const match = MANIFEST_HISTORY_PATTERN.exec(fileName);
  if (!match) return null;
  const version = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(version) && version >= 1 ? version : null;
};
