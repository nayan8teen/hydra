import type {
  GameShop,
  GoogleDriveBlobUploadResult,
  GoogleDriveFileMetadata,
  GoogleDriveFolderRef,
  GoogleDriveManifestRef,
  GoogleDriveStorageManifest,
} from "@types";

import { logger } from "../logger.js";
import { googleDriveClient } from "./google-drive-client-instance.js";
import {
  GOOGLE_DRIVE_BLOBS_FOLDER_NAME,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_DRIVE_GAME_KEY_PROPERTY,
  GOOGLE_DRIVE_GAMES_FOLDER_NAME,
  GOOGLE_DRIVE_MANIFEST_FILE_NAME,
  GOOGLE_DRIVE_MANIFEST_HISTORY_LIMIT,
  GOOGLE_DRIVE_MANIFEST_HISTORY_PREFIX,
  GOOGLE_DRIVE_ROLE_PROPERTY,
  GOOGLE_DRIVE_ROOT_PARENT_ID,
} from "./google-drive-constants.js";
import {
  GoogleDriveBlobNotFoundError,
  GoogleDriveManifestConflictError,
  GoogleDriveManifestInvalidError,
  isGoogleDrivePreconditionFailedError,
} from "./google-drive-errors.js";
import {
  buildGoogleDriveManifest,
  parseGoogleDriveManifest,
  type BuildGoogleDriveManifestInput,
} from "./google-drive-manifest.js";
import {
  buildGoogleDriveAppPropertyClause,
  buildGoogleDriveChildrenQuery,
  buildGoogleDriveFileQuery,
  buildGoogleDriveFolderQuery,
  buildGoogleDriveNamePrefixQuery,
  escapeGoogleDriveQueryValue,
  parseGoogleDriveManifestHistoryVersion,
} from "./google-drive-protocol.js";
import { getGoogleDriveSettings } from "./google-drive-settings.js";

export interface WriteGoogleDriveManifestInput
  extends Omit<BuildGoogleDriveManifestInput, "shop" | "objectId"> {
  previousManifestFileId: string | null;
  previousEtag: string | null;
}

const toFolderRef = (file: GoogleDriveFileMetadata): GoogleDriveFolderRef => ({
  id: file.id,
  name: file.name,
  webViewLink: file.webViewLink ?? null,
});

const sortByVersionDescending = (
  files: GoogleDriveFileMetadata[]
): GoogleDriveFileMetadata[] =>
  [...files].sort((left, right) => {
    const leftVersion = parseGoogleDriveManifestHistoryVersion(left.name) ?? 0;
    const rightVersion =
      parseGoogleDriveManifestHistoryVersion(right.name) ?? 0;
    return rightVersion - leftVersion;
  });

export class GoogleDriveStorage {
  private static rootFolder: GoogleDriveFolderRef | null = null;
  private static gamesFolderId: string | null = null;
  private static blobsFolderId: string | null = null;
  private static gameFolderRefs = new Map<string, GoogleDriveFolderRef>();
  private static blobFileIds = new Map<string, string>();

  /** Clears memoized folder/blob ids, e.g. after disconnect or account change. */
  static resetCache() {
    this.rootFolder = null;
    this.gamesFolderId = null;
    this.blobsFolderId = null;
    this.gameFolderRefs.clear();
    this.blobFileIds.clear();
  }

  private static gameKey(shop: GameShop, objectId: string) {
    return `${shop}-${objectId}`;
  }

  static async ensureRootFolder(): Promise<GoogleDriveFolderRef> {
    if (this.rootFolder) return this.rootFolder;

    const settings = await getGoogleDriveSettings();
    const existing = await this.findFolder({
      name: settings.folderName,
      parentId: GOOGLE_DRIVE_ROOT_PARENT_ID,
      property: { key: GOOGLE_DRIVE_ROLE_PROPERTY, value: "root" },
    });
    if (existing) {
      this.rootFolder = toFolderRef(existing);
      return this.rootFolder;
    }

    const created = await googleDriveClient.createFolder({
      name: settings.folderName,
      parentId: GOOGLE_DRIVE_ROOT_PARENT_ID,
      appProperties: { [GOOGLE_DRIVE_ROLE_PROPERTY]: "root" },
    });
    this.rootFolder = toFolderRef(created);
    return this.rootFolder;
  }

  static async getRootFolder(): Promise<GoogleDriveFolderRef | null> {
    const settings = await getGoogleDriveSettings();
    const existing = await this.findFolder({
      name: settings.folderName,
      parentId: GOOGLE_DRIVE_ROOT_PARENT_ID,
      property: { key: GOOGLE_DRIVE_ROLE_PROPERTY, value: "root" },
    });
    if (!existing) {
      this.rootFolder = null;
      return null;
    }

    this.rootFolder = toFolderRef(existing);
    return this.rootFolder;
  }

  static async ensureGamesFolder(): Promise<string> {
    if (this.gamesFolderId) return this.gamesFolderId;

    const root = await this.ensureRootFolder();
    this.gamesFolderId = await this.ensureChildFolder({
      name: GOOGLE_DRIVE_GAMES_FOLDER_NAME,
      parentId: root.id,
      property: { key: GOOGLE_DRIVE_ROLE_PROPERTY, value: "games" },
    });
    return this.gamesFolderId;
  }

  static async ensureBlobsFolder(): Promise<string> {
    if (this.blobsFolderId) return this.blobsFolderId;

    const root = await this.ensureRootFolder();
    this.blobsFolderId = await this.ensureChildFolder({
      name: GOOGLE_DRIVE_BLOBS_FOLDER_NAME,
      parentId: root.id,
      property: { key: GOOGLE_DRIVE_ROLE_PROPERTY, value: "blobs" },
    });
    return this.blobsFolderId;
  }

  static async ensureGameFolder(
    shop: GameShop,
    objectId: string
  ): Promise<GoogleDriveFolderRef> {
    const key = this.gameKey(shop, objectId);
    const cached = this.gameFolderRefs.get(key);
    if (cached) return cached;

    const gamesFolderId = await this.ensureGamesFolder();
    const existing = await this.findFolder({
      name: key,
      parentId: gamesFolderId,
      property: { key: GOOGLE_DRIVE_GAME_KEY_PROPERTY, value: key },
    });

    const folder =
      existing ??
      (await googleDriveClient.createFolder({
        name: key,
        parentId: gamesFolderId,
        appProperties: {
          [GOOGLE_DRIVE_ROLE_PROPERTY]: "game",
          [GOOGLE_DRIVE_GAME_KEY_PROPERTY]: key,
          hydraShop: shop,
          hydraObjectId: objectId,
        },
      }));

    const ref = toFolderRef(folder);
    this.gameFolderRefs.set(key, ref);
    return ref;
  }

  static async findBlob(hash: string): Promise<GoogleDriveFileMetadata | null> {
    const cachedId = this.blobFileIds.get(hash);
    if (cachedId) return { id: cachedId, name: hash };

    const blobsFolderId = await this.ensureBlobsFolder();
    const file = await googleDriveClient.findFile({
      query: buildGoogleDriveFileQuery({ name: hash, parentId: blobsFolderId }),
    });
    if (file) this.blobFileIds.set(hash, file.id);
    return file;
  }

  /** Uploads a content-addressed blob unless an identical one already exists. */
  static async uploadBlob(params: {
    hash: string;
    absolutePath: string;
    sizeBytes: number;
  }): Promise<GoogleDriveBlobUploadResult> {
    const existing = await this.findBlob(params.hash);
    if (existing) return { fileId: existing.id, uploaded: false };

    const blobsFolderId = await this.ensureBlobsFolder();
    const uploaded = await googleDriveClient.uploadBlobFile({
      name: params.hash,
      parentId: blobsFolderId,
      absolutePath: params.absolutePath,
      sizeBytes: params.sizeBytes,
      appProperties: { sha256: params.hash },
    });
    this.blobFileIds.set(params.hash, uploaded.id);

    return { fileId: uploaded.id, uploaded: true };
  }

  static async downloadBlob(params: {
    hash: string;
    destinationPath: string;
  }): Promise<void> {
    const file = await this.findBlob(params.hash);
    if (!file) {
      throw new GoogleDriveBlobNotFoundError(
        `Google Drive blob ${params.hash} was not found`
      );
    }

    await googleDriveClient.downloadFileToPath({
      fileId: file.id,
      destinationPath: params.destinationPath,
    });
  }

  /** Hashes of every blob stored on Drive, for bulk dedupe during uploads. */
  static async listBlobHashes(): Promise<string[]> {
    const blobsFolderId = await this.ensureBlobsFolder();
    const files = await googleDriveClient.listAllFiles({
      query: buildGoogleDriveChildrenQuery(blobsFolderId),
    });

    for (const file of files) this.blobFileIds.set(file.name, file.id);
    return files.map((file) => file.name);
  }

  static async readManifest(
    shop: GameShop,
    objectId: string
  ): Promise<GoogleDriveManifestRef | null> {
    const folder = await this.findGameFolder(shop, objectId);
    if (!folder) return null;

    const file = await googleDriveClient.findFile({
      query: buildGoogleDriveFileQuery({
        name: GOOGLE_DRIVE_MANIFEST_FILE_NAME,
        parentId: folder.id,
      }),
    });
    if (!file) return null;

    const content = await googleDriveClient.downloadJson(file.id);
    const manifest = parseGoogleDriveManifest(content);
    if (manifest.shop !== shop || manifest.objectId !== objectId) {
      throw new GoogleDriveManifestInvalidError(
        "Google Drive manifest belongs to another game"
      );
    }

    return {
      fileId: file.id,
      etag: file.etag ?? "",
      modifiedTime: file.modifiedTime ?? manifest.updatedAt,
      manifest,
    };
  }

  /**
   * Reads a manifest by Drive file id, for callers that know the snapshot id
   * but not the game folder (the restore path re-checks game ownership).
   */
  static async readManifestByFileId(
    fileId: string
  ): Promise<GoogleDriveManifestRef | null> {
    const file = await googleDriveClient.getFileMetadata(fileId);
    if (!file) return null;

    const content = await googleDriveClient.downloadJson(file.id);
    const manifest = parseGoogleDriveManifest(content);

    return {
      fileId: file.id,
      etag: file.etag ?? "",
      modifiedTime: file.modifiedTime ?? manifest.updatedAt,
      manifest,
    };
  }

  /**
   * Writes the head manifest for a game. `previousEtag` guards the update with
   * `If-Match`, so a concurrent commit from another device raises
   * `GoogleDriveManifestConflictError` instead of overwriting it.
   */
  static async writeManifest(
    shop: GameShop,
    objectId: string,
    input: WriteGoogleDriveManifestInput
  ): Promise<GoogleDriveManifestRef> {
    const folder = await this.ensureGameFolder(shop, objectId);
    const manifest = buildGoogleDriveManifest({ ...input, shop, objectId });
    const content = JSON.stringify(manifest);

    let file: GoogleDriveFileMetadata;
    if (input.previousManifestFileId) {
      if (!input.previousEtag) {
        throw new GoogleDriveManifestInvalidError(
          "Google Drive manifest etag is required for updates"
        );
      }

      try {
        file = await googleDriveClient.updateJsonFile({
          fileId: input.previousManifestFileId,
          content,
          ifMatch: input.previousEtag,
        });
      } catch (error) {
        if (isGoogleDrivePreconditionFailedError(error)) {
          throw new GoogleDriveManifestConflictError();
        }
        throw error;
      }
    } else {
      const existing = await googleDriveClient.findFile({
        query: buildGoogleDriveFileQuery({
          name: GOOGLE_DRIVE_MANIFEST_FILE_NAME,
          parentId: folder.id,
        }),
      });
      if (existing) {
        throw new GoogleDriveManifestConflictError(
          "Google Drive manifest already exists for this game"
        );
      }

      file = await googleDriveClient.createJsonFile({
        name: GOOGLE_DRIVE_MANIFEST_FILE_NAME,
        parentId: folder.id,
        appProperties: {
          [GOOGLE_DRIVE_ROLE_PROPERTY]: "manifest",
          [GOOGLE_DRIVE_GAME_KEY_PROPERTY]: this.gameKey(shop, objectId),
        },
        content,
      });
    }

    const ref: GoogleDriveManifestRef = {
      fileId: file.id,
      etag: file.etag ?? "",
      modifiedTime: file.modifiedTime ?? manifest.updatedAt,
      manifest,
    };

    await this.writeManifestHistory(folder.id, manifest).catch((error) =>
      logger.warn("Failed to write Google Drive manifest history", error)
    );

    return ref;
  }

  static async deleteGameFolder(shop: GameShop, objectId: string) {
    const key = this.gameKey(shop, objectId);
    const gamesFolderId = await this.ensureGamesFolder();
    const folder = await this.findFolder({
      name: key,
      parentId: gamesFolderId,
      property: { key: GOOGLE_DRIVE_GAME_KEY_PROPERTY, value: key },
    });
    this.gameFolderRefs.delete(key);
    if (!folder) return;

    await this.deleteFileTree(folder.id);
  }

  /** Removes the whole sync folder; used by disconnect with data deletion. */
  static async deleteAllData() {
    const settings = await getGoogleDriveSettings();
    const folder = await this.findFolder({
      name: settings.folderName,
      parentId: GOOGLE_DRIVE_ROOT_PARENT_ID,
      property: { key: GOOGLE_DRIVE_ROLE_PROPERTY, value: "root" },
    });
    this.resetCache();
    if (!folder) return;

    await this.deleteFileTree(folder.id);
  }

  /** Non-creating lookup used by reads; never touches Drive when data is absent. */
  private static async findGameFolder(
    shop: GameShop,
    objectId: string
  ): Promise<GoogleDriveFolderRef | null> {
    const key = this.gameKey(shop, objectId);
    const cached = this.gameFolderRefs.get(key);
    if (cached) return cached;

    const root = await this.getRootFolder();
    if (!root) return null;
    const gamesFolder = await this.findFolder({
      name: GOOGLE_DRIVE_GAMES_FOLDER_NAME,
      parentId: root.id,
      property: { key: GOOGLE_DRIVE_ROLE_PROPERTY, value: "games" },
    });
    if (!gamesFolder) return null;

    const folder = await this.findFolder({
      name: key,
      parentId: gamesFolder.id,
      property: { key: GOOGLE_DRIVE_GAME_KEY_PROPERTY, value: key },
    });
    if (!folder) return null;

    const ref = toFolderRef(folder);
    this.gameFolderRefs.set(key, ref);
    return ref;
  }

  private static async ensureChildFolder(params: {
    name: string;
    parentId: string;
    property: { key: string; value: string };
  }): Promise<string> {
    const existing = await this.findFolder(params);
    if (existing) return existing.id;

    const created = await googleDriveClient.createFolder({
      name: params.name,
      parentId: params.parentId,
      appProperties: { [params.property.key]: params.property.value },
    });
    return created.id;
  }

  private static async findFolder(params: {
    name: string;
    parentId: string;
    property?: { key: string; value: string };
  }): Promise<GoogleDriveFileMetadata | null> {
    if (params.property) {
      const parentClause = `'${escapeGoogleDriveQueryValue(params.parentId)}' in parents and trashed = false and mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}'`;
      const byProperty = await googleDriveClient.findFile({
        query: `${buildGoogleDriveAppPropertyClause(params.property)} and ${parentClause}`,
      });
      if (byProperty) return byProperty;
    }

    return googleDriveClient.findFile({
      query: buildGoogleDriveFolderQuery({
        name: params.name,
        parentId: params.parentId,
      }),
    });
  }

  private static async writeManifestHistory(
    gameFolderId: string,
    manifest: GoogleDriveStorageManifest
  ) {
    await googleDriveClient.createJsonFile({
      name: `${GOOGLE_DRIVE_MANIFEST_HISTORY_PREFIX}${manifest.version}.json`,
      parentId: gameFolderId,
      appProperties: {
        [GOOGLE_DRIVE_ROLE_PROPERTY]: "manifest-history",
        hydraVersion: String(manifest.version),
      },
      content: JSON.stringify(manifest),
    });

    const historyFiles = await googleDriveClient.listAllFiles({
      query: buildGoogleDriveNamePrefixQuery({
        namePrefix: GOOGLE_DRIVE_MANIFEST_HISTORY_PREFIX,
        parentId: gameFolderId,
      }),
    });
    const expiredFiles = sortByVersionDescending(historyFiles).slice(
      GOOGLE_DRIVE_MANIFEST_HISTORY_LIMIT
    );
    for (const file of expiredFiles) {
      await googleDriveClient.deleteFile(file.id);
    }
  }

  private static async deleteFileTree(fileId: string): Promise<void> {
    const children = await googleDriveClient.listAllFiles({
      query: buildGoogleDriveChildrenQuery(fileId),
    });

    for (const child of children) {
      if (child.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
        await this.deleteFileTree(child.id);
      } else {
        await googleDriveClient.deleteFile(child.id);
      }
    }

    await googleDriveClient.deleteFile(fileId);
  }
}
