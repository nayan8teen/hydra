import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  EmulationCloudSave,
  EmulationSaveMetadata,
  EmulationSaveEmulator,
  EmulationSavePlatform,
  EmulatorBinary,
} from "@types";

import {
  googleDriveDocuments,
  GoogleDriveService,
  GoogleDriveStorage,
} from "@main/services/google-drive";

/*
 * Fork: cloud emulation saves now live in the user's own Google Drive instead
 * of the Hydra `/profile/emulation-saves` API. An `emulation-saves.json`
 * document keeps the metadata records and each artifact is stored as a
 * content-addressed blob under the shared `blobs` folder.
 *
 * The public surface is unchanged so every caller (renderer, big-picture, the
 * upload/restore events) keeps working.
 */

const SAVES_DOCUMENT_NAME = "emulation-saves.json";
const SAVES_SCHEMA_VERSION = 1 as const;
const SAVE_KIND = "game_save" as const;

export interface GoogleDriveEmulationSaveRecord extends EmulationCloudSave {
  /** Content-addressed blob hash of the save artifact. */
  artifactHash: string;
}

interface GoogleDriveEmulationSavesDocument {
  schemaVersion: typeof SAVES_SCHEMA_VERSION;
  saves: GoogleDriveEmulationSaveRecord[];
  updatedAt: string;
}

export const toEmulationSaveEmulator = (
  binary: EmulatorBinary
): EmulationSaveEmulator => {
  if (
    binary !== "duckstation" &&
    binary !== "pcsx2" &&
    binary !== "ppsspp" &&
    binary !== "dolphin"
  ) {
    throw new Error(`Emulator "${binary}" has no cloud emulation saves`);
  }
  return binary;
};

export interface UploadEmulationSaveInput {
  platform: EmulationSavePlatform;
  emulator: EmulationSaveEmulator;
  /** "launchbox" when the save matched a game; null (with objectId) otherwise. */
  shop: "launchbox" | null;
  objectId: string | null;
  /** Stable per-game slot id — the on-card folder name / save identifier. */
  saveIdentity: string;
  fileName: string; // must end in .psu (PS2) or .mcs (PS1)
  label: string;
  localLastModifiedAt: string; // ISO 8601
  buffer: Buffer;
  metadata?: EmulationSaveMetadata;
}

const assertDriveReady = async () => {
  if (!(await GoogleDriveService.isSyncEnabled())) {
    throw new Error("Google Drive save sync is not enabled or not connected");
  }
};

const readDocument = async (): Promise<GoogleDriveEmulationSavesDocument> => {
  const document =
    await googleDriveDocuments.read<GoogleDriveEmulationSavesDocument>(
      SAVES_DOCUMENT_NAME
    );

  return (
    document?.content ?? {
      schemaVersion: SAVES_SCHEMA_VERSION,
      saves: [],
      updatedAt: new Date(0).toISOString(),
    }
  );
};

const mutateSaves = (
  mutate: (
    saves: GoogleDriveEmulationSaveRecord[]
  ) => GoogleDriveEmulationSaveRecord[]
) =>
  googleDriveDocuments.update<GoogleDriveEmulationSavesDocument>(
    SAVES_DOCUMENT_NAME,
    (current) => ({
      schemaVersion: SAVES_SCHEMA_VERSION,
      saves: mutate(current?.saves ?? []),
      updatedAt: new Date().toISOString(),
    })
  );

const withTempDir = async <T>(
  prefix: string,
  run: (dir: string) => Promise<T>
): Promise<T> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

/** Uploads the artifact blob and commits the metadata record. */
export const uploadEmulationSave = async (
  input: UploadEmulationSaveInput
): Promise<EmulationCloudSave> => {
  await assertDriveReady();

  const artifactHash = createHash("sha256").update(input.buffer).digest("hex");

  await withTempDir("hydra-drive-emu-", async (dir) => {
    const artifactPath = path.join(dir, "artifact.bin");
    await fs.writeFile(artifactPath, input.buffer);
    await GoogleDriveStorage.uploadBlob({
      hash: artifactHash,
      absolutePath: artifactPath,
      sizeBytes: input.buffer.length,
    });
  });

  const now = new Date().toISOString();
  const record: GoogleDriveEmulationSaveRecord = {
    id: randomUUID(),
    platform: input.platform,
    emulator: input.emulator,
    saveKind: SAVE_KIND,
    saveIdentity: input.saveIdentity,
    artifactLengthInBytes: input.buffer.length,
    fileName: input.fileName,
    hostname: os.hostname(),
    localLastModifiedAt: input.localLastModifiedAt,
    label: input.label,
    metadata: input.metadata ?? null,
    shop: input.shop,
    objectId: input.objectId,
    lastUploadedAt: now,
    createdAt: now,
    updatedAt: now,
    artifactHash,
  };

  await mutateSaves((saves) => [...saves, record]);
  return record;
};

export const listEmulationSaves = async (
  platform: EmulationSavePlatform,
  emulator: EmulationSaveEmulator,
  objectId?: string | null
): Promise<EmulationCloudSave[]> => {
  if (!(await GoogleDriveService.isSyncEnabled())) return [];

  const document = await readDocument();
  return document.saves.filter(
    (save) =>
      save.platform === platform &&
      save.emulator === emulator &&
      (objectId
        ? save.shop === "launchbox" && save.objectId === objectId
        : true)
  );
};

/** Resolves the artifact blob and reads it back as a buffer. */
export const downloadEmulationSaveBytes = async (
  id: string
): Promise<Buffer> => {
  await assertDriveReady();

  const document = await readDocument();
  const record = document.saves.find((save) => save.id === id);
  if (!record) throw new Error("Emulation save not found");

  return withTempDir("hydra-drive-emu-", async (dir) => {
    const artifactPath = path.join(dir, "artifact.bin");
    await GoogleDriveStorage.downloadBlob({
      hash: record.artifactHash,
      destinationPath: artifactPath,
    });
    return fs.readFile(artifactPath);
  });
};

export const deleteEmulationSave = async (id: string): Promise<void> => {
  await assertDriveReady();
  await mutateSaves((saves) => saves.filter((save) => save.id !== id));
};

export const updateEmulationSave = async (
  id: string,
  body: { label?: string | null; metadata?: Record<string, unknown> | null }
): Promise<EmulationCloudSave> => {
  await assertDriveReady();

  const document = await readDocument();
  const existing = document.saves.find((save) => save.id === id);
  if (!existing) throw new Error("Emulation save not found");

  const updated: GoogleDriveEmulationSaveRecord = {
    ...existing,
    ...(body.label !== undefined ? { label: body.label } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    updatedAt: new Date().toISOString(),
  };

  await mutateSaves((saves) =>
    saves.map((save) => (save.id === id ? updated : save))
  );
  return updated;
};
