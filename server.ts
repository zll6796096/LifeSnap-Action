import crypto from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import {
  createGeminiExtractionService,
  type ExtractionService,
  type GeminiClient,
  type ImageInput,
} from "./src/extraction/extraction-service";
import type {
  QuotaDecision,
  QuotaDeniedCode,
  QuotaStore,
} from "./src/quota/contracts";
import type { AppCheckRequestErrorCode } from "./src/security/app-check";
import { validateGeminiExtraction } from "./src/shared/gemini-schema";
import {
  isPublicHttpError,
  PublicHttpError,
} from "./src/shared/http-error";

dotenv.config({ quiet: true });

const PORT = parseInt(process.env.PORT || "8080", 10);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

type LogMetadata = Record<string, boolean | number | string | undefined>;

export type PrivacySafeLogger = {
  info: (event: string, metadata: LogMetadata) => void;
  warn: (event: string, metadata: LogMetadata) => void;
  error: (event: string, metadata: LogMetadata) => void;
};

type AppEnvironment = Pick<NodeJS.ProcessEnv, "NODE_ENV" | "MOCK_MODE" | "GEMINI_API_KEY">;

export type SecurityDependencies = {
  appCheckVerifier: {
    verify(token: string | undefined): Promise<{ appId: string }>;
  };
  quotaStore: QuotaStore;
  hashInstallationId(value: string): string;
  now(): Date;
};

export type CreateAppOptions = {
  env?: AppEnvironment;
  logger?: PrivacySafeLogger;
  extractionService?: ExtractionService;
  security?: SecurityDependencies;
};

const defaultLogger: PrivacySafeLogger = {
  info: (event, metadata) => console.log(JSON.stringify({ level: "info", event, ...metadata })),
  warn: (event, metadata) => console.warn(JSON.stringify({ level: "warn", event, ...metadata })),
  error: (event, metadata) => console.error(JSON.stringify({ level: "error", event, ...metadata })),
};

const PRIVACY_POLICY_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>よていスナップ プライバシーポリシー</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif; line-height: 1.65; margin: 0; padding: 32px 20px; color: #15151f; background: #fff; }
    main { max-width: 820px; margin: 0 auto; }
    h1, h2 { line-height: 1.25; }
    h1 { font-size: 1.9rem; }
    h2 { margin-top: 2rem; }
    ul { padding-left: 1.4rem; }
    .updated { color: #555; }
  </style>
</head>
<body>
  <main>
    <h1>よていスナップ プライバシーポリシー</h1>
    <p class="updated">Last updated: 2026-07-30</p>

    <h2>日本語</h2>
    <p>よていスナップ（紙の案内を予定に変える）は、ユーザーが選択した書類画像から予定やタスク候補を抽出し、ユーザーが確認した場合だけ iOS カレンダーへ追加するアプリです。</p>

    <h2>送信されるデータときっかけ</h2>
    <p>ユーザーは「カメラで撮影」で写真を撮るか、「写真から選ぶ」で写真を選ぶことができます。アップロード前の確認画面で初回は「同意して続ける」、再試行時は「同意してもう一度試す」を選んだ場合に限り、その書類画像が よていスナップ の Google Cloud Run バックエンドへ HTTPS で送信されます。画像には、氏名、住所、日付、金額、機関名、予約情報などの個人情報が含まれる場合があります。</p>

    <h2>処理の流れと目的</h2>
    <p>よていスナップ のバックエンドは、予定やタスク候補を抽出する目的だけで画像を Google Gemini（Google LLC）へ送信します。Gemini API キーはバックエンドだけに保存され、iOS アプリには含まれません。</p>

    <h2>保存期間</h2>
    <p>よていスナップ は、アップロードされた画像、base64 データ、Gemini の生レスポンス、OCR 内容、抽出されたタイトル、氏名、住所、金額、要約をデータベース、オブジェクトストレージ、ファイルへ永続保存しません。画像はリクエスト処理中のメモリ上で扱われ、処理後に破棄されます。</p>

    <h2>Google Gemini Paid Service</h2>
    <p>本番環境の Gemini API キーは active billing が有効な Google Cloud Project に属する Paid Service として運用されます。Google は Paid Service の入力・出力を Google 製品の改善には使用しないと説明しています。ただし、安全性、セキュリティ、不正利用防止、法的義務のために、Google が限定された期間ログを処理する場合があります。また、Google の処理は国や地域をまたぐ場合があります。</p>

    <h2>同意しない場合</h2>
    <p>ユーザーはアップロード前の確認画面で「キャンセル」を選べます。キャンセルした場合、画像は送信されず、選択中の画像を削除し、AI 解析も予定の追加も行いません。</p>

    <h2>カレンダー</h2>
    <p>カレンダー権限は、ユーザーが抽出結果を確認したあと、初回は「カレンダーの使用を許可」を選んでシステムの権限を許可し、その後「カレンダーに追加」を選び、確認画面で「追加する」を選んで予定を追加するためだけに使います。既存のカレンダー内容を よていスナップ のバックエンドへアップロードしません。</p>

    <h2>ログ</h2>
    <p>本番アプリケーションログは、request_id、MIME type、画像サイズ、処理時間、モデル名、HTTP status、抽出ルートなどの運用メタデータに限定します。画像、base64、リクエスト本文、Gemini の生レスポンス、OCR 内容、タイトル、氏名、住所、金額、要約は記録しません。</p>

    <h2>削除と撤回</h2>
    <p>よていスナップ はアカウント、サーバー上の書類アーカイブ、履歴保存を提供していないため、アップロード済み画像のサーバー側削除依頼対象となる よていスナップ の永続データはありません。アップロードしない場合は、確認画面で「キャンセル」を選んでください。</p>

    <h2>連絡先と更新</h2>
    <p>プライバシーに関する問い合わせは App Store のサポート連絡先から行ってください。このポリシーを更新する場合は、このページの更新日を変更します。</p>

    <h2>English Summary</h2>
    <p>Yotei Snap (よていスナップ) sends a selected document image to its Google Cloud Run backend and Google Gemini only after the user explicitly taps the upload consent button. Yotei Snap does not persist uploaded images or extracted document contents. Google Gemini is used as a Paid Service under an active-billing Google Cloud project; Google does not use Paid Service inputs or outputs to improve Google products, but may process limited logs for safety, abuse prevention, security, and legal obligations.</p>
  </main>
</body>
</html>`;

function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

function createDefaultGeminiClient(apiKey: string): GeminiClient {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "lifesnap-action/1.0",
      },
    },
  }) as GeminiClient;
}

function readProperty(
  value: Record<PropertyKey, unknown>,
  key: PropertyKey,
): unknown {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function safeErrorMetadata(error: unknown): LogMetadata {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<PropertyKey, unknown>)
      : undefined;
  const rawName = record === undefined ? undefined : readProperty(record, "name");
  const rawStatus = record === undefined ? undefined : readProperty(record, "status");
  const rawStatusCode =
    record === undefined ? undefined : readProperty(record, "statusCode");
  const safeNames = new Set([
    "ApiError",
    "Error",
    "PublicHttpError",
    "SyntaxError",
    "ZodError",
  ]);
  const name =
    typeof rawName === "string" && safeNames.has(rawName)
      ? rawName
      : "Error";
  const candidateStatus =
    typeof rawStatus === "number"
      ? rawStatus
      : typeof rawStatusCode === "number"
        ? rawStatusCode
        : undefined;
  const status =
    candidateStatus !== undefined &&
    Number.isInteger(candidateStatus) &&
    candidateStatus >= 400 &&
    candidateStatus <= 599
      ? candidateStatus
      : undefined;

  return { error_name: name, upstream_status: status };
}

function sendJsonError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
) {
  return res.status(statusCode).json({ code, error: message });
}

function setExtractNoStoreHeaders(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

const setNoStore: RequestHandler = (_req, res, next) => {
  setExtractNoStoreHeaders(res);
  next();
};

function buildUploadMiddleware(
  invalidTypeStatus: 400 | 415,
) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (isAllowedImageMimeType(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new PublicHttpError(
            invalidTypeStatus,
            "UNSUPPORTED_IMAGE_TYPE",
            "許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。",
          ),
        );
      }
    },
  });
}

function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

function requireImage(req: Request): ImageInput {
  if (!req.file) {
    throw new PublicHttpError(
      400,
      "IMAGE_REQUIRED",
      "画像データが必要です。multipart/form-data の image フィールドで送信してください。",
    );
  }

  return {
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
  };
}

const APP_CHECK_FAILURES: Readonly<
  Record<AppCheckRequestErrorCode, { status: 401 | 403 | 503; message: string }>
> = Object.freeze({
  APP_CHECK_REQUIRED: {
    status: 401,
    message: "App Check トークンが必要です。",
  },
  APP_CHECK_INVALID: {
    status: 401,
    message: "App Check トークンが無効です。",
  },
  APP_CHECK_REPLAYED: {
    status: 401,
    message: "App Check トークンはすでに使用されています。",
  },
  APP_ID_FORBIDDEN: {
    status: 403,
    message: "このアプリからのリクエストは許可されていません。",
  },
  SECURITY_SERVICE_UNAVAILABLE: {
    status: 503,
    message:
      "セキュリティ確認サービスを一時的に利用できません。しばらくしてからもう一度お試しください。",
  },
});

function appCheckHttpError(error: unknown): PublicHttpError {
  if (typeof error === "object" && error !== null) {
    const code = readProperty(
      error as Record<PropertyKey, unknown>,
      "code",
    );
    if (
      typeof code === "string" &&
      Object.prototype.hasOwnProperty.call(APP_CHECK_FAILURES, code)
    ) {
      const publicFailure =
        APP_CHECK_FAILURES[code as AppCheckRequestErrorCode];
      return new PublicHttpError(
        publicFailure.status,
        code,
        publicFailure.message,
      );
    }
  }

  const fallback = APP_CHECK_FAILURES.SECURITY_SERVICE_UNAVAILABLE;
  return new PublicHttpError(
    fallback.status,
    "SECURITY_SERVICE_UNAVAILABLE",
    fallback.message,
  );
}

function installationHttpError(error: unknown): PublicHttpError {
  if (typeof error === "object" && error !== null) {
    const code = readProperty(
      error as Record<PropertyKey, unknown>,
      "code",
    );
    if (code === "INSTALLATION_ID_INVALID") {
      return new PublicHttpError(
        400,
        "INSTALLATION_ID_INVALID",
        "インストール識別子が無効です。",
      );
    }
  }

  return new PublicHttpError(
    503,
    "SECURITY_SERVICE_UNAVAILABLE",
    APP_CHECK_FAILURES.SECURITY_SERVICE_UNAVAILABLE.message,
  );
}

function quotaHttpError(code: QuotaDeniedCode): PublicHttpError {
  const messages: Readonly<Record<QuotaDeniedCode, string>> = {
    INSTALL_RATE_LIMITED:
      "短時間の利用上限に達しました。しばらくしてからもう一度お試しください。",
    INSTALL_DAILY_LIMITED:
      "本日の利用上限に達しました。時間をおいてもう一度お試しください。",
    SERVICE_DAILY_LIMITED:
      "本日のサービス利用上限に達しました。時間をおいてもう一度お試しください。",
  };
  return new PublicHttpError(429, code, messages[code]);
}

function quotaUnavailableError(): PublicHttpError {
  return new PublicHttpError(
    503,
    "QUOTA_SERVICE_UNAVAILABLE",
    "利用状況の確認サービスを一時的に利用できません。しばらくしてからもう一度お試しください。",
  );
}

function validateQuotaDecision(decision: QuotaDecision): QuotaDecision {
  if (typeof decision !== "object" || decision === null) {
    throw quotaUnavailableError();
  }
  if (decision.allowed === true) {
    if (
      decision.crossedThreshold !== undefined &&
      decision.crossedThreshold !== 70 &&
      decision.crossedThreshold !== 90 &&
      decision.crossedThreshold !== 100
    ) {
      throw quotaUnavailableError();
    }
    return decision;
  }
  if (
    decision.allowed === false &&
    (decision.code === "INSTALL_RATE_LIMITED" ||
      decision.code === "INSTALL_DAILY_LIMITED" ||
      decision.code === "SERVICE_DAILY_LIMITED") &&
    Number.isSafeInteger(decision.retryAfterSeconds) &&
    decision.retryAfterSeconds > 0
  ) {
    return decision;
  }
  throw quotaUnavailableError();
}

function buildMockExtraction() {
  return validateGeminiExtraction({
    route: "calendar_action",
    document_type: "school_notice",
    task_type: "event",
    title: "テスト予定",
    due_date: "",
    start_datetime: "2026-10-25T14:00",
    end_datetime: "2026-10-25T15:00",
    amount: 0,
    issuer: "",
    location: "",
    summary: "開発用の合成レスポンスです。",
    confidence: 0.95,
    risk_flags: [],
    evidence: "",
    calendar_event: {
      title: "テスト予定",
      start: "2026-10-25T14:00",
      end: "2026-10-25T15:00",
      description: "開発用の合成レスポンスです。",
      location: "",
    },
  });
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const env = options.env ?? process.env;
  const logger = options.logger ?? defaultLogger;
  const isProduction = env.NODE_ENV === "production";
  const mockModeEnabled = env.MOCK_MODE === "true";
  const legacyUpload = buildUploadMiddleware(400);
  const v2Upload = buildUploadMiddleware(415);
  const security = options.security;
  const extractionService =
    options.extractionService ??
    (env.GEMINI_API_KEY
      ? createGeminiExtractionService({
          apiKey: env.GEMINI_API_KEY,
          model: GEMINI_MODEL,
          createClient: createDefaultGeminiClient,
        })
      : undefined);

  if (isProduction && mockModeEnabled) {
    throw new Error("MOCK_MODE must not be enabled when NODE_ENV=production.");
  }

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/healthz/", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/privacy", (_req, res) => {
    res.type("html").send(PRIVACY_POLICY_HTML);
  });

  const requireSecurity: RequestHandler = (_req, _res, next) => {
    if (security === undefined) {
      next(
        new PublicHttpError(
          503,
          "SECURITY_SERVICE_UNAVAILABLE",
          APP_CHECK_FAILURES.SECURITY_SERVICE_UNAVAILABLE.message,
        ),
      );
      return;
    }
    next();
  };

  const verifyAppCheck: RequestHandler = asyncHandler(
    async (req, _res, next) => {
      try {
        await security?.appCheckVerifier.verify(
          req.get("X-Firebase-AppCheck"),
        );
      } catch (error) {
        throw appCheckHttpError(error);
      }
      next();
    },
  );

  const hashInstallationHeader: RequestHandler = (req, res, next) => {
    const installationId = req.headers["x-lifesnap-install-id"];
    if (
      security === undefined ||
      typeof installationId !== "string" ||
      installationId.trim().length === 0
    ) {
      next(
        new PublicHttpError(
          400,
          "INSTALLATION_ID_INVALID",
          "インストール識別子が無効です。",
        ),
      );
      return;
    }

    try {
      res.locals.installationHash =
        security.hashInstallationId(installationId);
      next();
    } catch (error) {
      next(installationHttpError(error));
    }
  };

  async function consumeQuota(
    scope:
      | { kind: "legacy" }
      | { kind: "v2"; installationHash: string },
  ): Promise<QuotaDecision> {
    if (security === undefined) {
      throw new PublicHttpError(
        503,
        "SECURITY_SERVICE_UNAVAILABLE",
        APP_CHECK_FAILURES.SECURITY_SERVICE_UNAVAILABLE.message,
      );
    }

    try {
      const decision = await security.quotaStore.consume(
        scope,
        security.now(),
      );
      return validateQuotaDecision(decision);
    } catch {
      throw quotaUnavailableError();
    }
  }

  function logThreshold(
    decision: QuotaDecision,
    routeCategory: "legacy" | "v2",
  ) {
    if (decision.allowed && decision.crossedThreshold !== undefined) {
      logger.warn("quota_threshold", {
        route_category: routeCategory,
        threshold_percent: decision.crossedThreshold,
      });
    }
  }

  async function handleExtraction(
    res: Response,
    image: ImageInput,
    routeCategory: "legacy" | "v2",
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    try {
      logger.info("extract_request", {
        request_id: requestId,
        mime: image.mimeType,
        bytes: image.buffer.length,
        model: GEMINI_MODEL,
        route_category: routeCategory,
      });

      if (mockModeEnabled) {
        logger.warn("mock_extraction_used", {
          request_id: requestId,
          route_category: "development_only",
          model: "mock",
        });
        const mockResult = buildMockExtraction();
        logger.info("extract_success", {
          request_id: requestId,
          mime: image.mimeType,
          bytes: image.buffer.length,
          latency_ms: Date.now() - startedAt,
          model: "mock",
          status: 200,
          route: mockResult.route,
        });
        res.json(mockResult);
        return;
      }

      if (extractionService === undefined) {
        throw new PublicHttpError(
          503,
          "AI_SERVICE_UNAVAILABLE",
          "AI解析サービスを一時的に利用できません。しばらくしてからもう一度お試しください。",
        );
      }

      const validated = await extractionService.extract(image);

      logger.info("extract_success", {
        request_id: requestId,
        mime: image.mimeType,
        bytes: image.buffer.length,
        latency_ms: Date.now() - startedAt,
        model: GEMINI_MODEL,
        status: 200,
        route: validated.route,
      });

      res.json(validated);
    } catch (error: unknown) {
      const publicError =
        isPublicHttpError(error)
          ? error
          : new PublicHttpError(502, "AI_EXTRACTION_FAILED", "画像の解析中にエラーが発生しました。しばらくしてからもう一度お試しください。");

      logger.error("extract_failed", {
        request_id: requestId,
        latency_ms: Date.now() - startedAt,
        status: publicError.statusCode,
        code: publicError.code,
        ...safeErrorMetadata(error),
      });

      sendJsonError(res, publicError.statusCode, publicError.code, publicError.publicMessage);
    }
  }

  app.post(
    "/api/v2/extract",
    setNoStore,
    requireSecurity,
    verifyAppCheck,
    hashInstallationHeader,
    v2Upload.single("image"),
    asyncHandler(async (req, res) => {
      const image = requireImage(req);
      const decision = await consumeQuota({
        kind: "v2",
        installationHash: res.locals.installationHash as string,
      });
      if (!decision.allowed) {
        res.setHeader(
          "Retry-After",
          String(decision.retryAfterSeconds),
        );
        throw quotaHttpError(decision.code);
      }
      logThreshold(decision, "v2");
      await handleExtraction(res, image, "v2");
    }),
  );

  app.post(
    "/api/extract",
    setNoStore,
    requireSecurity,
    legacyUpload.single("image"),
    asyncHandler(async (req, res) => {
      const image = requireImage(req);
      const decision = await consumeQuota({ kind: "legacy" });
      if (!decision.allowed) {
        res.setHeader(
          "Retry-After",
          String(decision.retryAfterSeconds),
        );
        throw quotaHttpError(decision.code);
      }
      logThreshold(decision, "legacy");
      await handleExtraction(res, image, "legacy");
    }),
  );

  const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, _next) => {
    const isExtractionRoute =
      req.path === "/api/extract" ||
      req.path === "/api/v2/extract";
    if (isExtractionRoute) {
      setExtractNoStoreHeaders(res);
    }

    if (isPublicHttpError(err)) {
      sendJsonError(res, err.statusCode, err.code, err.publicMessage);
      return;
    }

    const errorCode =
      typeof err === "object" && err !== null
        ? readProperty(err as Record<PropertyKey, unknown>, "code")
        : undefined;
    if (errorCode === "LIMIT_FILE_SIZE" && isExtractionRoute) {
      sendJsonError(
        res,
        req.path === "/api/v2/extract" ? 413 : 400,
        "IMAGE_TOO_LARGE",
        "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
      );
      return;
    }

    logger.error("request_failed", {
      request_id: crypto.randomUUID(),
      route: req.path,
      status: 500,
      ...safeErrorMetadata(err),
    });

    sendJsonError(res, 500, "INTERNAL_ERROR", "サーバーエラーが発生しました。");
  };

  app.use(errorHandler);

  return app;
}

if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
  createApp().listen(PORT, "0.0.0.0", () => {
    defaultLogger.info("server_started", { port: PORT });
  });
}
