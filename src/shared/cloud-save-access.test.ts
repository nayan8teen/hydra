import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCloudSaveAccessAction } from "./cloud-save-access.js";

describe("cloud save access", () => {
  it("asks for a Drive connection when Drive is not connected", () => {
    assert.equal(getCloudSaveAccessAction(false), "connect-drive");
  });

  it("opens cloud saves once Drive is connected", () => {
    assert.equal(getCloudSaveAccessAction(true), "open");
  });
});
