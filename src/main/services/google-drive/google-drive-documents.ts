import type { GoogleDriveFileMetadata } from "@types";

import type { GoogleDriveClient } from "./google-drive-client.js";
import {
  GOOGLE_DRIVE_DOCUMENT_ROLE_PROPERTY_VALUE,
  GOOGLE_DRIVE_DOCUMENTS_FOLDER_NAME,
  GOOGLE_DRIVE_ROLE_PROPERTY,
} from "./google-drive-constants.js";
import {
  buildGoogleDriveFileQuery,
  buildGoogleDriveFolderQuery,
} from "./google-drive-protocol.js";

/**
 * A JSON document stored as a single Drive file inside the `documents` folder.
 * `revision` is the Drive `headRevisionId` at read time and is passed as
 * `If-Match` when overwriting.
 */
export interface GoogleDriveDocumentRef<T> {
  fileId: string;
  revision: string | null;
  content: T;
}

export interface GoogleDriveDocumentsOptions {
  client: GoogleDriveClient;
  /** Resolves the sync root folder id; injected so tests avoid the network. */
  getRootFolderId: () => Promise<string>;
  folderName?: string;
}

/**
 * Fork: generic JSON-document store that backs the records formerly held by
 * Hydra Cloud (unlocked achievements, artwork, library, emulation saves).
 *
 * Documents are flat files; callers own the naming scheme, so a document name
 * must survive being stored as a Drive file name.
 */
export class GoogleDriveDocuments {
  private readonly client: GoogleDriveClient;
  private readonly getRootFolderId: () => Promise<string>;
  private readonly folderName: string;
  private folderId: string | null = null;

  constructor(options: GoogleDriveDocumentsOptions) {
    this.client = options.client;
    this.getRootFolderId = options.getRootFolderId;
    this.folderName = options.folderName ?? GOOGLE_DRIVE_DOCUMENTS_FOLDER_NAME;
  }

  /** Clears the memoized documents folder id, e.g. after disconnect. */
  resetCache() {
    this.folderId = null;
  }

  async read<T>(fileName: string): Promise<GoogleDriveDocumentRef<T> | null> {
    const file = await this.findDocument(fileName);
    if (!file) return null;

    const content = (await this.client.downloadJson(file.id)) as T;
    return {
      fileId: file.id,
      revision: file.headRevisionId ?? null,
      content,
    };
  }

  /**
   * Creates or overwrites a document. The current file is looked up first so
   * the write carries the correct `If-Match` revision.
   */
  async write<T>(
    fileName: string,
    content: T
  ): Promise<GoogleDriveDocumentRef<T>> {
    const folderId = await this.ensureFolder();
    const existing = await this.findDocument(fileName);
    const serialized = JSON.stringify(content);

    const file = existing
      ? await this.client.updateJsonFile({
          fileId: existing.id,
          content: serialized,
          ifMatch: existing.headRevisionId ?? "",
        })
      : await this.client.createJsonFile({
          name: fileName,
          parentId: folderId,
          appProperties: {
            [GOOGLE_DRIVE_ROLE_PROPERTY]:
              GOOGLE_DRIVE_DOCUMENT_ROLE_PROPERTY_VALUE,
          },
          content: serialized,
        });

    return {
      fileId: file.id,
      revision: file.headRevisionId ?? null,
      content,
    };
  }

  /**
   * Read-modify-write helper. The mutator receives the current content (or
   * null when the document does not exist yet) and must return the new
   * content; callers do their own merge inside it.
   */
  async update<T>(
    fileName: string,
    mutate: (current: T | null) => T
  ): Promise<GoogleDriveDocumentRef<T>> {
    const current = await this.read<T>(fileName);
    return this.write(fileName, mutate(current?.content ?? null));
  }

  async remove(fileName: string): Promise<void> {
    const file = await this.findDocument(fileName);
    if (file) await this.client.deleteFile(file.id);
  }

  private async findDocument(
    fileName: string
  ): Promise<GoogleDriveFileMetadata | null> {
    const folderId = await this.ensureFolder();
    return this.client.findFile({
      query: buildGoogleDriveFileQuery({ name: fileName, parentId: folderId }),
    });
  }

  private async ensureFolder(): Promise<string> {
    if (this.folderId) return this.folderId;

    const rootFolderId = await this.getRootFolderId();
    const existing = await this.client.findFile({
      query: buildGoogleDriveFolderQuery({
        name: this.folderName,
        parentId: rootFolderId,
      }),
    });
    if (existing) {
      this.folderId = existing.id;
      return this.folderId;
    }

    const created = await this.client.createFolder({
      name: this.folderName,
      parentId: rootFolderId,
      appProperties: {
        [GOOGLE_DRIVE_ROLE_PROPERTY]: GOOGLE_DRIVE_DOCUMENT_ROLE_PROPERTY_VALUE,
      },
    });
    this.folderId = created.id;
    return this.folderId;
  }
}

/** Drive file-name-safe id for per-game documents. */
export const googleDriveGameDocumentName = (
  prefix: string,
  shop: string,
  objectId: string
) => `${prefix}-${shop}-${objectId.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
