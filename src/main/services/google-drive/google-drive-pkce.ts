import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const base64UrlEncode = (value: Buffer) =>
  value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

export interface GoogleDrivePkcePair {
  verifier: string;
  challenge: string;
}

/** RFC 7636 S256 verifier/challenge pair. */
export const createGoogleDrivePkcePair = (): GoogleDrivePkcePair => {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(
    createHash("sha256").update(verifier).digest()
  );
  return { verifier, challenge };
};

export const createGoogleDriveOAuthState = () =>
  base64UrlEncode(randomBytes(32));

export const isMatchingGoogleDriveOAuthState = (
  expected: string,
  received: string | null
) => {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
};
