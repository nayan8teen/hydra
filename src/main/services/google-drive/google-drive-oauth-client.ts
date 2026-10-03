import axios from "axios";

import type { GoogleDriveAccount } from "@types";

import {
  GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_USERINFO_URL,
} from "./google-drive-constants.js";
import { GoogleDriveError } from "./google-drive-errors.js";
import {
  describeGoogleDriveAccountFailure,
  describeGoogleDriveOAuthFailure,
} from "./google-drive-oauth-error.js";

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };
const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 3600;

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

export interface GoogleDriveOAuthEndpoints {
  tokenUrl: string;
  userinfoUrl: string;
}

export interface GoogleDriveAuthorizationTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scope: string;
}

export class GoogleDriveOAuthClient {
  private readonly tokenUrl: string;
  private readonly userinfoUrl: string;

  constructor(endpoints: Partial<GoogleDriveOAuthEndpoints> = {}) {
    this.tokenUrl = endpoints.tokenUrl ?? GOOGLE_OAUTH_TOKEN_URL;
    this.userinfoUrl = endpoints.userinfoUrl ?? GOOGLE_OAUTH_USERINFO_URL;
  }

  /** Exchanges the loopback authorization code for tokens using PKCE. */
  async exchangeAuthorizationCode(params: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleDriveAuthorizationTokens> {
    let data: GoogleDriveTokenResponse;

    try {
      const response = await axios.post<GoogleDriveTokenResponse>(
        this.tokenUrl,
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
      throw new GoogleDriveError(describeGoogleDriveOAuthFailure(error));
    }

    if (!data.access_token || !data.refresh_token) {
      throw new GoogleDriveError(
        "google_drive_oauth_failed: authorization did not return the expected tokens"
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresInSeconds:
        typeof data.expires_in === "number" && data.expires_in > 0
          ? data.expires_in
          : DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS,
      scope: data.scope ?? "",
    };
  }

  async fetchAccount(accessToken: string): Promise<GoogleDriveAccount> {
    let data: GoogleDriveUserInfoResponse;

    try {
      const response = await axios.get<GoogleDriveUserInfoResponse>(
        this.userinfoUrl,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
        }
      );
      data = response.data;
    } catch (error) {
      throw new GoogleDriveError(describeGoogleDriveAccountFailure(error));
    }

    const email = data.email?.trim();
    if (!email) {
      throw new GoogleDriveError(
        "google_drive_account_lookup_failed: userinfo returned no email address"
      );
    }

    return {
      email,
      displayName: data.name?.trim() || email,
      photoUrl: data.picture?.trim() || null,
      connectedAt: new Date().toISOString(),
    };
  }
}

export const googleDriveOAuthClient = new GoogleDriveOAuthClient();
