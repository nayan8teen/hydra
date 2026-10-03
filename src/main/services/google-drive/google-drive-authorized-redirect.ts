import { createServer } from "node:http";

import {
  GOOGLE_DRIVE_AUTHORIZATION_TIMEOUT_MS,
  GOOGLE_DRIVE_CALLBACK_PATH,
  GOOGLE_DRIVE_LOOPBACK_HOST,
} from "./google-drive-constants.js";
import { GoogleDriveConnectCancelledError } from "./google-drive-errors.js";
import { createGoogleDriveOAuthError } from "./google-drive-oauth-error.js";
import { isMatchingGoogleDriveOAuthState } from "./google-drive-pkce.js";

export interface GoogleDriveAuthorizationRedirect {
  port: number;
  code: Promise<string>;
  abort: () => void;
}

const buildAuthorizationResultPage = (message: string) => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Hydra Save Sync</title></head>
  <body style="background:#1c1c1c;color:#f5f5f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <p>${message}</p>
  </body>
</html>`;

/**
 * Starts the loopback redirect listener Google sends the browser back to.
 * The consent screen itself always opens in the user's system browser, never
 * in an embedded webview, so this listener is the only hand-off between the
 * browser and the app.
 */
export const startGoogleDriveAuthorizationRedirect = (params: {
  expectedState: string;
  timeoutMs?: number;
}): Promise<GoogleDriveAuthorizationRedirect> => {
  const timeoutMs = params.timeoutMs ?? GOOGLE_DRIVE_AUTHORIZATION_TIMEOUT_MS;

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
          createGoogleDriveOAuthError(
            "google_drive_oauth_access_denied",
            requestUrl.searchParams.get("error_description") ?? errorCode
          )
        );
        return;
      }

      if (
        !isMatchingGoogleDriveOAuthState(
          params.expectedState,
          requestUrl.searchParams.get("state")
        )
      ) {
        respond("Google Drive authorization could not be verified.");
        settle(
          createGoogleDriveOAuthError(
            "google_drive_oauth_state_mismatch",
            "the callback state did not match the authorization request"
          )
        );
        return;
      }

      const authorizationCode = requestUrl.searchParams.get("code");
      if (!authorizationCode) {
        respond("Google Drive authorization code was missing.");
        settle(
          createGoogleDriveOAuthError(
            "google_drive_oauth_code_missing",
            "Google returned no authorization code"
          )
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
        settled = true;
        closeServer();
        rejectSetup(
          createGoogleDriveOAuthError(
            "google_drive_oauth_listener_failed",
            "the local redirect listener failed to start"
          )
        );
        return;
      }

      timeout = setTimeout(() => {
        settle(
          createGoogleDriveOAuthError(
            "google_drive_oauth_timeout",
            `no browser response within ${Math.round(timeoutMs / 1000)}s`
          )
        );
      }, timeoutMs);

      resolveSetup({
        port: address.port,
        code,
        abort: () => settle(new GoogleDriveConnectCancelledError()),
      });
    });
  });
};
