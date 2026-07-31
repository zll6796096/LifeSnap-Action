import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type PrivacySafeLogger } from "../../../server";
import { createGeminiExtractionService } from "../../extraction/extraction-service";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type LogEntry = {
  level: "info" | "warn" | "error";
  event: string;
  metadata: Record<string, boolean | number | string | undefined>;
};

const openServers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("privacy and extraction API behavior", () => {
  it("serves the privacy policy with the current brand and user actions", async () => {
    await withServer(createApp({ env: testEnv() }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/privacy`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("よていスナップ");
      expect(body).toContain("紙の案内を予定に変える");
      expect(body).toContain("「カメラで撮影」");
      expect(body).toContain("「写真から選ぶ」");
      expect(body).toContain("「同意して続ける」");
      expect(body).toContain("「同意してもう一度試す」");
      expect(body).toContain("「キャンセル」");
      expect(body).toContain("「カレンダーの使用を許可」");
      expect(body).toContain("「カレンダーに追加」");
      expect(body).toContain("「追加する」");

      const permissionAction = body.indexOf("「カレンダーの使用を許可」");
      const addAction = body.indexOf("「カレンダーに追加」");
      const confirmAction = body.indexOf("「追加する」");
      expect(permissionAction).toBeLessThan(addAction);
      expect(addAction).toBeLessThan(confirmAction);

      expect(body).not.toMatch(/\bLifeSnap(?: Action)?\b/);
      expect(body).not.toContain("同意してAI解析を開始");
      expect(body).not.toContain("同意して再解析");
    });
  });

  it("serves the privacy policy with required Gemini Paid Service disclosures", async () => {
    await withServer(createApp({ env: testEnv() }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/privacy`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("Google Gemini");
      expect(body).toContain("Google Cloud Run");
      expect(body).toContain("Paid Service");
      expect(body).toContain("Google 製品の改善には使用しない");
      expect(body).toContain("限定された期間ログを処理");
      expect(body).toContain("永続保存しません");
      expect(body).toContain("HTTPS");
      expect(body).toContain("キャンセルした場合、画像は送信されず");
      expect(body).toContain("削除");
      expect(body).toContain("2026-08-01");
    });
  });

  it("discloses App Check integrity, installation quota, and retention boundaries", async () => {
    await withServer(createApp({ env: testEnv() }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/privacy`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("Firebase App Check（Apple App Attest）");
      expect(body).toContain("アプリの完全性");
      expect(body).toContain(
        "attestation / assertion オブジェクトが Apple と Firebase により処理",
      );
      expect(body).toContain("Keychain");
      expect(body).toContain("ランダムなインストール UUID");
      expect(body).toContain("リクエストヘッダーとしてバックエンドへ送られます");
      expect(body).toContain(
        "Firestore には HMAC ダイジェストとクォータのカウンターだけを保存します",
      );
      expect(body).toContain("元の UUID は Firestore に保存しません");
      expect(body).toContain("ユーザーにリンクされない識別子");
      expect(body).toContain("App Functionality と Fraud Prevention");
      expect(body).toContain("24 時間後に論理的に期限切れ");
      expect(body).toContain("クォータ記録は最長 30 日");
      expect(body).toContain("使用済みの App Check トークン");
      expect(body).toContain("Firebase が最長 30 日保持");
      expect(body).toContain("アップロード画像、Gemini の生レスポンス、抽出内容を永続保存しません");
    });
  });

  it("rejects missing, invalid, and oversized images without leaking details", async () => {
    await withServer(createApp({ env: testEnv(), security: testSecurity() }), async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/extract`, { method: "POST" });
      await expectStablePublicError(missing, 400, "IMAGE_REQUIRED");

      const invalid = await fetch(`${baseUrl}/api/extract`, {
        method: "POST",
        body: imageForm("text/plain", 16),
      });
      await expectStablePublicError(invalid, 400, "UNSUPPORTED_IMAGE_TYPE");

      const oversized = await fetch(`${baseUrl}/api/extract`, {
        method: "POST",
        body: imageForm("image/png", MAX_IMAGE_BYTES + 1),
      });
      await expectStablePublicError(oversized, 400, "IMAGE_TOO_LARGE");
    });
  });

  it("uses no-store for extract responses", async () => {
    await withServer(
      createApp({
        env: testEnv({ GEMINI_API_KEY: "test-key" }),
        security: testSecurity(),
        extractionService: createGeminiExtractionService({
          apiKey: "test-key",
          model: "gemini-2.5-flash",
          createClient: () => fakeGeminiClient(successGeminiText()),
        }),
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/extract`, {
          method: "POST",
          body: imageForm("image/png", 16),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
      },
    );
  });

  it("does not expose internal Gemini errors in production responses", async () => {
    await withServer(
      createApp({
        env: testEnv({ NODE_ENV: "production", GEMINI_API_KEY: "test-key" }),
        security: testSecurity(),
        extractionService: {
          extract: async () => {
            throw new Error("SECRET_INTERNAL_CONTEXT");
          },
        },
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/extract`, {
          method: "POST",
          body: imageForm("image/png", 16),
        });
        const body = await expectStablePublicError(response, 502, "AI_EXTRACTION_FAILED");

        expect(JSON.stringify(body)).not.toContain("SECRET_INTERNAL_CONTEXT");
      },
    );
  });

  it("does not log raw Gemini output or extracted document content", async () => {
    const { logger, entries } = captureLogger();
    const sentinel = "RAW_GEMINI_OUTPUT_SHOULD_NOT_BE_LOGGED";

    await withServer(
      createApp({
        env: testEnv({ GEMINI_API_KEY: "test-key" }),
        logger,
        security: testSecurity(),
        extractionService: createGeminiExtractionService({
          apiKey: "test-key",
          model: "gemini-2.5-flash",
          createClient: () => fakeGeminiClient(successGeminiText(sentinel)),
        }),
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/extract`, {
          method: "POST",
          body: imageForm("image/png", 16),
        });

        expect(response.status).toBe(200);
        const responseBody = (await response.json()) as { title?: string };
        expect(responseBody.title).toBe(sentinel);
      },
    );

    const logText = JSON.stringify(entries);
    expect(logText).not.toContain(sentinel);
    expect(logText).not.toContain("calendar_event");
    expect(logText).not.toContain("summary");
    expect(logText).not.toContain("amount");
    expect(entries.some((entry) => entry.event === "extract_success")).toBe(true);
  });

  it("keeps mock extraction schema-valid without an external Gemini call", async () => {
    await withServer(createApp({
      env: testEnv({ MOCK_MODE: "true" }),
      security: testSecurity(),
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/extract`, {
        method: "POST",
        body: imageForm("image/png", 16),
      });
      const body = (await response.json()) as {
        route?: string;
        calendar_event?: { title?: string };
      };

      expect(response.status).toBe(200);
      expect(body.route).toBe("calendar_action");
      expect(body.calendar_event?.title).toBeTruthy();
    });
  });
});

function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return {
    NODE_ENV: "test",
    MOCK_MODE: "false",
    GEMINI_API_KEY: "",
    ...overrides,
  };
}

function testSecurity() {
  return {
    appCheckVerifier: {
      verify: async () => ({ appId: "unused-by-legacy-route" }),
    },
    quotaStore: {
      consume: async () => ({ allowed: true as const }),
    },
    hashInstallationId: () => "a".repeat(64),
    now: () => new Date("2026-07-31T01:00:00Z"),
  };
}

async function withServer(app: ReturnType<typeof createApp>, run: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  openServers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  await run(`http://127.0.0.1:${address.port}`);
}

function imageForm(mimeType: string, sizeBytes: number) {
  const form = new FormData();
  form.append("image", new Blob([Buffer.alloc(sizeBytes)], { type: mimeType }), "fixture");
  return form;
}

async function expectStablePublicError(response: Response, expectedStatus: number, expectedCode: string) {
  const body = (await response.json()) as {
    code?: string;
    error?: string;
    details?: string;
  };

  expect(response.status).toBe(expectedStatus);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body.code).toBe(expectedCode);
  expect(body.error).toBeTruthy();
  expect(body.details).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("GEMINI_API_KEY");
  expect(JSON.stringify(body)).not.toContain("Error:");
  expect(JSON.stringify(body)).not.toContain("stack");

  return body;
}

function captureLogger() {
  const entries: LogEntry[] = [];
  const logger: PrivacySafeLogger = {
    info: (event, metadata) => entries.push({ level: "info", event, metadata }),
    warn: (event, metadata) => entries.push({ level: "warn", event, metadata }),
    error: (event, metadata) => entries.push({ level: "error", event, metadata }),
  };

  return { logger, entries };
}

function fakeGeminiClient(text: string) {
  return {
    models: {
      generateContent: async () => ({ text }),
    },
  };
}

function successGeminiText(title = "Synthetic event") {
  return JSON.stringify({
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
