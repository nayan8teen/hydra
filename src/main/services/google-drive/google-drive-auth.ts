import axios from "axios";
import { safeStorage, shell } from "electron";

import { db, levelKeys } from "@main/level";
import { getGoogleDriveErrorDetail, getGoogleDriveErrorMarker } from "@shared";
import type {
  GoogleDriveAccount,
  GoogleDriveConnectError,
  GoogleDriveConnectionStatus,
} from "@types";

import { logger } from "../logger.js";
import {
  startGoogleDriveAuthorizationRedirect,
  type GoogleDriveAuthorizationRedirect,
} from "./google-drive-authorized-redirect.js";
import {
  GOOGLE_DRIVE_ACCESS_TOKEN_SKEW_MS,
  GOOGLE_DRIVE_CALLBACK_PATH,
  GOOGLE_DRIVE_LOOPBACK_HOST,
  GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
  GOOGLE_DRIVE_SCOPES,
  GOOGLE_OAUTH_AUTHORIZATION_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
} from "./google-drive-constants.js";
import {
  GoogleDriveConnectCancelledError,
  GoogleDriveConnectInProgressError,
  GoogleDriveError,
  GoogleDriveNotConfiguredError,
  GoogleDriveNotConnectedError,
  GoogleDriveReauthRequiredError,
} from "./google-drive-errors.js";
import { googleDriveOAuthClient } from "./google-drive-oauth-client.js";
import {
  createGoogleDriveOAuthError,
  getGoogleDriveOAuthErrorCode,
} from "./google-drive-oauth-error.js";
import {
  createGoogleDriveOAuthState,
  createGoogleDrivePkcePair,
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

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };
const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 3600;
const INVALID_CLIENT_MARKER = "google_drive_oauth_invalid_client";

export class GoogleDriveAuth {
  private static session: GoogleDriveAuthSession | null = null;
  private static loaded = false;
  private static refreshPromise: Promise<string> | null = null;
  private static activeAuthorization: GoogleDriveAuthorizationRedirect | null =
    null;
  private static connecting = false;
  private static connectError: GoogleDriveConnectError | null = null;

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
    const connectError =
      this.connectError?.clientId === (settings.clientId ?? null)
        ? this.connectError
        : await this.getStoredClientRejection(settings);

    return {
      state: !session
        ? "disconnected"
        : session.needsReauth
          ? "needs-reauth"
          : "connected",
      account: session?.account ?? null,
      settings,
      connectError,
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
    if (this.connecting || this.activeAuthorization) {
      throw new GoogleDriveConnectInProgressError();
    }

    this.connecting = true;
    const pkce = createGoogleDrivePkcePair();
    const state = createGoogleDriveOAuthState();

    try {
      const authorization = await startGoogleDriveAuthorizationRedirect({
        expectedState: state,
      });
      this.activeAuthorization = authorization;

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

      logger.info(
        `Google Drive authorization started for client ${resolvedClientId} on port ${authorization.port}`
      );
      await shell.openExternal(authorizationUrl.toString());

      const code = await authorization.code;
      logger.info("Google Drive authorization code received from the browser");

      const tokens = await googleDriveOAuthClient.exchangeAuthorizationCode({
        clientId: resolvedClientId,
        code,
        codeVerifier: pkce.verifier,
        redirectUri,
        clientSecret: settings.clientSecret,
      });
      const account = await googleDriveOAuthClient.fetchAccount(
        tokens.accessToken
      );
      const session: GoogleDriveAuthSession = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiryDate: Date.now() + tokens.expiresInSeconds * 1000,
        scope: tokens.scope,
        needsReauth: false,
        account,
      };

      try {
        await this.persistSession(session);
      } catch (error) {
        throw createGoogleDriveOAuthError(
          "google_drive_oauth_session_persist_failed",
          error instanceof Error ? error.message : String(error)
        );
      }

      this.session = session;
      this.loaded = true;
      this.connectError = null;
      await this.clearStoredClientRejection();
      logger.info(
        `Google Drive connected as ${account.email} (client ${resolvedClientId})`
      );

      return account;
    } catch (error) {
      await this.recordConnectFailure(resolvedClientId, error);
      throw error;
    } finally {
      this.activeAuthorization?.abort();
      this.activeAuthorization = null;
      this.connecting = false;
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
    await this.clearStoredClientRejection();
  }

  /** Drops local credentials without calling Google (e.g. client ID changed). */
  static async clearConnection(): Promise<void> {
    this.session = null;
    this.loaded = true;
    this.refreshPromise = null;
    this.connectError = null;
    await db.del(levelKeys.googleDriveAuth).catch(() => undefined);
  }

  static reset() {
    this.session = null;
    this.loaded = false;
    this.refreshPromise = null;
    this.activeAuthorization = null;
    this.connecting = false;
    this.connectError = null;
  }

  /**
   * Records why the last attempt failed and keeps the marker plus Google's own
   * description, so the settings card never has to guess at the cause.
   */
  private static async recordConnectFailure(
    clientId: string,
    error: unknown
  ): Promise<void> {
    if (error instanceof GoogleDriveConnectCancelledError) {
      logger.info("Google Drive authorization was cancelled by the user");
      return;
    }

    const marker = getGoogleDriveErrorMarker(error);
    const detail = getGoogleDriveErrorDetail(error);
    const at = new Date().toISOString();

    this.connectError = { marker, detail, clientId, at };

    logger.error(
      `Google Drive authorization failed (${marker ?? "unknown cause"}, client ${clientId}): ${detail}`
    );

    if (marker === INVALID_CLIENT_MARKER) {
      // Google itself rejected this client ID (e.g. a Web client without a
      // secret), so remember it and warn before the next browser round-trip.
      await db
        .put(levelKeys.googleDriveClientRejection, this.connectError, {
          valueEncoding: "json",
        })
        .catch((error) =>
          logger.warn(
            "Failed to persist the Google Drive client rejection",
            error
          )
        );
    }
  }

  private static async getStoredClientRejection(settings: {
    clientId: string | null;
  }): Promise<GoogleDriveConnectError | null> {
    if (!settings.clientId) return null;

    try {
      const stored = await db.get<string, GoogleDriveConnectError | null>(
        levelKeys.googleDriveClientRejection,
        { valueEncoding: "json" }
      );
      if (!stored) return null;
      if (stored.clientId !== settings.clientId) {
        await this.clearStoredClientRejection();
        return null;
      }
      return stored;
    } catch {
      return null;
    }
  }

  private static clearStoredClientRejection() {
    return db.del(levelKeys.googleDriveClientRejection).catch(() => undefined);
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
      return this.toReauthSession(stored);
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
      return this.toReauthSession(stored);
    }
  }

  private static toReauthSession(
    stored: StoredGoogleDriveAuthRecord
  ): GoogleDriveAuthSession {
    return {
      accessToken: "",
      refreshToken: "",
      expiryDate: 0,
      scope: stored.scope,
      needsReauth: true,
      account: stored.account,
    };
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
      const body = new URLSearchParams({
        client_id: settings.clientId,
        refresh_token: session.refreshToken,
        grant_type: "refresh_token",
      });
      if (settings.clientSecret) {
        body.set("client_secret", settings.clientSecret);
      }

      const response = await axios.post<GoogleDriveTokenResponse>(
        GOOGLE_OAUTH_TOKEN_URL,
        body.toString(),
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
      if (getGoogleDriveOAuthErrorCode(error) === "invalid_grant") {
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
}
