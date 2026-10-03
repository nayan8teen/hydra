import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidGoogleDriveClientId } from "./google-drive.js";

describe("google drive client id validation", () => {
  it("accepts desktop OAuth client ids, trimmed", () => {
    assert.equal(
      isValidGoogleDriveClientId(
        "123456789012-abcdefghijklmnop.apps.googleusercontent.com"
      ),
      true
    );
    assert.equal(
      isValidGoogleDriveClientId(
        "  123456789012-abcdefghijklmnop.apps.googleusercontent.com  "
      ),
      true
    );
  });

  it("rejects anything that is not a client id", () => {
    const rejected: unknown[] = [
      "",
      "client-id",
      "123456789012-abcdefghijklmnop.apps.googleusercontent.com/extra",
      "https://console.cloud.google.com/apis/credentials",
      "123456789012-abcdefghijklmnop.apps.googleusercontent.co",
      42,
      null,
      undefined,
    ];

    for (const candidate of rejected) {
      assert.equal(isValidGoogleDriveClientId(candidate), false);
    }
  });
});
