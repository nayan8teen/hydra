import axios from "axios";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  LocalScreenshot,
  LocalScreenshotUploadOptions,
  ScreenshotModerationState,
  ScreenshotQuality,
  ScreenshotUploadProgress,
} from "@types";

import { normalizeScreenshotDescription } from "@shared";
import { GoogleDriveService } from "../google-drive/google-drive-service";
import { uploadGoogleDriveMedia } from "../google-drive/google-drive-media";
import { saveGoogleDriveScreenshot } from "../google-drive/google-drive-screenshots";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { compressScreenshotForUpload } from "./screenshot-compression";
import { ScreenshotTelemetry } from "./screenshot-telemetry";
import { ScreenshotUploadNotifier } from "./screenshot-upload-notifier";
import {
  SCREENSHOT_FEATURE_DISABLED_CODE,
  SCREENSHOT_MISSING_FILE_CODE,
  getAlreadyUploadedScreenshot,
  getScreenshotUploadFailure,
  planScreenshotUploadRecovery,
  type ScreenshotUploadFailure,
  type ScreenshotUploadNextStep,
} from "./screenshot-upload-retry-policy";

const PROGRESS_THROTTLE_MS = 150;
const MIN_SCHEDULED_RUN_DELAY_MS = 1_000;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

const MODERATION_STATUSES = new Set<string>(["PENDING", "APPROVED", "BLOCKED"]);

const isModerationStatus = (
  value: unknown
): value is ScreenshotModerationState["moderationStatus"] =>
  typeof value === "string" && MODERATION_STATUSES.has(value);

const isActiveUploadState = (state: LocalScreenshot["state"]) =>
  state === "queued" || state === "uploading";

const emitProgress = (progress: ScreenshotUploadProgress) => {
  WindowManager.sendToAppWindows("on-screenshot-upload-progress", progress);
};

const getCurrentOwnerId = () => HydraApi.getAuthContext()?.userId ?? null;

const RESET_WAIT_COUNTS = {
  uploadGameWaits: 0,
  uploadModerationWaits: 0,
  uploadCapacityWaits: 0,
  uploadRateLimitWaits: 0,
} satisfies Partial<LocalScreenshot>;

const getIncrementedWaitCount = (
  screenshot: LocalScreenshot,
  failure: ScreenshotUploadFailure
): Partial<LocalScreenshot> => {
  switch (failure.action) {
    case "wait_for_game":
      return { uploadGameWaits: (screenshot.uploadGameWaits ?? 0) + 1 };
    case "moderation_wait":
      return {
        uploadModerationWaits: (screenshot.uploadModerationWaits ?? 0) + 1,
      };
    case "wait":
      return { uploadCapacityWaits: (screenshot.uploadCapacityWaits ?? 0) + 1 };
    case "rate_limit_wait":
      return {
        uploadRateLimitWaits: (screenshot.uploadRateLimitWaits ?? 0) + 1,
      };
    default:
      return {};
  }
};

class ScreenshotUploadWorker {
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private uploadsDisabledThisRun = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private activeUpload: {
    clientId: string;
    controller: AbortController;
  } | null = null;
  private missingFileHandler: ((clientId: string) => Promise<boolean>) | null =
    null;
  private lastOwnerId: string | null = null;
  private authListenerRegistered = false;

  public start() {
    if (!this.authListenerRegistered) {
      this.authListenerRegistered = true;
      HydraApi.onAuthContextChanged(() => this.handleAuthContextChange());
    }
    this.lastOwnerId = getCurrentOwnerId();
    void this.resetInterruptedUploads()
      .catch((error) => {
        logger.error("Could not reset interrupted screenshot uploads", error);
      })
      .finally(() => void this.trigger());
  }

  public onMissingFile(handler: (clientId: string) => Promise<boolean>) {
    this.missingFileHandler = handler;
  }

  public async enqueue(
    clientId: string,
    options: LocalScreenshotUploadOptions
  ) {
    const ownerId = getCurrentOwnerId();
    if (!ownerId || !HydraApi.isLoggedIn()) {
      throw new Error("user not logged in");
    }

    const screenshot = await LocalScreenshotStore.get(clientId);
    if (!screenshot) throw new Error("screenshot_missing");
    if (screenshot.ownerId && screenshot.ownerId !== ownerId) {
      throw new Error("screenshot_owner_mismatch");
    }
    if (isActiveUploadState(screenshot.state)) return screenshot;
    if (screenshot.state === "uploaded" || screenshot.state === "deleted") {
      return screenshot;
    }

    // Fork: Drive storage has no upload tier limits, so captures always keep
    // the 1080p tier that upstream paywalled behind Hydra Cloud.
    const quality: ScreenshotQuality = "CLOUD";
    const isQualityChange =
      screenshot.uploadQuality != null && screenshot.uploadQuality !== quality;
    const updated = await LocalScreenshotStore.update(clientId, {
      ownerId,
      state: "queued",
      isSpoiler: options.isSpoiler,
      visibility: options.visibility,
      commentsEnabled:
        options.commentsEnabled ?? screenshot.commentsEnabled ?? true,
      customGameTitle:
        screenshot.shop === "custom"
          ? options.customGameTitle?.trim() || null
          : screenshot.customGameTitle,
      description:
        options.description === undefined
          ? (screenshot.description ?? null)
          : normalizeScreenshotDescription(options.description),
      uploadProgress: 0,
      uploadAttempts: 0,
      ...RESET_WAIT_COUNTS,
      nextUploadAttemptAt: null,
      lastError: null,
      uploadQuality: quality,
      uploadQualityFallback: false,
      ...(isQualityChange ? { uploadClientId: randomUUID() } : {}),
    });

    emitProgress({ clientId, state: "queued", progress: 0 });
    ScreenshotTelemetry.record("review", "upload");
    await ScreenshotUploadNotifier.refresh();
    void this.trigger();
    return updated;
  }

  public cancel(clientId: string) {
    if (this.activeUpload?.clientId === clientId) {
      this.activeUpload.controller.abort();
    }
  }

  public trigger() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.running !== null) {
      this.rerunRequested = true;
      return this.running;
    }

    this.running = this.run()
      .catch((error) => {
        logger.error("Screenshot upload worker failed", error);
      })
      .finally(() => {
        this.running = null;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          void this.trigger();
          return;
        }
        void this.scheduleNextRun().catch((error) => {
          logger.error("Could not schedule the next screenshot upload", error);
        });
      });

    return this.running;
  }

  public stop() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.activeUpload?.controller.abort();
  }

  public async handleModerationResult(result: ScreenshotModerationState) {
    const screenshot = await LocalScreenshotStore.findByScreenshotId(result.id);
    if (!screenshot) return;

    await LocalScreenshotStore.update(screenshot.clientId, {
      moderationStatus: result.moderationStatus,
      moderationReason: result.moderationReason ?? null,
    });
  }

  private handleAuthContextChange() {
    const ownerId = getCurrentOwnerId();
    if (ownerId === this.lastOwnerId) return;
    this.lastOwnerId = ownerId;

    this.stop();
    if (ownerId) void this.trigger();
  }

  private async resetInterruptedUploads() {
    const screenshots = await LocalScreenshotStore.list();
    await Promise.all(
      screenshots
        .filter((screenshot) => screenshot.state === "uploading")
        .map((screenshot) =>
          LocalScreenshotStore.update(screenshot.clientId, {
            state: "queued",
            uploadProgress: 0,
          })
        )
    );
  }

  private async processQueue(
    queue: LocalScreenshot[],
    ownerId: string,
    authContext: HydraApiAuthContext
  ): Promise<void> {
    const [screenshot, ...rest] = queue;
    if (!screenshot || !HydraApi.isAuthContextCurrent(authContext)) return;
    if (this.uploadsDisabledThisRun) {
      await this.failUploadsDisabled(queue);
      return;
    }

    if ((screenshot.nextUploadAttemptAt ?? 0) <= Date.now()) {
      const current = await LocalScreenshotStore.get(screenshot.clientId);
      if (current?.state === "queued" && current.ownerId === ownerId) {
        await this.process(current);
        await ScreenshotUploadNotifier.refresh();
      }
    }

    return this.processQueue(rest, ownerId, authContext);
  }

  private async failUploadsDisabled(queue: LocalScreenshot[]) {
    const failure: ScreenshotUploadFailure = {
      code: SCREENSHOT_FEATURE_DISABLED_CODE,
      action: "terminal",
    };
    for (const screenshot of queue) {
      const current = await LocalScreenshotStore.get(screenshot.clientId);
      if (current?.state === "queued") {
        await this.markFailed(screenshot.clientId, failure, "queued");
      }
    }
  }

  private async run() {
    this.uploadsDisabledThisRun = false;
    const ownerId = getCurrentOwnerId();
    if (!ownerId || !HydraApi.isLoggedIn()) return;
    // Leave captures queued while Drive is disconnected instead of failing them.
    if (!(await GoogleDriveService.isSyncEnabled())) return;
    const authContext = HydraApi.getAuthContext();
    if (!authContext) return;

    const screenshots = await LocalScreenshotStore.list();
    const queued = screenshots
      .filter(
        (screenshot) =>
          screenshot.ownerId === ownerId && screenshot.state === "queued"
      )
      .toSorted((a, b) => a.capturedAt - b.capturedAt);

    await this.processQueue(queued, ownerId, authContext);
    if (!HydraApi.isAuthContextCurrent(authContext)) return;

    await ScreenshotUploadNotifier.refresh();
  }

  private async process(screenshot: LocalScreenshot) {
    const { clientId } = screenshot;
    const controller = new AbortController();
    this.activeUpload = { clientId, controller };

    const quality: ScreenshotQuality = "CLOUD";
    const uploadClientId = screenshot.uploadClientId ?? clientId;
    const attempt = (screenshot.uploadAttempts ?? 0) + 1;

    let lastProgressAt = 0;
    const reportProgress = (progress: number, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
      lastProgressAt = now;
      emitProgress({ clientId, state: "uploading", progress });
    };

    const claimed = await LocalScreenshotStore.update(clientId, (current) =>
      current.state === "queued"
        ? {
            state: "uploading",
            uploadAttempts: attempt,
            uploadProgress: 0,
            uploadQuality: quality,
            uploadClientId,
            lastError: null,
          }
        : {}
    );
    if (claimed?.state !== "uploading") {
      if (this.activeUpload?.controller === controller)
        this.activeUpload = null;
      return;
    }
    reportProgress(0, true);

    try {
      await this.uploadToDrive(
        screenshot,
        uploadClientId,
        quality,
        controller,
        reportProgress
      );
      reportProgress(1, true);

      await this.markUploaded(clientId, {
        id: uploadClientId,
        moderationStatus: "APPROVED",
        moderationReason: null,
      });
      ScreenshotTelemetry.record("upload", "uploaded", quality);
    } catch (error) {
      await this.handleFailure(screenshot, quality, attempt, error, controller);
    } finally {
      if (this.activeUpload?.controller === controller)
        this.activeUpload = null;
    }
  }

  private async uploadToDrive(
    screenshot: LocalScreenshot,
    uploadClientId: string,
    quality: ScreenshotQuality,
    controller: AbortController,
    reportProgress: (progress: number, force?: boolean) => void
  ) {
    const original = await fs.promises.readFile(screenshot.path);
    const compressed = await compressScreenshotForUpload(original, quality);
    if (controller.signal.aborted) throw new axios.CanceledError();

    reportProgress(0.1, true);
    const imageKey = await uploadGoogleDriveMedia({
      data: compressed.image,
      extension: "jpg",
    });
    reportProgress(0.85, true);
    const thumbnailKey = await uploadGoogleDriveMedia({
      data: compressed.thumbnail,
      extension: "jpg",
    });

    await saveGoogleDriveScreenshot({
      clientId: uploadClientId,
      shop: screenshot.shop,
      objectId: screenshot.objectId,
      imageKey,
      thumbnailKey,
      width: compressed.width,
      height: compressed.height,
      capturedAt: screenshot.capturedAt,
      uploadedAt: Date.now(),
      quality: compressed.quality,
      gameTitle: screenshot.gameTitle,
      customGameTitle: screenshot.customGameTitle,
      description: normalizeScreenshotDescription(screenshot.description),
      isSpoiler: screenshot.isSpoiler,
      visibility: screenshot.visibility,
      commentsEnabled: screenshot.commentsEnabled !== false,
    });

    await LocalScreenshotStore.update(screenshot.clientId, {
      moderationStatus: null,
      moderationReason: null,
      uploadQuality: compressed.quality,
    });
  }

  private async markUploaded(
    clientId: string,
    result: {
      id: string;
      moderationStatus: unknown;
      moderationReason: unknown;
    }
  ) {
    const moderationStatus = isModerationStatus(result.moderationStatus)
      ? result.moderationStatus
      : "PENDING";
    const moderationReason =
      typeof result.moderationReason === "string"
        ? result.moderationReason
        : null;
    await LocalScreenshotStore.update(clientId, (current) => {
      const hasEarlyVerdict =
        moderationStatus === "PENDING" &&
        current.pendingCompleteScreenshotId === result.id &&
        isModerationStatus(current.moderationStatus) &&
        current.moderationStatus !== "PENDING";

      return {
        state: current.state === "deleted" ? "deleted" : "uploaded",
        screenshotId: result.id,
        moderationStatus: hasEarlyVerdict
          ? current.moderationStatus
          : moderationStatus,
        moderationReason: hasEarlyVerdict
          ? (current.moderationReason ?? null)
          : moderationReason,
        uploadProgress: 1,
        ...RESET_WAIT_COUNTS,
        uploadedAt: Date.now(),
        nextUploadAttemptAt: null,
        pendingCompleteScreenshotId: null,
        lastError: null,
      };
    });
    emitProgress({ clientId, state: "uploaded", progress: 1 });
  }

  private async updateInState(
    clientId: string,
    expectedState: LocalScreenshot["state"],
    changes: (current: LocalScreenshot) => Partial<LocalScreenshot>
  ) {
    let applied = false;
    await LocalScreenshotStore.update(clientId, (current) => {
      if (current.state !== expectedState) return {};
      applied = true;
      return changes(current);
    });
    return applied;
  }

  private async requeueCancelledUpload(clientId: string, attempt: number) {
    await this.updateInState(clientId, "uploading", () => ({
      state: "queued",
      uploadProgress: 0,
      uploadAttempts: Math.max(0, attempt - 1),
    }));
  }

  private async applyRecoveryStep(
    clientId: string,
    failure: ScreenshotUploadFailure,
    step: ScreenshotUploadNextStep,
    attempt: number
  ) {
    switch (step.kind) {
      case "stopped":
        await this.requeueCancelledUpload(clientId, attempt);
        return;
      case "failed":
        await this.markFailed(clientId, failure, "uploading");
        return;
      case "retry_now": {
        const requeued = await this.updateInState(
          clientId,
          "uploading",
          () => ({
            state: "queued",
            uploadProgress: 0,
            lastError: failure.code,
            nextUploadAttemptAt: null,
            pendingCompleteScreenshotId: null,
            ...(step.quality
              ? { uploadQuality: step.quality, uploadQualityFallback: true }
              : {}),
          })
        );
        if (!requeued) return;
        emitProgress({ clientId, state: "queued", progress: 0 });
        this.rerunRequested = true;
        return;
      }
      case "retry_at": {
        const requeued = await this.updateInState(
          clientId,
          "uploading",
          (current) => ({
            state: "queued",
            uploadProgress: 0,
            lastError: failure.code,
            nextUploadAttemptAt: Date.now() + step.delay,
            uploadAttempts: step.countsAsAttempt
              ? attempt
              : Math.max(0, attempt - 1),
            ...getIncrementedWaitCount(current, failure),
            ...(step.rotateClientId
              ? {
                  uploadClientId: randomUUID(),
                  pendingCompleteScreenshotId: null,
                }
              : {}),
          })
        );
        if (!requeued) return;
        emitProgress({ clientId, state: "queued", progress: 0 });
      }
    }
  }

  private async handleFailure(
    screenshot: LocalScreenshot,
    quality: ScreenshotQuality,
    attempt: number,
    error: unknown,
    controller: AbortController
  ) {
    const { clientId } = screenshot;
    const current = await LocalScreenshotStore.get(clientId);
    if (!current) return;

    if (controller.signal.aborted || axios.isCancel(error)) {
      await this.requeueCancelledUpload(clientId, attempt);
      return;
    }

    const failure = getScreenshotUploadFailure(error);
    if (
      failure.code === SCREENSHOT_MISSING_FILE_CODE &&
      this.missingFileHandler
    ) {
      logger.warn("Screenshot file was missing at upload time", { clientId });
      if (await this.missingFileHandler(clientId)) {
        ScreenshotTelemetry.record("upload", "failed", failure.code);
        return;
      }
    }
    if (failure.code === SCREENSHOT_FEATURE_DISABLED_CODE) {
      this.uploadsDisabledThisRun = true;
    }
    const alreadyUploaded =
      failure.action === "already_uploaded"
        ? getAlreadyUploadedScreenshot(error)
        : null;
    if (alreadyUploaded) {
      await this.markUploaded(clientId, alreadyUploaded);
      ScreenshotTelemetry.record("upload", "uploaded", "already_uploaded");
      return;
    }

    const step = planScreenshotUploadRecovery(
      failure,
      {
        uploadAttempts: attempt,
        gameWaits: current.uploadGameWaits ?? 0,
        moderationWaits: current.uploadModerationWaits ?? 0,
        capacityWaits: current.uploadCapacityWaits ?? 0,
        rateLimitWaits: current.uploadRateLimitWaits ?? 0,
      },
      quality
    );
    logger.warn("Screenshot upload failed", {
      clientId,
      code: failure.code,
      action: failure.action,
      step: step.kind,
    });
    await this.applyRecoveryStep(clientId, failure, step, attempt);
  }

  private async markFailed(
    clientId: string,
    failure: ScreenshotUploadFailure,
    expectedState: LocalScreenshot["state"]
  ) {
    const failed = await this.updateInState(clientId, expectedState, () => ({
      state: "failed",
      uploadProgress: null,
      lastError: failure.code,
      nextUploadAttemptAt: null,
      pendingCompleteScreenshotId: null,
    }));
    if (!failed) return;
    emitProgress({ clientId, state: "failed", progress: null });
    ScreenshotTelemetry.record("upload", "failed", failure.code);
  }

  private async scheduleNextRun() {
    const ownerId = getCurrentOwnerId();
    if (!ownerId) return;

    const now = Date.now();
    const screenshots = await LocalScreenshotStore.list();
    const owned = screenshots.filter(
      (screenshot) => screenshot.ownerId === ownerId
    );
    const nextRetryAt = owned
      .filter((screenshot) => screenshot.state === "queued")
      .map((screenshot) => screenshot.nextUploadAttemptAt ?? now)
      .toSorted((a, b) => a - b)[0];
    if (nextRetryAt === undefined) return;

    const delay = Math.min(
      Math.max(MIN_SCHEDULED_RUN_DELAY_MS, nextRetryAt - now),
      MAX_TIMER_DELAY_MS
    );
    this.retryTimer = setTimeout(() => void this.trigger(), delay);
    this.retryTimer.unref?.();
  }
}

export const screenshotUploadWorker = new ScreenshotUploadWorker();
