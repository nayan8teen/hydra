import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getBackgroundCloudSaveSweepIntervalMs,
  isBackgroundCloudSaveSweepEnabled,
  shouldSkipGameForBackgroundSweep,
  shouldStartBackgroundCloudSaveSweep,
} from "./background-sweep-policy.js";

const MINUTE_IN_MS = 60_000;

describe("background cloud save sweep policy", () => {
  it("only enables the sweep when Drive sync and the sweep are both on", () => {
    assert.equal(
      isBackgroundCloudSaveSweepEnabled({
        driveSyncEnabled: false,
        backgroundSweepEnabled: true,
      }),
      false
    );
    assert.equal(
      isBackgroundCloudSaveSweepEnabled({
        driveSyncEnabled: true,
        backgroundSweepEnabled: false,
      }),
      false
    );
    assert.equal(
      isBackgroundCloudSaveSweepEnabled({
        driveSyncEnabled: true,
        backgroundSweepEnabled: true,
      }),
      true
    );
  });

  it("uses the configured interval and falls back to the default", () => {
    assert.equal(
      getBackgroundCloudSaveSweepIntervalMs({
        backgroundSweepIntervalMinutes: 45,
      }),
      45 * MINUTE_IN_MS
    );
    assert.equal(
      getBackgroundCloudSaveSweepIntervalMs({
        backgroundSweepIntervalMinutes: 0,
      }),
      30 * MINUTE_IN_MS
    );
  });

  it("never sweeps before a full interval has elapsed", () => {
    const intervalMs = 30 * MINUTE_IN_MS;

    assert.equal(
      shouldStartBackgroundCloudSaveSweep({
        now: 1_000,
        lastStartedAt: null,
        intervalMs,
      }),
      false
    );
    assert.equal(
      shouldStartBackgroundCloudSaveSweep({
        now: intervalMs - 1,
        lastStartedAt: 0,
        intervalMs,
      }),
      false
    );
    assert.equal(
      shouldStartBackgroundCloudSaveSweep({
        now: intervalMs,
        lastStartedAt: 0,
        intervalMs,
      }),
      true
    );
  });

  it("skips games that are playing or launching", () => {
    assert.equal(
      shouldSkipGameForBackgroundSweep({
        isRunning: true,
        hasPendingLaunch: false,
      }),
      true
    );
    assert.equal(
      shouldSkipGameForBackgroundSweep({
        isRunning: false,
        hasPendingLaunch: true,
      }),
      true
    );
    assert.equal(
      shouldSkipGameForBackgroundSweep({
        isRunning: false,
        hasPendingLaunch: false,
      }),
      false
    );
  });
});
