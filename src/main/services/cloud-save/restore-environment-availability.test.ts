import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { isUnavailableRestoreEnvironment } from "./restore-environment-availability.ts";

describe("isUnavailableRestoreEnvironment", () => {
  it("treats unresolvable restore paths as an environmental failure", () => {
    for (const marker of [
      "cloud_save_restore_prefix_unresolved",
      "cloud_save_restore_prefix_invalid",
      "cloud_save_restore_profile_unresolved",
    ]) {
      assert.equal(isUnavailableRestoreEnvironment(new Error(marker)), true);
    }
  });

  it("does not swallow unrelated restore failures", () => {
    assert.equal(
      isUnavailableRestoreEnvironment(
        new Error("cloud_save_restore_not_found")
      ),
      false
    );
    assert.equal(
      isUnavailableRestoreEnvironment(
        new Error("Restored cloud save did not match")
      ),
      false
    );
    assert.equal(
      isUnavailableRestoreEnvironment("cloud_save_restore_prefix_invalid"),
      false
    );
    assert.equal(isUnavailableRestoreEnvironment(undefined), false);
  });
});
