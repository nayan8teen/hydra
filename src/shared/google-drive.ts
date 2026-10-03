export const GOOGLE_DRIVE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

export const isValidGoogleDriveClientId = (value: unknown): value is string =>
  typeof value === "string" && CLIENT_ID_PATTERN.test(value.trim());
