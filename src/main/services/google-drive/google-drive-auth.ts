import { createServer } from "node:http";
import axios, { isAxiosError } from "axios";
import { safeStorage, shell } from "electron";

import { db, levelKeys } from "@main/level";
import type { GoogleDriveAccount, GoogleDriveConnectionStatus } from "@types";

import { logger } from "../logger.js";
import {
  GOOGLE_DRIVE_ACCESS_TOKEN_SKEW_MS,
  GOOGLE_DRIVE_AUTHORIZATION_TIMEOUT_MS,
  GOOGLE_DRIVE_CALLBACK_PATH,
  GOOGLE_DRIVE_LOOPBACK_HOST,
  GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
  GOOGLE_DRIVE_SCOPES,
  GOOGLE_OAUTH_AUTHORIZATION_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_USERINFO_URL,
} from "./google-drive-constants.js";
import {
  GoogleDriveConnectCancelledError,
  GoogleDriveConnectInProgressError,
  GoogleDriveError,
  GoogleDriveNotConfiguredError,
  GoogleDriveNotConnectedError,
  GoogleDriveReauthRequiredError,
} from "./google-drive-errors.js";
import {
  createGoogleDriveOAuthState,
  createGoogleDrivePkcePair,
  isMatchingGoogleDriveOAuthState,
} from "./google-drive-pkce.js";
import {
  getGoogleDriveSettings,
  isValidGoogleDriveClientId,
} from "./google-drive-settings.js";

interface StoredGoogleDriveAuthRecord {
  version: 1;
  encrypted: boolean;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
  needsReauth: boolean;
  account: GoogleDriveAccount;
}

interface GoogleDriveAuthSession {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
  needsReauth: boolean;
  account: GoogleDriveAccount;
}

interface GoogleDriveTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface GoogleDriveUserInfoResponse {
  email?: string;
  name?: string;
  picture?: string;
}

interface GoogleDriveAuthorizationRedirect {
  port: number;
  code: Promise<string>;
  abort: () => void;
}

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };
const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 3600;

const getTokenErrorCode = (error: unknown) => {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
};

const getTokenErrorDescription = (error: unknown) => {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data;
  if (typeof data !== "object" || data === null) return null;
  const description = (data as { error_description?: unknown })
    .error_description;
  return typeof description === "string" && description.length > 0
    ? description
    : null;
};

const buildAuthorizationResultPage = (message: string) => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Hydra Save Sync</title></head>
  <body style="background:#1c1c1c;color:#f5f5f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <p>${message}</p>
  </body>
</html>`;

export class GoogleDriveAuth {
  private static session: GoogleDriveAuthSession | null = null;
  private static loaded = false;
  private static refreshPromise: Promise<string> | null = null;
  private static activeAuthorization: { abort: () => void } | null = null;

  /** Re-validates a stored session on startup without prompting the user. */
  static async setup() {
    const session = await this.load();
    if (!session || session.needsReauth) return;
    try {
      await this.getAccessToken();
    } catch (error) {
      if (error instanceof GoogleDriveReauthRequiredError) {
        logger.warn("Google Drive connection needs to be renewed");
        return;
      }
      logger.warn("Google Drive session refresh was skipped", error);
    }
  }

  static async getStatus(): Promise<GoogleDriveConnectionStatus> {
    const [session, settings] = await Promise.all([
      this.load(),
      getGoogleDriveSettings(),
    ]);

    return {
      state: !session
        ? "disconnected"
        : session.needsReauth
          ? "needs-reauth"
          : "connected",
      account: session?.account ?? null,
      settings,
    };
  }

  static async isConnected(): Promise<boolean> {
    const session = await this.load();
    return Boolean(session && !session.needsReauth && session.refreshToken);
  }

  static async getAccessToken(options?: {
    forceRefresh?: boolean;
  }): Promise<string> {
    const session = await this.load();
    if (!session) throw new GoogleDriveNotConnectedError();
    if (session.needsReauth) throw new GoogleDriveReauthRequiredError();

    const expiresSoon =
      session.expiryDate - Date.now() <= GOOGLE_DRIVE_ACCESS_TOKEN_SKEW_MS;
    if (!options?.forceRefresh && !expiresSoon && session.accessToken) {
      return session.accessToken;
    }

    return this.refreshSession(session);
  }

  static async connect(clientId?: string): Promise<GoogleDriveAccount> {
    const settings = await getGoogleDriveSettings();
    const resolvedClientId = (clientId ?? settings.clientId ?? "").trim();
    if (!isValidGoogleDriveClientId(resolvedClientId)) {
      throw new GoogleDriveNotConfiguredError();
    }
    if (this.activeAuthorization) {
      throw new GoogleDriveConnectInProgressError();
    }

    const pkce = createGoogleDrivePkcePair();
    const state = createGoogleDriveOAuthState();
    const authorization = await this.openAuthorizationRedirect(state);
    this.activeAuthorization = { abort: authorization.abort };

    try {
      const redirectUri = `http://${GOOGLE_DRIVE_LOOPBACK_HOST}:${authorization.port}${GOOGLE_DRIVE_CALLBACK_PATH}`;
      const authorizationUrl = new URL(GOOGLE_OAUTH_AUTHORIZATION_URL);
      authorizationUrl.searchParams.set("client_id", resolvedClientId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", GOOGLE_DRIVE_SCOPES.join(" "));
      authorizationUrl.searchParams.set("code_challenge", pkce.challenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("access_type", "offline");
      authorizationUrl.searchParams.set("prompt", "consent");
      authorizationUrl.searchParams.set("include_granted_scopes", "true");
      authorizationUrl.searchParams.set("state", state);

      await shell.openExternal(authorizationUrl.toString());

      const code = await authorization.code;
      const tokens = await this.exchangeAuthorizationCode({
        clientId: resolvedClientId,
        code,
        codeVerifier: pkce.verifier,
        redirectUri,
      });
      const account = await this.fetchAccount(tokens.accessToken);
      const session: GoogleDriveAuthSession = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiryDate: Date.now() + tokens.expiresInSeconds * 1000,
        scope: tokens.scope,
        needsReauth: false,
        account,
      };

      await this.persistSession(session);
      this.session = session;
      this.loaded = true;
      return account;
    } finally {
      authorization.abort();
      this.activeAuthorization = null;
    }
  }

  static cancelConnect() {
    this.activeAuthorization?.abort();
  }

  static async disconnect(): Promise<void> {
    this.cancelConnect();
    const session = await this.load();
    const token = session?.refreshToken || session?.accessToken;
    if (token) {
      await axios
        .post(
          GOOGLE_OAUTH_REVOKE_URL,
          new URLSearchParams({ token }).toString(),
          { headers: FORM_HEADERS, timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS }
        )
        .catch((error) =>
          logger.warn("Failed to revoke Google Drive access", error)
        );
    }
    await this.clearConnection();
  }

  /** Drops local credentials without calling Google (e.g. client ID changed). */
  static async clearConnection(): Promise<void> {
    this.session = null;
    this.loaded = true;
    this.refreshPromise = null;
    await db.del(levelKeys.googleDriveAuth).catch(() => undefined);
  }

  static reset() {
    this.session = null;
    this.loaded = false;
    this.refreshPromise = null;
  }

  private static async load(): Promise<GoogleDriveAuthSession | null> {
    if (this.loaded) return this.session;
    this.loaded = true;

    try {
      const stored = await db.get<string, StoredGoogleDriveAuthRecord | null>(
        levelKeys.googleDriveAuth,
        { valueEncoding: "json" }
      );
      this.session = stored ? this.decodeStoredRecord(stored) : null;
    } catch {
      this.session = null;
    }

    return this.session;
  }

  private static decodeStoredRecord(
    stored: StoredGoogleDriveAuthRecord
  ): GoogleDriveAuthSession {
    if (!stored.encrypted) {
      return {
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        expiryDate: stored.expiryDate,
        scope: stored.scope,
        needsReauth: stored.needsReauth,
        account: stored.account,
      };
    }

    if (!this.isEncryptionAvailable()) {
      logger.warn(
        "Google Drive credentials cannot be decrypted without OS encryption support; reconnect required"
      );
      return {
        accessToken: "",
        refreshToken: "",
        expiryDate: 0,
        scope: stored.scope,
        needsReauth: true,
        account: stored.account,
      };
    }

    try {
      return {
        accessToken: this.decryptSecret(stored.accessToken),
        refreshToken: this.decryptSecret(stored.refreshToken),
        expiryDate: stored.expiryDate,
        scope: stored.scope,
        needsReauth: stored.needsReauth,
        account: stored.account,
      };
    } catch (error) {
      logger.warn("Failed to decrypt Google Drive credentials", error);
      return {
        accessToken: "",
        refreshToken: "",
        expiryDate: 0,
        scope: stored.scope,
        needsReauth: true,
        account: stored.account,
      };
    }
  }

  private static async persistSession(session: GoogleDriveAuthSession) {
    const useEncryption = this.isEncryptionAvailable();
    const record: StoredGoogleDriveAuthRecord = {
      version: 1,
      encrypted: useEncryption,
      accessToken: useEncryption
        ? this.encryptSecret(session.accessToken)
        : session.accessToken,
      refreshToken: useEncryption
        ? this.encryptSecret(session.refreshToken)
        : session.refreshToken,
      expiryDate: session.expiryDate,
      scope: session.scope,
      needsReauth: session.needsReauth,
      account: session.account,
    };

    await db.put(levelKeys.googleDriveAuth, record, { valueEncoding: "json" });
  }

  private static isEncryptionAvailable() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private static encryptSecret(value: string) {
    return safeStorage.encryptString(value).toString("base64");
  }

  private static decryptSecret(value: string) {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  }

  private static refreshSession(
    session: GoogleDriveAuthSession
  ): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.performRefresh(session).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private static async performRefresh(
    session: GoogleDriveAuthSession
  ): Promise<string> {
    const settings = await getGoogleDriveSettings();
    if (!isValidGoogleDriveClientId(settings.clientId)) {
      throw new GoogleDriveNotConfiguredError();
    }
    if (!session.refreshToken) {
      await this.markReauthRequired(session);
      throw new GoogleDriveReauthRequiredError();
    }

    try {
      const response = await axios.post<GoogleDriveTokenResponse>(
        GOOGLE_OAUTH_TOKEN_URL,
        new URLSearchParams({
          client_id: settings.clientId,
          refresh_token: session.refreshToken,
          grant_type: "refresh_token",
        }).toString(),
        { headers: FORM_HEADERS, timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS }
      );
      const accessToken = response.data.access_token;
      if (!accessToken) {
        throw new GoogleDriveError(
          "Google Drive token refresh returned no access token"
        );
      }
      const expiresInSeconds =
        typeof response.data.expires_in === "number" &&
        response.data.expires_in > 0
          ? response.data.expires_in
          : DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS;
      const next: GoogleDriveAuthSession = {
        ...session,
        accessToken,
        expiryDate: Date.now() + expiresInSeconds * 1000,
        scope: response.data.scope ?? session.scope,
        needsReauth: false,
      };

      await this.persistSession(next);
      this.session = next;
      this.loaded = true;
      return accessToken;
    } catch (error) {
      if (getTokenErrorCode(error) === "invalid_grant") {
        await this.markReauthRequired(session);
        throw new GoogleDriveReauthRequiredError();
      }
      throw error;
    }
  }

  private static async markReauthRequired(session: GoogleDriveAuthSession) {
    const next: GoogleDriveAuthSession = {
      ...session,
      accessToken: "",
      needsReauth: true,
    };
    await this.persistSession(next).catch((error) =>
      logger.warn("Failed to persist Google Drive reauth state", error)
    );
    this.session = next;
    this.loaded = true;
  }

  private static async exchangeAuthorizationCode(params: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) {
    let data: GoogleDriveTokenResponse;
    try {
      const response = await axios.post<GoogleDriveTokenResponse>(
        GOOGLE_OAUTH_TOKEN_URL,
        new URLSearchParams({
          code: params.code,
          client_id: params.clientId,
          code_verifier: params.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: params.redirectUri,
        }).toString(),
        { headers: FORM_HEADERS, timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS }
      );
      data = response.data;
    } catch (error) {
      throw this.describeOAuthFailure(error);
    }

    if (!data.access_token || !data.refresh_token) {
      throw new GoogleDriveError(
        "Google Drive authorization did not return the expected tokens"
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresInSeconds:
        typeof data.expires_in === "number" && data.expires_in > 0
          ? data.expires_in
          : DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS,
      scope: data.scope ?? GOOGLE_DRIVE_SCOPES.join(" "),
    };
  }

  private static describeOAuthFailure(error: unknown): GoogleDriveError {
    const code = getTokenErrorCode(error);
    const description = getTokenErrorDescription(error);
    const detail = description ?? code;
    return new GoogleDriveError(
      detail
        ? `Google Drive authorization failed: ${detail}`
        : "Google Drive authorization failed"
    );
  }

  private static async fetchAccount(
    accessToken: string
  ): Promise<GoogleDriveAccount> {
    const response = await axios.get<GoogleDriveUserInfoResponse>(
      GOOGLE_OAUTH_USERINFO_URL,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
      }
    );
    const email = response.data.email?.trim();
    if (!email) {
      throw new GoogleDriveError(
        "Google Drive account email could not be read"
      );
    }

    return {
      email,
      displayName: response.data.name?.trim() || email,
      photoUrl: response.data.picture?.trim() || null,
      connectedAt: new Date().toISOString(),
    };
  }

  /**
   * Starts the loopback redirect listener Google sends the browser back to.
   * The consent screen itself always opens in the user's system browser.
   */
  private static openAuthorizationRedirect(
    expectedState: string
  ): Promise<GoogleDriveAuthorizationRedirect> {
    return new Promise((resolveSetup, rejectSetup) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let server: ReturnType<typeof createServer> | null = null;
      let resolveCode: (code: string) => void = () => undefined;
      let rejectCode: (error: Error) => void = () => undefined;

      const code = new Promise<string>((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
      });
      void code.catch(() => undefined);

      const closeServer = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        server?.close();
      };

      const settle = (error: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        closeServer();
        if (error) rejectCode(error);
        else resolveCode(value ?? "");
      };

      server = createServer((request, response) => {
        const requestUrl = new URL(
          request.url ?? "/",
          `http://${GOOGLE_DRIVE_LOOPBACK_HOST}`
        );
        if (requestUrl.pathname !== GOOGLE_DRIVE_CALLBACK_PATH) {
          response.writeHead(404);
          response.end();
          return;
        }

        const respond = (message: string) => {
          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
          });
          response.end(buildAuthorizationResultPage(message));
        };

        const errorCode = requestUrl.searchParams.get("error");
        if (errorCode) {
          respond("Google Drive authorization was denied. Close this tab.");
          settle(
            new GoogleDriveError(
              `Google Drive authorization was denied: ${errorCode}`
            )
          );
          return;
        }

        if (
          !isMatchingGoogleDriveOAuthState(
            expectedState,
            requestUrl.searchParams.get("state")
          )
        ) {
          respond("Google Drive authorization could not be verified.");
          settle(
            new GoogleDriveError("Google Drive authorization state mismatch")
          );
          return;
        }

        const authorizationCode = requestUrl.searchParams.get("code");
        if (!authorizationCode) {
          respond("Google Drive authorization code was missing.");
          settle(
            new GoogleDriveError("Google Drive authorization code was missing")
          );
          return;
        }

        respond("Google Drive connected. You can close this tab.");
        settle(null, authorizationCode);
      });

      server.once("error", (error) => {
        if (settled) return;
        settled = true;
        closeServer();
        rejectSetup(error);
      });

      server.listen(0, GOOGLE_DRIVE_LOOPBACK_HOST, () => {
        const address = server?.address();
        if (!address || typeof address === "string") {
          const error = new GoogleDriveError(
            "Google Drive authorization listener failed to start"
          );
          settled = true;
          closeServer();
          rejectSetup(error);
          return;
        }

        timeout = setTimeout(
          () =>
            settle(
              new GoogleDriveError("Google Drive authorization timed out")
            ),
          GOOGLE_DRIVE_AUTHORIZATION_TIMEOUT_MS
        );
        resolveSetup({
          port: address.port,
          code,
          abort: () => settle(new GoogleDriveConnectCancelledError()),
        });
      });
    });
  }
}
