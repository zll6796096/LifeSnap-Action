import crypto from "node:crypto";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import {
  geminiResponseSchema,
  GEMINI_EXTRACTION_PROMPT,
  validateGeminiExtraction,
} from "./src/shared/gemini-schema";

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

type GeminiClient = {
  models: {
    generateContent: (request: unknown) => Promise<{ text?: string }>;
  };
};

type AppEnvironment = Pick<NodeJS.ProcessEnv, "NODE_ENV" | "MOCK_MODE" | "GEMINI_API_KEY">;

export type CreateAppOptions = {
  env?: AppEnvironment;
  logger?: PrivacySafeLogger;
  createGeminiClient?: (apiKey: string) => GeminiClient;
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
    <p>カレンダー権限は、ユーザーが抽出結果を確認し、「カレンダーに追加」と「追加する」で予定を追加するためだけに使います。既存のカレンダー内容を よていスナップ のバックエンドへアップロードしません。</p>

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

class PublicHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

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

function safeErrorMetadata(error: unknown): LogMetadata {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const name = typeof record.name === "string" ? record.name : "Error";
  const code =
    typeof record.code === "string" || typeof record.code === "number" ? record.code : undefined;
  const status =
    typeof record.status === "number"
      ? record.status
      : typeof record.statusCode === "number"
        ? record.statusCode
        : undefined;

  return { error_name: name, upstream_code: code, upstream_status: status };
}

function sendJsonError(res: Response, statusCode: number, code: string, message: string) {
  return res.status(statusCode).json({ code, error: message });
}

function setExtractNoStoreHeaders(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function buildUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (isAllowedImageMimeType(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new PublicHttpError(
            400,
            "UNSUPPORTED_IMAGE_TYPE",
            "許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。",
          ),
        );
      }
    },
  });
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
  const createGeminiClient = options.createGeminiClient ?? createDefaultGeminiClient;
  const isProduction = env.NODE_ENV === "production";
  const mockModeEnabled = env.MOCK_MODE === "true";
  const upload = buildUploadMiddleware();

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

  app.post("/api/extract", upload.single("image"), async (req, res): Promise<void> => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    setExtractNoStoreHeaders(res);

    try {
      if (!req.file) {
        sendJsonError(res, 400, "IMAGE_REQUIRED", "画像データが必要です。multipart/form-data の image フィールドで送信してください。");
        return;
      }

      const finalMimeType = req.file.mimetype;
      const imageSizeBytes = req.file.size;

      if (!isAllowedImageMimeType(finalMimeType)) {
        sendJsonError(res, 400, "UNSUPPORTED_IMAGE_TYPE", "許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。");
        return;
      }

      logger.info("extract_request", {
        request_id: requestId,
        mime: finalMimeType,
        bytes: imageSizeBytes,
        model: GEMINI_MODEL,
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
          mime: finalMimeType,
          bytes: imageSizeBytes,
          latency_ms: Date.now() - startedAt,
          model: "mock",
          status: 200,
          route: mockResult.route,
        });
        res.json(mockResult);
        return;
      }

      const geminiApiKey = env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        logger.error("extract_configuration_error", {
          request_id: requestId,
          code: "GEMINI_KEY_MISSING",
          status: 503,
        });
        sendJsonError(res, 503, "AI_SERVICE_UNAVAILABLE", "AI解析サービスを一時的に利用できません。しばらくしてからもう一度お試しください。");
        return;
      }

      const ai = createGeminiClient(geminiApiKey);
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            inlineData: {
              mimeType: finalMimeType,
              data: req.file.buffer.toString("base64"),
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

      if (!response.text) {
        throw new PublicHttpError(502, "AI_EMPTY_RESPONSE", "AI解析サービスから有効な応答を取得できませんでした。");
      }

      const parsedRaw = JSON.parse(response.text);
      const validated = validateGeminiExtraction(parsedRaw);

      logger.info("extract_success", {
        request_id: requestId,
        mime: finalMimeType,
        bytes: imageSizeBytes,
        latency_ms: Date.now() - startedAt,
        model: GEMINI_MODEL,
        status: 200,
        route: validated.route,
      });

      res.json(validated);
    } catch (error: unknown) {
      const publicError =
        error instanceof PublicHttpError
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
  });

  const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, _next) => {
    if (req.path === "/api/extract") {
      setExtractNoStoreHeaders(res);
    }

    if (err instanceof PublicHttpError) {
      sendJsonError(res, err.statusCode, err.code, err.publicMessage);
      return;
    }

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      sendJsonError(res, 400, "IMAGE_TOO_LARGE", "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。");
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
