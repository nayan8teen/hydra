import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import axios, { isAxiosError } from "axios";

import type { GoogleDriveFileMetadata } from "@types";

import {
  GOOGLE_DRIVE_BLOB_MIME_TYPE,
  GOOGLE_DRIVE_FILE_FIELDS,
  GOOGLE_DRIVE_FILES_URL,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_DRIVE_JSON_MIME_TYPE,
  GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
  GOOGLE_DRIVE_UPLOAD_URL,
} from "./google-drive-constants.js";
import { GoogleDriveRequestError } from "./google-drive-errors.js";
import { buildGoogleDriveMultipartBody } from "./google-drive-protocol.js";

export type GoogleDriveAccessTokenProvider = (options?: {
  forceRefresh?: boolean;
}) => Promise<string>;

/** Extracts the human-readable reason from a Drive error response body. */
const describeGoogleDriveErrorBody = (data: unknown): string | null => {
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (data && typeof data === "object") {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim().length > 0) {
      return error.trim();
    }
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim().length > 0) {
        return message.trim();
      }
    }
  }
  return null;
};

export interface GoogleDriveFileList {
  files: GoogleDriveFileMetadata[];
  nextPageToken?: string;
}

export interface GoogleDriveCreateFolderParams {
  name: string;
  parentId: string;
  appProperties: Record<string, string>;
}

export interface GoogleDriveCreateJsonFileParams
  extends GoogleDriveCreateFolderParams {
  content: string;
}

export interface GoogleDriveUpdateJsonFileParams {
  fileId: string;
  content: string;
  ifMatch: string;
}

export interface GoogleDriveUploadBlobParams {
  name: string;
  parentId: string;
  absolutePath: string;
  sizeBytes: number;
  appProperties: Record<string, string>;
}

export interface GoogleDriveClientEndpoints {
  filesUrl: string;
  uploadUrl: string;
}

export class GoogleDriveClient {
  private readonly filesUrl: string;
  private readonly uploadUrl: string;

  constructor(
    private readonly getAccessToken: GoogleDriveAccessTokenProvider,
    endpoints: Partial<GoogleDriveClientEndpoints> = {}
  ) {
    this.filesUrl = endpoints.filesUrl ?? GOOGLE_DRIVE_FILES_URL;
    this.uploadUrl = endpoints.uploadUrl ?? GOOGLE_DRIVE_UPLOAD_URL;
  }

  private async withAccessToken<T>(
    run: (accessToken: string) => Promise<T>
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    try {
      return await run(accessToken);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        const refreshedAccessToken = await this.getAccessToken({
          forceRefresh: true,
        });
        return run(refreshedAccessToken);
      }

      // Keep the axios error (callers match on its status) but surface the
      // Drive API's reason, e.g. "Invalid field selection: etag".
      if (isAxiosError(error) && error.response) {
        const detail = describeGoogleDriveErrorBody(error.response.data);
        if (detail) error.message = `${error.message}: ${detail}`;
      }
      throw error;
    }
  }

  async listFiles(params: {
    query: string;
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }): Promise<GoogleDriveFileList> {
    return this.withAccessToken(async (accessToken) => {
      const response = await axios.get<{
        files?: GoogleDriveFileMetadata[];
        nextPageToken?: string;
      }>(this.filesUrl, {
        params: {
          q: params.query,
          spaces: "drive",
          fields: `nextPageToken,files(${GOOGLE_DRIVE_FILE_FIELDS})`,
          pageSize: params.pageSize ?? 100,
          ...(params.pageToken ? { pageToken: params.pageToken } : {}),
          ...(params.orderBy ? { orderBy: params.orderBy } : {}),
        },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
      });

      return {
        files: response.data.files ?? [],
        nextPageToken: response.data.nextPageToken,
      };
    });
  }

  async listAllFiles(params: {
    query: string;
    orderBy?: string;
  }): Promise<GoogleDriveFileMetadata[]> {
    const files: GoogleDriveFileMetadata[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.listFiles({ ...params, pageToken });
      files.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);

    return files;
  }

  async findFile(params: {
    query: string;
    orderBy?: string;
  }): Promise<GoogleDriveFileMetadata | null> {
    const { files } = await this.listFiles({ ...params, pageSize: 1 });
    return files[0] ?? null;
  }

  async createFolder(
    params: GoogleDriveCreateFolderParams
  ): Promise<GoogleDriveFileMetadata> {
    return this.withAccessToken(async (accessToken) => {
      const response = await axios.post<GoogleDriveFileMetadata>(
        this.filesUrl,
        {
          name: params.name,
          mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
          parents: [params.parentId],
          appProperties: params.appProperties,
        },
        {
          params: { fields: GOOGLE_DRIVE_FILE_FIELDS },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
        }
      );
      return response.data;
    });
  }

  async createJsonFile(
    params: GoogleDriveCreateJsonFileParams
  ): Promise<GoogleDriveFileMetadata> {
    const boundary = `hydra-${randomUUID()}`;
    const body = buildGoogleDriveMultipartBody({
      metadata: {
        name: params.name,
        mimeType: GOOGLE_DRIVE_JSON_MIME_TYPE,
        parents: [params.parentId],
        appProperties: params.appProperties,
      },
      content: params.content,
      boundary,
    });

    return this.withAccessToken(async (accessToken) => {
      const response = await axios.post<GoogleDriveFileMetadata>(
        this.uploadUrl,
        body,
        {
          params: {
            uploadType: "multipart",
            fields: GOOGLE_DRIVE_FILE_FIELDS,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
            "Content-Length": String(body.byteLength),
          },
          timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
        }
      );
      return response.data;
    });
  }

  async updateJsonFile(
    params: GoogleDriveUpdateJsonFileParams
  ): Promise<GoogleDriveFileMetadata> {
    return this.withAccessToken(async (accessToken) => {
      const response = await axios.patch<GoogleDriveFileMetadata>(
        `${this.uploadUrl}/${encodeURIComponent(params.fileId)}`,
        params.content,
        {
          params: {
            uploadType: "media",
            fields: GOOGLE_DRIVE_FILE_FIELDS,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": GOOGLE_DRIVE_JSON_MIME_TYPE,
            "If-Match": params.ifMatch,
          },
          timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
        }
      );
      return response.data;
    });
  }

  /**
   * Uploads a content-addressed blob through a resumable session so large
   * save files stream from disk instead of being buffered.
   */
  async uploadBlobFile(
    params: GoogleDriveUploadBlobParams
  ): Promise<GoogleDriveFileMetadata> {
    return this.withAccessToken(async (accessToken) => {
      const started = await axios.post<unknown>(
        this.uploadUrl,
        {
          name: params.name,
          mimeType: GOOGLE_DRIVE_BLOB_MIME_TYPE,
          parents: [params.parentId],
          appProperties: params.appProperties,
        },
        {
          params: {
            uploadType: "resumable",
            fields: GOOGLE_DRIVE_FILE_FIELDS,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": GOOGLE_DRIVE_JSON_MIME_TYPE,
            "X-Upload-Content-Type": GOOGLE_DRIVE_BLOB_MIME_TYPE,
            "X-Upload-Content-Length": String(params.sizeBytes),
          },
          timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
        }
      );

      const uploadUrl = started.headers.location;
      if (typeof uploadUrl !== "string" || uploadUrl.length === 0) {
        throw new GoogleDriveRequestError(
          "Google Drive did not return an upload session"
        );
      }

      const uploaded = await axios.put<GoogleDriveFileMetadata>(
        uploadUrl,
        createReadStream(params.absolutePath),
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": GOOGLE_DRIVE_BLOB_MIME_TYPE,
            "Content-Length": String(params.sizeBytes),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 0,
        }
      );

      const uploadedSize = uploaded.data.size
        ? Number(uploaded.data.size)
        : null;
      if (uploadedSize !== null && uploadedSize !== params.sizeBytes) {
        throw new GoogleDriveRequestError(
          "Google Drive blob upload size mismatch"
        );
      }

      return uploaded.data;
    });
  }

  /** Reads one file's metadata, or null when it no longer exists. */
  async getFileMetadata(
    fileId: string
  ): Promise<GoogleDriveFileMetadata | null> {
    return this.withAccessToken(async (accessToken) => {
      try {
        const response = await axios.get<GoogleDriveFileMetadata>(
          `${this.filesUrl}/${encodeURIComponent(fileId)}`,
          {
            params: { fields: GOOGLE_DRIVE_FILE_FIELDS },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
          }
        );
        return response.data;
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) return null;
        throw error;
      }
    });
  }

  async downloadJson(fileId: string): Promise<unknown> {
    return this.withAccessToken(async (accessToken) => {
      const response = await axios.get<unknown>(
        `${this.filesUrl}/${encodeURIComponent(fileId)}`,
        {
          params: { alt: "media" },
          headers: { Authorization: `Bearer ${accessToken}` },
          responseType: "json",
          timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
        }
      );

      if (typeof response.data === "string") {
        try {
          return JSON.parse(response.data) as unknown;
        } catch {
          throw new GoogleDriveRequestError(
            "Google Drive returned invalid JSON"
          );
        }
      }

      return response.data;
    });
  }

  async downloadFileToPath(params: {
    fileId: string;
    destinationPath: string;
  }): Promise<void> {
    return this.withAccessToken(async (accessToken) => {
      const response = await axios.get(
        `${this.filesUrl}/${encodeURIComponent(params.fileId)}`,
        {
          params: { alt: "media" },
          headers: { Authorization: `Bearer ${accessToken}` },
          responseType: "stream",
          maxContentLength: Infinity,
          timeout: 0,
        }
      );

      await mkdir(path.dirname(params.destinationPath), { recursive: true });
      await pipeline(
        response.data as NodeJS.ReadableStream,
        createWriteStream(params.destinationPath)
      );
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    return this.withAccessToken(async (accessToken) => {
      await axios.delete(`${this.filesUrl}/${encodeURIComponent(fileId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: GOOGLE_DRIVE_REQUEST_TIMEOUT_MS,
      });
    });
  }
}
