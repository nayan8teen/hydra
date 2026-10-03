import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildGoogleDriveAppPropertyClause,
  buildGoogleDriveFileQuery,
  buildGoogleDriveFolderQuery,
  buildGoogleDriveNamePrefixQuery,
  buildGoogleDriveMultipartBody,
  escapeGoogleDriveQueryValue,
  parseGoogleDriveManifestHistoryVersion,
} from "./google-drive-protocol.js";

describe("Google Drive protocol helpers", () => {
  it("escapes Drive query values", () => {
    assert.equal(escapeGoogleDriveQueryValue("O'Brien"), "O\\'Brien");
    assert.equal(escapeGoogleDriveQueryValue("a\\b"), "a\\\\b");
  });

  it("builds file, folder and app property queries", () => {
    assert.equal(
      buildGoogleDriveFileQuery({
        name: "manifest.json",
        parentId: "folder-1",
      }),
      "name = 'manifest.json' and 'folder-1' in parents and trashed = false"
    );
    assert.equal(
      buildGoogleDriveFolderQuery({
        name: "Hydra Save Sync",
        parentId: "root",
      }),
      "name = 'Hydra Save Sync' and 'root' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'"
    );
    assert.equal(
      buildGoogleDriveAppPropertyClause({ key: "hydraRole", value: "root" }),
      "appProperties has { key='hydraRole' and value='root' }"
    );
    assert.equal(
      buildGoogleDriveNamePrefixQuery({
        namePrefix: "manifest-",
        parentId: "game-1",
      }),
      "name contains 'manifest-' and 'game-1' in parents and trashed = false"
    );
  });

  it("builds a multipart/related body", () => {
    const body = buildGoogleDriveMultipartBody({
      metadata: { name: "manifest.json" },
      content: '{"version":1}',
      boundary: "boundary-1",
    });

    assert.equal(
      body.toString("utf8"),
      "--boundary-1\r\n" +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        '{"name":"manifest.json"}\r\n' +
        "--boundary-1\r\n" +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        '{"version":1}\r\n' +
        "--boundary-1--\r\n"
    );
  });

  it("parses manifest history file versions", () => {
    assert.equal(
      parseGoogleDriveManifestHistoryVersion("manifest-12.json"),
      12
    );
    assert.equal(
      parseGoogleDriveManifestHistoryVersion("manifest-0.json"),
      null
    );
    assert.equal(parseGoogleDriveManifestHistoryVersion("manifest.json"), null);
    assert.equal(
      parseGoogleDriveManifestHistoryVersion("manifest-2-extra.json"),
      null
    );
  });
});
