import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type PrivacySafeLogger } from "../../../server";
import { createGeminiExtractionService } from "../../extraction/extraction-service";
import type { QuotaDecision, QuotaScope } from "../../quota/contracts";
import { AppCheckRequestError } from "../../security/app-check";
import { InstallationIdentifierError } from "../../security/installation-id";
import {
  geminiResponseSchema,
  GEMINI_EXTRACTION_PROMPT,
  validateGeminiExtraction,
} from "../gemini-schema";
import { createPublicHttpError } from "../http-error";

const VALID_INSTALLATION_ID = "e8b18b25-64a6-4af9-b31f-9b0b6d3c3d4e";
const INSTALLATION_HASH = "a".repeat(64);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type LogEntry = {
  level: "info" | "warn" | "error";
  event: string;
  metadata: Record<string, boolean | number | string | undefined>;
};

type HarnessOptions = {
  tokenOutcome?:
    | "invalid"
    | "replayed"
    | "forbidden"
    | "unavailable";
  quotaDecision?: QuotaDecision;
  quotaError?: unknown;
  extractionError?: unknown;
  logger?: PrivacySafeLogger;
};

const openServers: ReturnType<ReturnType<typeof createApp>["listen"]>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
  vi.restoreAllMocks();
});

describe("protected extraction routes", () => {
  it.each([
    [undefined, 401, "APP_CHECK_REQUIRED"],
    ["invalid", 401, "APP_CHECK_INVALID"],
    ["replayed", 401, "APP_CHECK_REPLAYED"],
    ["forbidden", 403, "APP_ID_FORBIDDEN"],
    ["unavailable", 503, "SECURITY_SERVICE_UNAVAILABLE"],
  ] as const)(
    "rejects %s App Check before hashing, quota, and Gemini",
    async (token, status, code) => {
      const harness = securityHarness({ tokenOutcome: token });
      const response = await harness.postV2({
        token,
        installationId: VALID_INSTALLATION_ID,
        image: imageForm("image/png", 16),
      });

      await expectStablePublicError(response, status, code);
      expect(harness.hashInstallationId).not.toHaveBeenCalled();
      expect(harness.quota.consume).not.toHaveBeenCalled();
      expect(harness.extraction.extract).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid installation identifier before image, quota, and Gemini", async () => {
    const harness = securityHarness();
    harness.hashInstallationId.mockImplementationOnce(() => {
      harness.callOrder.push("hash");
      throw new InstallationIdentifierError("INSTALLATION_ID_INVALID");
    });

    const response = await harness.postV2({
      token: "valid",
      installationId: "raw-installation-id-secret",
      image: imageForm("image/png", 16),
    });

    await expectStablePublicError(response, 400, "INSTALLATION_ID_INVALID");
    expect(harness.callOrder).toEqual(["app-check", "hash"]);
    expect(harness.quota.consume).not.toHaveBeenCalled();
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("validates a v2 image before consuming quota", async () => {
    const harness = securityHarness();
    const response = await harness.postV2({
      token: "valid",
      installationId: VALID_INSTALLATION_ID,
      image: imageForm("text/plain", 16),
    });

    await expectStablePublicError(response, 415, "UNSUPPORTED_IMAGE_TYPE");
    expect(harness.callOrder).toEqual(["app-check", "hash"]);
    expect(harness.quota.consume).not.toHaveBeenCalled();
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("uses 413 for an oversized v2 image before quota", async () => {
    const harness = securityHarness();
    const response = await harness.postV2({
      token: "valid",
      installationId: VALID_INSTALLATION_ID,
      image: imageForm("image/png", MAX_IMAGE_BYTES + 1),
    });

    await expectStablePublicError(response, 413, "IMAGE_TOO_LARGE");
    expect(harness.quota.consume).not.toHaveBeenCalled();
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("uses no-store for a missing v2 image before quota", async () => {
    const harness = securityHarness();
    const response = await requestOnce(
      harness.app,
      "/api/v2/extract",
      {
        token: "valid",
        installationId: VALID_INSTALLATION_ID,
      },
    );

    await expectStablePublicError(response, 400, "IMAGE_REQUIRED");
    expect(harness.quota.consume).not.toHaveBeenCalled();
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("reserves quota before Gemini and keeps it on upstream failure", async () => {
    const harness = securityHarness({
      extractionError: new Error("SECRET_UPSTREAM_FAILURE"),
    });
    const response = await harness.postValidV2();

    await expectStablePublicError(response, 502, "AI_EXTRACTION_FAILED");
    expect(harness.callOrder).toEqual([
      "app-check",
      "hash",
      "quota",
      "gemini",
    ]);
    expect(harness.quota.consume).toHaveBeenCalledTimes(1);
    expect(harness.extraction.extract).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["INSTALL_RATE_LIMITED", 59],
    ["INSTALL_DAILY_LIMITED", 73],
    ["SERVICE_DAILY_LIMITED", 73],
  ] as const)(
    "returns a stable 429 with Retry-After for %s",
    async (code, retryAfterSeconds) => {
      const harness = securityHarness({
        quotaDecision: {
          allowed: false,
          code,
          retryAfterSeconds,
        },
      });

      const response = await harness.postValidV2();

      await expectStablePublicError(response, 429, code);
      expect(response.headers.get("retry-after")).toBe(
        String(retryAfterSeconds),
      );
      expect(harness.extraction.extract).not.toHaveBeenCalled();
    },
  );

  it("maps a quota dependency failure to a stable 503 before Gemini", async () => {
    const harness = securityHarness({
      quotaError: new Error("SECRET_FIRESTORE_PROJECT_AND_PATH"),
    });

    const response = await harness.postValidV2();

    const body = await expectStablePublicError(
      response,
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );
    expect(JSON.stringify(body)).not.toContain(
      "SECRET_FIRESTORE_PROJECT_AND_PATH",
    );
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("maps a malformed quota decision to a stable 503 before Gemini", async () => {
    const malformed = new Proxy(
      {},
      {
        get() {
          throw new Error("SECRET_QUOTA_GETTER");
        },
      },
    ) as QuotaDecision;
    const harness = securityHarness({ quotaDecision: malformed });

    const response = await harness.postValidV2();

    await expectStablePublicError(
      response,
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("snapshots a denied quota decision before a proxy can flip it to allowed", async () => {
    let allowedReads = 0;
    const decision = new Proxy(
      {
        code: "INSTALL_RATE_LIMITED",
        retryAfterSeconds: 11,
      },
      {
        get(target, property, receiver) {
          if (property === "allowed") {
            allowedReads += 1;
            return allowedReads <= 2 ? false : true;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as QuotaDecision;
    const harness = securityHarness({ quotaDecision: decision });

    const response = await harness.postValidV2();

    await expectStablePublicError(
      response,
      429,
      "INSTALL_RATE_LIMITED",
    );
    expect(response.headers.get("retry-after")).toBe("11");
    expect(allowedReads).toBe(1);
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("snapshots an allowed quota decision without rereading a throwing proxy", async () => {
    let allowedReads = 0;
    const decision = new Proxy(
      { crossedThreshold: undefined },
      {
        get(target, property, receiver) {
          if (property === "allowed") {
            allowedReads += 1;
            if (allowedReads > 1) {
              throw new Error("SECRET_ALLOWED_REREAD");
            }
            return true;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as QuotaDecision;
    const harness = securityHarness({ quotaDecision: decision });

    const response = await harness.postValidV2();

    expect(response.status).toBe(200);
    expect(allowedReads).toBe(1);
    expect(harness.extraction.extract).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an allowed quota threshold getter is hostile", async () => {
    const decision = new Proxy(
      { allowed: true },
      {
        get(target, property, receiver) {
          if (property === "crossedThreshold") {
            throw new Error("SECRET_THRESHOLD_GETTER");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as QuotaDecision;
    const harness = securityHarness({ quotaDecision: decision });

    const response = await harness.postValidV2();

    await expectStablePublicError(
      response,
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("snapshots Retry-After before a proxy can mutate it", async () => {
    let retryReads = 0;
    const decision = new Proxy(
      {
        allowed: false,
        code: "INSTALL_RATE_LIMITED",
      },
      {
        get(target, property, receiver) {
          if (property === "retryAfterSeconds") {
            retryReads += 1;
            if (retryReads > 1) {
              throw new Error("SECRET_RETRY_REREAD");
            }
            return 17;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as QuotaDecision;
    const harness = securityHarness({ quotaDecision: decision });

    const response = await harness.postValidV2();

    await expectStablePublicError(
      response,
      429,
      "INSTALL_RATE_LIMITED",
    );
    expect(response.headers.get("retry-after")).toBe("17");
    expect(retryReads).toBe(1);
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it.each([
    ["INSTALL_RATE_LIMITED", 61],
    ["INSTALL_DAILY_LIMITED", 86_401],
    ["SERVICE_DAILY_LIMITED", 86_401],
  ] as const)(
    "fails closed for out-of-bounds %s Retry-After",
    async (code, retryAfterSeconds) => {
      const harness = securityHarness({
        quotaDecision: {
          allowed: false,
          code,
          retryAfterSeconds,
        },
      });

      const response = await harness.postValidV2();

      await expectStablePublicError(
        response,
        503,
        "SECURITY_SERVICE_UNAVAILABLE",
      );
      expect(response.headers.get("retry-after")).toBeNull();
      expect(harness.extraction.extract).not.toHaveBeenCalled();
    },
  );

  it("establishes one request identity before App Check and reuses it for rejection logs", async () => {
    const requestId = "00000000-0000-4000-8000-000000000005";
    const { logger, entries } = captureLogger();
    const harness = securityHarness({
      logger,
      tokenOutcome: "invalid",
    });
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockImplementation(() => {
        harness.callOrder.push("request-id");
        return requestId;
      });

    const response = await harness.postV2({
      token: "invalid",
      installationId: VALID_INSTALLATION_ID,
      image: imageForm("image/png", 16),
    });

    await expectStablePublicError(response, 401, "APP_CHECK_INVALID");
    expect(harness.callOrder).toEqual(["request-id", "app-check"]);
    expect(randomUuid).toHaveBeenCalledTimes(1);
    expect(
      entries.filter((entry) => entry.event === "extract_rejected"),
    ).toEqual([
      {
        level: "warn",
        event: "extract_rejected",
        metadata: {
          request_id: requestId,
          route_category: "v2",
          status: 401,
          code: "APP_CHECK_INVALID",
        },
      },
    ]);
  });

  it("establishes request identity before legacy image validation", async () => {
    const requestId = "00000000-0000-4000-8000-000000000006";
    const harness = securityHarness();
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockImplementation(() => {
        harness.callOrder.push("request-id");
        return requestId;
      });

    const response = await harness.postLegacy(
      imageForm("text/plain", 16),
    );

    await expectStablePublicError(
      response,
      400,
      "UNSUPPORTED_IMAGE_TYPE",
    );
    expect(harness.callOrder).toEqual(["request-id"]);
    expect(randomUuid).toHaveBeenCalledTimes(1);
  });

  it("reuses the pre-security request identity through quota and extraction logs", async () => {
    const requestId = "00000000-0000-4000-8000-000000000007";
    const { logger, entries } = captureLogger();
    const harness = securityHarness({ logger });
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockImplementation(() => {
        harness.callOrder.push("request-id");
        return requestId;
      });

    const response = await harness.postValidV2();

    expect(response.status).toBe(200);
    expect(harness.callOrder).toEqual([
      "request-id",
      "app-check",
      "hash",
      "quota",
      "gemini",
    ]);
    expect(randomUuid).toHaveBeenCalledTimes(1);
    expect(
      entries
        .filter(
          (entry) =>
            entry.event === "extract_request" ||
            entry.event === "extract_success",
        )
        .map((entry) => entry.metadata.request_id),
    ).toEqual([requestId, requestId]);
  });

  it("classifies trailing-slash v2 App Check rejection from route locals", async () => {
    const { logger, entries } = captureLogger();
    const harness = securityHarness({
      logger,
      tokenOutcome: "invalid",
    });

    const response = await requestOnce(
      harness.app,
      "/api/v2/extract/",
      {
        token: "invalid",
        installationId: VALID_INSTALLATION_ID,
        body: imageForm("image/png", 16),
      },
    );

    await expectStablePublicError(response, 401, "APP_CHECK_INVALID");
    expect(
      entries.filter((entry) => entry.event === "extract_rejected"),
    ).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          route_category: "v2",
          status: 401,
          code: "APP_CHECK_INVALID",
        }),
      }),
    ]);
  });

  it("keeps trailing-slash upload limits route-specific", async () => {
    const harness = securityHarness();

    const v2 = await requestOnce(
      harness.app,
      "/api/v2/extract/",
      {
        token: "valid",
        installationId: VALID_INSTALLATION_ID,
        body: imageForm("image/png", MAX_IMAGE_BYTES + 1),
      },
    );
    await expectStablePublicError(v2, 413, "IMAGE_TOO_LARGE");

    const legacy = await requestOnce(
      harness.app,
      "/api/extract/",
      {
        body: imageForm("image/png", MAX_IMAGE_BYTES + 1),
      },
    );
    await expectStablePublicError(legacy, 400, "IMAGE_TOO_LARGE");
  });

  it("returns the same validated success schema from v1 and v2", async () => {
    const harness = securityHarness();

    const [v1, v2] = await Promise.all([
      harness.postLegacy(imageForm("image/png", 16)),
      harness.postValidV2(),
    ]);

    expect(v1.status).toBe(200);
    expect(v2.status).toBe(200);
    expect(v1.headers.get("cache-control")).toBe("no-store");
    expect(v2.headers.get("cache-control")).toBe("no-store");
    expect(await v1.json()).toEqual(await v2.json());
    expect(harness.quota.consume).toHaveBeenCalledWith(
      { kind: "legacy" },
      new Date("2026-07-31T01:00:00Z"),
    );
    expect(harness.quota.consume).toHaveBeenCalledWith(
      { kind: "v2", installationHash: INSTALLATION_HASH },
      new Date("2026-07-31T01:00:00Z"),
    );
  });

  it("keeps legacy image validation statuses at 400", async () => {
    const harness = securityHarness();

    const missing = await harness.postLegacy();
    await expectStablePublicError(missing, 400, "IMAGE_REQUIRED");

    const invalid = await harness.postLegacy(imageForm("text/plain", 16));
    await expectStablePublicError(invalid, 400, "UNSUPPORTED_IMAGE_TYPE");

    const oversized = await harness.postLegacy(
      imageForm("image/png", MAX_IMAGE_BYTES + 1),
    );
    await expectStablePublicError(oversized, 400, "IMAGE_TOO_LARGE");

    expect(harness.quota.consume).not.toHaveBeenCalled();
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("caps legacy requests before Gemini", async () => {
    const harness = securityHarness({
      quotaDecision: {
        allowed: false,
        code: "SERVICE_DAILY_LIMITED",
        retryAfterSeconds: 101,
      },
    });

    const response = await harness.postLegacy(imageForm("image/png", 16));

    await expectStablePublicError(response, 429, "SERVICE_DAILY_LIMITED");
    expect(response.headers.get("retry-after")).toBe("101");
    expect(harness.quota.consume).toHaveBeenCalledWith(
      { kind: "legacy" },
      new Date("2026-07-31T01:00:00Z"),
    );
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it.each([70, 90, 100] as const)(
    "logs threshold %i exactly once with bounded metadata",
    async (threshold) => {
      const { logger, entries } = captureLogger();
      const harness = securityHarness({
        logger,
        quotaDecision: { allowed: true, crossedThreshold: threshold },
      });

      const response = await harness.postValidV2();
      expect(response.status).toBe(200);

      const events = entries.filter(
        (entry) => entry.event === "quota_threshold",
      );
      expect(events).toEqual([
        {
          level: "warn",
          event: "quota_threshold",
          metadata: {
            route_category: "v2",
            threshold_percent: threshold,
          },
        },
      ]);
    },
  );

  it("does not log a threshold for an ordinary allowed request", async () => {
    const { logger, entries } = captureLogger();
    const harness = securityHarness({ logger });

    const response = await harness.postValidV2();

    expect(response.status).toBe(200);
    expect(
      entries.filter((entry) => entry.event === "quota_threshold"),
    ).toEqual([]);
  });

  it("does not log a threshold for a denied request carrying hostile extra data", async () => {
    const { logger, entries } = captureLogger();
    const harness = securityHarness({
      logger,
      quotaDecision: {
        allowed: false,
        code: "SERVICE_DAILY_LIMITED",
        retryAfterSeconds: 7,
        crossedThreshold: 100,
      } as QuotaDecision,
    });

    const response = await harness.postValidV2();

    expect(response.status).toBe(429);
    expect(
      entries.filter((entry) => entry.event === "quota_threshold"),
    ).toEqual([]);
  });

  it("logs no token, UUID, hash, image, extracted text, or raw dependency details", async () => {
    const { logger, entries } = captureLogger();
    const secretToken = "token-secret-sentinel";
    const extracted = validExtractionFixture("extracted-secret-sentinel");
    const harness = securityHarness({ logger });
    harness.extraction.extract.mockResolvedValueOnce(extracted);

    const response = await harness.postV2({
      token: secretToken,
      installationId: VALID_INSTALLATION_ID,
      image: imageForm(
        "image/png",
        16,
        "image-buffer-secret-sentinel",
      ),
    });

    expect(response.status).toBe(200);
    const logText = JSON.stringify(entries);
    for (const secret of [
      secretToken,
      VALID_INSTALLATION_ID,
      INSTALLATION_HASH,
      "image-buffer-secret-sentinel",
      "extracted-secret-sentinel",
      "calendar_event",
      "summary",
      "amount",
    ]) {
      expect(logText).not.toContain(secret);
    }
  });

  it("sanitizes hostile extraction error metadata in logs", async () => {
    const { logger, entries } = captureLogger();
    const secret = "raw-dependency-secret-sentinel";
    const hostileError = Object.assign(new Error(secret), {
      name: secret,
      code: secret,
      status: secret,
    });
    const harness = securityHarness({
      logger,
      extractionError: hostileError,
    });

    const response = await harness.postValidV2();

    await expectStablePublicError(response, 502, "AI_EXTRACTION_FAILED");
    expect(JSON.stringify(entries)).not.toContain(secret);
  });

  it("does not trust mutated fields on a genuine public error", async () => {
    const secret = "GENUINE_PUBLIC_ERROR_SECRET";
    const error = createPublicHttpError("AI_EMPTY_RESPONSE");
    expect(Reflect.set(error, "statusCode", 599)).toBe(false);
    expect(Reflect.set(error, "code", secret)).toBe(false);
    expect(Reflect.set(error, "publicMessage", secret)).toBe(false);
    const { logger, entries } = captureLogger();
    const harness = securityHarness({
      logger,
      extractionError: error,
    });

    const response = await harness.postValidV2();

    await expectStablePublicError(response, 502, "AI_EMPTY_RESPONSE");
    expect(JSON.stringify(entries)).not.toContain(secret);
  });

  it("rejects a stateful public-error proxy without leaking its fields", async () => {
    const secret = "STATEFUL_PUBLIC_ERROR_SECRET";
    const genuine = createPublicHttpError("AI_EMPTY_RESPONSE");
    const error = new Proxy(genuine, {
      get(target, property, receiver) {
        if (
          property === "statusCode" ||
          property === "code" ||
          property === "publicMessage"
        ) {
          return property === "statusCode" ? 599 : secret;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const { logger, entries } = captureLogger();
    const harness = securityHarness({
      logger,
      extractionError: error,
    });

    const response = await harness.postValidV2();

    await expectStablePublicError(
      response,
      502,
      "AI_EXTRACTION_FAILED",
    );
    expect(JSON.stringify(entries)).not.toContain(secret);
  });

  it("rejects a revoked public-error proxy without changing the stable response", async () => {
    const genuine = createPublicHttpError("AI_EMPTY_RESPONSE");
    const revocable = Proxy.revocable(genuine, {});
    revocable.revoke();
    const harness = securityHarness({
      extractionError: revocable.proxy,
    });

    const response = await harness.postValidV2();

    await expectStablePublicError(
      response,
      502,
      "AI_EXTRACTION_FAILED",
    );
  });

  it("ignores a throwing logger during successful extraction", async () => {
    const harness = securityHarness({
      logger: throwingLogger("SUCCESS_LOGGER_SECRET"),
    });

    const response = await harness.postValidV2();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(await response.json()).toEqual(validExtractionFixture());
  });

  it("ignores a throwing logger during App Check rejection", async () => {
    const secret = "APP_CHECK_LOGGER_SECRET";
    const harness = securityHarness({
      logger: throwingLogger(secret),
      tokenOutcome: "invalid",
    });

    const response = await harness.postV2({
      token: "invalid",
      installationId: VALID_INSTALLATION_ID,
      image: imageForm("image/png", 16),
    });

    const body = await expectStablePublicError(
      response,
      401,
      "APP_CHECK_INVALID",
    );
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(harness.extraction.extract).not.toHaveBeenCalled();
  });

  it("ignores a throwing logger at a quota threshold", async () => {
    const harness = securityHarness({
      logger: invocationThrowingLogger("THRESHOLD_LOGGER_SECRET"),
      quotaDecision: { allowed: true, crossedThreshold: 90 },
    });

    const response = await harness.postValidV2();

    expect(response.status).toBe(200);
    expect(harness.extraction.extract).toHaveBeenCalledTimes(1);
  });

  it("ignores a throwing logger during extraction failure", async () => {
    const secret = "FAILURE_LOGGER_SECRET";
    const harness = securityHarness({
      logger: invocationThrowingLogger(secret),
      extractionError: new Error("UPSTREAM_SECRET"),
    });

    const response = await harness.postValidV2();

    const body = await expectStablePublicError(
      response,
      502,
      "AI_EXTRACTION_FAILED",
    );
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("ignores a revoked logger proxy", async () => {
    const revocable = Proxy.revocable(
      {
        info() {},
        warn() {},
        error() {},
      },
      {},
    );
    revocable.revoke();
    const harness = securityHarness({
      logger: revocable.proxy as PrivacySafeLogger,
    });

    const response = await harness.postValidV2();

    expect(response.status).toBe(200);
    expect(harness.extraction.extract).toHaveBeenCalledTimes(1);
  });

  it("absorbs async logger rejection during successful extraction", async () => {
    const secret = "ASYNC_SUCCESS_LOGGER_SECRET";
    const harness = securityHarness({
      logger: asyncRejectingLogger(secret),
    });

    await expectNoUnhandledRejections(async () => {
      const response = await harness.postValidV2();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(validExtractionFixture());
    });
  });

  it("absorbs async logger rejection at a quota threshold", async () => {
    const harness = securityHarness({
      logger: asyncRejectingLogger("ASYNC_THRESHOLD_LOGGER_SECRET"),
      quotaDecision: { allowed: true, crossedThreshold: 90 },
    });

    await expectNoUnhandledRejections(async () => {
      const response = await harness.postValidV2();
      expect(response.status).toBe(200);
      expect(harness.extraction.extract).toHaveBeenCalledTimes(1);
    });
  });

  it("absorbs async logger rejection during App Check rejection", async () => {
    const secret = "ASYNC_APP_CHECK_LOGGER_SECRET";
    const harness = securityHarness({
      logger: asyncRejectingLogger(secret),
      tokenOutcome: "invalid",
    });

    await expectNoUnhandledRejections(async () => {
      const response = await harness.postV2({
        token: "invalid",
        installationId: VALID_INSTALLATION_ID,
        image: imageForm("image/png", 16),
      });
      const body = await expectStablePublicError(
        response,
        401,
        "APP_CHECK_INVALID",
      );
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(harness.extraction.extract).not.toHaveBeenCalled();
    });
  });

  it("absorbs async logger rejection during extraction failure", async () => {
    const secret = "ASYNC_FAILURE_LOGGER_SECRET";
    const harness = securityHarness({
      logger: asyncRejectingLogger(secret),
      extractionError: new Error("UPSTREAM_FAILURE"),
    });

    await expectNoUnhandledRejections(async () => {
      const response = await harness.postValidV2();
      const body = await expectStablePublicError(
        response,
        502,
        "AI_EXTRACTION_FAILED",
      );
      expect(JSON.stringify(body)).not.toContain(secret);
    });
  });

  it("ignores a logger result with a throwing then getter", async () => {
    let thenReads = 0;
    const secret = "HOSTILE_THEN_GETTER_SECRET";
    const hostileThenable = {
      get then() {
        thenReads += 1;
        throw new Error(secret);
      },
    };
    const logger: PrivacySafeLogger = {
      info: () => hostileThenable,
      warn: () => hostileThenable,
      error: () => hostileThenable,
    };
    const harness = securityHarness({ logger });

    const response = await harness.postValidV2();

    expect(response.status).toBe(200);
    expect(thenReads).toBeGreaterThan(0);
    expect(harness.extraction.extract).toHaveBeenCalledTimes(1);
  });

  it("ignores a revoked logger-result thenable", async () => {
    const revocable = Proxy.revocable(
      {
        then() {},
      },
      {},
    );
    revocable.revoke();
    const logger: PrivacySafeLogger = {
      info: () => revocable.proxy,
      warn: () => revocable.proxy,
      error: () => revocable.proxy,
    };
    const harness = securityHarness({ logger });

    const response = await harness.postValidV2();

    expect(response.status).toBe(200);
    expect(harness.extraction.extract).toHaveBeenCalledTimes(1);
  });

  it("fails closed when extraction security dependencies are absent", async () => {
    const app = createApp({ env: testEnv() });

    const response = await requestOnce(app, "/api/extract", {
      body: imageForm("image/png", 16),
    });

    await expectStablePublicError(
      response,
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );
  });
});

function securityHarness(options: HarnessOptions = {}) {
  const callOrder: string[] = [];
  const appCheckVerifier = {
    verify: vi.fn(async (token: string | undefined) => {
      callOrder.push("app-check");
      if (!token) {
        throw new AppCheckRequestError(401, "APP_CHECK_REQUIRED");
      }
      const outcome = options.tokenOutcome ?? token;
      if (outcome === "invalid") {
        throw new AppCheckRequestError(401, "APP_CHECK_INVALID");
      }
      if (outcome === "replayed") {
        throw new AppCheckRequestError(401, "APP_CHECK_REPLAYED");
      }
      if (outcome === "forbidden") {
        throw new AppCheckRequestError(403, "APP_ID_FORBIDDEN");
      }
      if (outcome === "unavailable") {
        throw new AppCheckRequestError(
          503,
          "SECURITY_SERVICE_UNAVAILABLE",
        );
      }
      return { appId: "1:1234567890:ios:security-test" };
    }),
  };
  const hashInstallationId = vi.fn((value: string) => {
    callOrder.push("hash");
    expect(value).toBe(VALID_INSTALLATION_ID);
    return INSTALLATION_HASH;
  });
  const quota = {
    consume: vi.fn(async (_scope: QuotaScope, _now: Date) => {
      callOrder.push("quota");
      if (options.quotaError !== undefined) {
        throw options.quotaError;
      }
      return options.quotaDecision ?? ({ allowed: true } as const);
    }),
  };
  const extraction = {
    extract: vi.fn(async () => {
      callOrder.push("gemini");
      if (options.extractionError !== undefined) {
        throw options.extractionError;
      }
      return validExtractionFixture();
    }),
  };
  const app = createApp({
    env: testEnv({ GEMINI_API_KEY: "unused-by-injected-service" }),
    logger: options.logger,
    extractionService: extraction,
    security: {
      appCheckVerifier,
      quotaStore: quota,
      hashInstallationId,
      now: () => new Date("2026-07-31T01:00:00Z"),
    },
  });

  return {
    app,
    callOrder,
    quota,
    extraction,
    hashInstallationId,
    postV2: (input: {
      token?: string;
      installationId: string;
      image: FormData;
    }) =>
      requestOnce(app, "/api/v2/extract", {
        token: input.token,
        installationId: input.installationId,
        body: input.image,
      }),
    postValidV2: () =>
      requestOnce(app, "/api/v2/extract", {
        token: "valid",
        installationId: VALID_INSTALLATION_ID,
        body: imageForm("image/png", 16),
      }),
    postLegacy: (body?: FormData) =>
      requestOnce(app, "/api/extract", { body }),
  };
}

describe("Gemini extraction service contract", () => {
  it("preserves the model, prompt, image encoding, and response schema", async () => {
    const createClient = vi.fn(() => ({
      models: {
        generateContent: vi.fn(async (request: unknown) => {
          expect(request).toEqual({
            model: "gemini-contract-model",
            contents: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: Buffer.from("fixture").toString("base64"),
                },
              },
              {
                text: GEMINI_EXTRACTION_PROMPT,
              },
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: geminiResponseSchema,
            },
          });
          return { text: JSON.stringify(validExtractionFixture()) };
        }),
      },
    }));
    const service = createGeminiExtractionService({
      apiKey: "test-api-key",
      model: "gemini-contract-model",
      createClient,
    });

    const result = await service.extract({
      buffer: Buffer.from("fixture"),
      mimeType: "image/png",
    });

    expect(createClient).toHaveBeenCalledExactlyOnceWith("test-api-key");
    expect(result).toEqual(validExtractionFixture());
  });
});

async function requestOnce(
  app: ReturnType<typeof createApp>,
  path: string,
  input: { token?: string; installationId?: string; body?: FormData },
) {
  const server = app.listen(0);
  openServers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "POST",
    headers: {
      ...(input.token ? { "X-Firebase-AppCheck": input.token } : {}),
      ...(input.installationId
        ? { "X-LifeSnap-Install-ID": input.installationId }
        : {}),
    },
    body: input.body,
  });
}

function validExtractionFixture(title = "Synthetic event") {
  return validateGeminiExtraction({
    route: "calendar_action",
    document_type: "notice",
    task_type: "event",
    title,
    due_date: "",
    start_datetime: "2026-10-25T14:00",
    end_datetime: "2026-10-25T15:00",
    amount: 0,
    issuer: "",
    location: "",
    summary: "Synthetic summary",
    confidence: 0.9,
    risk_flags: [],
    evidence: "",
    calendar_event: {
      title,
      start: "2026-10-25T14:00",
      end: "2026-10-25T15:00",
      description: "Synthetic summary",
      location: "",
    },
  });
}

function imageForm(
  mimeType: string,
  sizeBytes: number,
  contents?: string,
) {
  const form = new FormData();
  form.append(
    "image",
    new Blob(
      [
        contents === undefined
          ? Buffer.alloc(sizeBytes)
          : Buffer.from(contents.padEnd(sizeBytes, "_")),
      ],
      { type: mimeType },
    ),
    "fixture",
  );
  return form;
}

function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return {
    NODE_ENV: "test",
    MOCK_MODE: "false",
    GEMINI_API_KEY: "",
    ...overrides,
  };
}

async function expectStablePublicError(
  response: Response,
  status: number,
  code: string,
) {
  const body = (await response.json()) as {
    code?: string;
    error?: string;
    details?: string;
  };
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body.code).toBe(code);
  expect(body.error).toBeTruthy();
  expect(body.details).toBeUndefined();
  expect(JSON.stringify(body)).not.toMatch(
    /GEMINI_API_KEY|X-Firebase-AppCheck|stack|Error:/,
  );
  return body;
}

function captureLogger() {
  const entries: LogEntry[] = [];
  const logger: PrivacySafeLogger = {
    info: (event, metadata) =>
      entries.push({ level: "info", event, metadata }),
    warn: (event, metadata) =>
      entries.push({ level: "warn", event, metadata }),
    error: (event, metadata) =>
      entries.push({ level: "error", event, metadata }),
  };
  return { logger, entries };
}

function throwingLogger(secret: string): PrivacySafeLogger {
  return new Proxy({} as PrivacySafeLogger, {
    get() {
      throw new Error(secret);
    },
  });
}

function invocationThrowingLogger(
  secret: string,
): PrivacySafeLogger {
  const fail = () => {
    throw new Error(secret);
  };
  return {
    info: fail,
    warn: fail,
    error: fail,
  };
}

function asyncRejectingLogger(secret: string): PrivacySafeLogger {
  const fail = async () => {
    throw new Error(secret);
  };
  return {
    info: fail,
    warn: fail,
    error: fail,
  };
}

async function expectNoUnhandledRejections(
  run: () => Promise<void>,
) {
  const reasons: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    await run();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reasons).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
}
