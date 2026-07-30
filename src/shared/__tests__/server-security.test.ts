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
    "INSTALL_RATE_LIMITED",
    "INSTALL_DAILY_LIMITED",
    "SERVICE_DAILY_LIMITED",
  ] as const)(
    "returns a stable 429 with Retry-After for %s",
    async (code) => {
      const harness = securityHarness({
        quotaDecision: {
          allowed: false,
          code,
          retryAfterSeconds: 73,
        },
      });

      const response = await harness.postValidV2();

      await expectStablePublicError(response, 429, code);
      expect(response.headers.get("retry-after")).toBe("73");
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
      "QUOTA_SERVICE_UNAVAILABLE",
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
      "QUOTA_SERVICE_UNAVAILABLE",
    );
    expect(harness.extraction.extract).not.toHaveBeenCalled();
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
