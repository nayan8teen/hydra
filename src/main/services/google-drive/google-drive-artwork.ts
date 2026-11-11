import type { ArtworkAssetType, GameShop } from "@types";

import { googleDriveDocuments } from "./google-drive-documents-instance.js";

const ARTWORK_DOCUMENT_NAME = "artwork.json";

export type GoogleDriveArtworkEntry =
  | { kind: "upload"; imageKey: string }
  | { kind: "url"; url: string };

export interface GoogleDriveArtworkDocument {
  schemaVersion: 1;
  games: Record<
    string,
    Partial<Record<ArtworkAssetType, GoogleDriveArtworkEntry>>
  >;
  updatedAt: string;
}

export const googleDriveArtworkGameKey = (shop: GameShop, objectId: string) =>
  `${shop}:${objectId}`;

const emptyArtworkDocument = (): GoogleDriveArtworkDocument => ({
  schemaVersion: 1,
  games: {},
  updatedAt: new Date().toISOString(),
});

export const readGoogleDriveArtwork =
  async (): Promise<GoogleDriveArtworkDocument> =>
    (
      await googleDriveDocuments
        .read<GoogleDriveArtworkDocument>(ARTWORK_DOCUMENT_NAME)
        .catch(() => null)
    )?.content ?? emptyArtworkDocument();

export const setGoogleDriveArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType,
  entry: GoogleDriveArtworkEntry
) => {
  await googleDriveDocuments.update<GoogleDriveArtworkDocument>(
    ARTWORK_DOCUMENT_NAME,
    (current) => {
      const document = current ?? emptyArtworkDocument();
      const key = googleDriveArtworkGameKey(shop, objectId);
      return {
        ...document,
        games: {
          ...document.games,
          [key]: { ...document.games[key], [assetType]: entry },
        },
        updatedAt: new Date().toISOString(),
      };
    }
  );
};

export const deleteGoogleDriveArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType
) => {
  await googleDriveDocuments.update<GoogleDriveArtworkDocument>(
    ARTWORK_DOCUMENT_NAME,
    (current) => {
      if (!current) return emptyArtworkDocument();

      const key = googleDriveArtworkGameKey(shop, objectId);
      const assets = current.games[key];
      if (!assets?.[assetType]) return current;

      const { [assetType]: _removed, ...remaining } = assets;
      const games = { ...current.games };
      if (Object.keys(remaining).length) {
        games[key] = remaining;
      } else {
        delete games[key];
      }

      return { ...current, games, updatedAt: new Date().toISOString() };
    }
  );
};
