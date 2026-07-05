import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import {
  geminiResponseSchema,
  GEMINI_EXTRACTION_PROMPT,
  validateGeminiExtraction,
} from "./src/shared/gemini-schema";

dotenv.config({ quiet: true });

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);
const isProduction = process.env.NODE_ENV === "production";
const mockModeEnabled = process.env.MOCK_MODE === "true";

if (isProduction && mockModeEnabled) {
  throw new Error("MOCK_MODE must not be enabled when NODE_ENV=production.");
}

const PRIVACY_POLICY_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LifeSnap Action Privacy Policy</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; line-height: 1.65; margin: 0; padding: 32px 20px; color: #15151f; background: #fff; }
    main { max-width: 760px; margin: 0 auto; }
    h1, h2 { line-height: 1.25; }
  </style>
</head>
<body>
  <main>
    <h1>LifeSnap Action Privacy Policy</h1>
    <p>LifeSnap Action helps users extract calendar-action candidates from selected document images.</p>
    <h2>Image Processing</h2>
    <p>Selected images are sent to the LifeSnap backend and the Gemini API only for calendar-action extraction. LifeSnap does not intentionally store original images.</p>
    <h2>Calendar Access</h2>
    <p>Calendar access is used only to add events that the user confirms. LifeSnap does not upload or read the user's existing calendar contents.</p>
    <h2>Logging</h2>
    <p>Production logs are designed not to include image bytes, base64 payloads, full OCR/extracted text, full personal data, addresses, amounts, or request bodies.</p>
    <h2>Contact</h2>
    <p>For privacy questions, contact the app owner through the App Store support channel.</p>
    <p>Last updated: 2026-07-04</p>
  </main>
</body>
</html>`;

// JSON body parser for base64 fallback
app.use(express.json({ limit: "20mb" }));

// Multer for multipart/form-data image uploads (10 MB limit)
const upload = multer({
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。"));
    }
  },
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

function safeErrorMetadata(error: unknown): Record<string, string | number | undefined> {
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

  return { name, code, status };
}

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "lifesnap-action/1.0",
      },
    },
  });
}

// ─── Health Check ──────────────────────────────────────────────

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

// ─── API Route: Extract Event Details from Image ───────────────

app.post("/api/extract", upload.single("image"), async (req, res): Promise<any> => {
  try {
    let base64Data = "";
    let finalMimeType = "image/jpeg";

    // Path 1: Multipart file upload (primary — iOS app)
    if (req.file) {
      base64Data = req.file.buffer.toString("base64");
      finalMimeType = req.file.mimetype;
    }
    // Path 2: Base64 JSON body (fallback — backward compatibility)
    else if (req.body.image) {
      const { image, mimeType } = req.body;

      if (typeof image !== "string" || (mimeType !== undefined && typeof mimeType !== "string")) {
        return res.status(400).json({
          error: "画像データの形式が正しくありません。",
        });
      }

      finalMimeType = mimeType || "image/jpeg";

      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        finalMimeType = match[1];
        base64Data = match[2];
      } else {
        base64Data = image;
      }

      // MIME validation for JSON path
      if (!isAllowedImageMimeType(finalMimeType)) {
        return res.status(400).json({
          error: "許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。",
        });
      }

      // Size validation for JSON path (approx 10 MB)
      const approximateSizeBytes = (base64Data.length * 3) / 4;
      if (approximateSizeBytes > MAX_IMAGE_BYTES) {
        return res.status(400).json({
          error: "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
        });
      }
    } else {
      return res.status(400).json({
        error: "画像データが必要です。multipart/form-data の 'image' フィールド、または JSON body の 'image' フィールドで送信してください。",
      });
    }

    // Mock extraction is development-only. Production must use Gemini with a backend-held key.
    if (mockModeEnabled) {
      console.warn("Using mock extraction. MOCK_MODE is development-only and disabled in production.");
      const mockResult = {
        route: "calendar_action" as const,
        document_type: "school_notice",
        task_type: "event",
        title: "デザインミーティング",
        due_date: "",
        start_datetime: "2026-10-25T14:00",
        end_datetime: "2026-10-25T15:00",
        amount: 5000,
        issuer: "株式会社LifeSnap",
        location: "オンライン会議",
        summary:
          "次期プロジェクトのキックオフ。資料準備が必要。（※APIキー未設定によるテストデータ）",
        confidence: 0.95,
        risk_flags: [],
        evidence: "",
        calendar_event: {
          title: "デザインミーティング",
          start: "2026-10-25T14:00",
          end: "2026-10-25T15:00",
          description: "次期プロジェクトのキックオフ。資料準備が必要。",
          location: "オンライン会議",
        },
      };
      return res.json(validateGeminiExtraction(mockResult));
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return res.status(503).json({
        error: "Service not configured: GEMINI_API_KEY is missing.",
      });
    }

    console.log(`Calling Gemini API (${GEMINI_MODEL}) for image analysis...`);
    const ai = createGeminiClient(geminiApiKey);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          inlineData: {
            mimeType: finalMimeType,
            data: base64Data,
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

    const resultText = response.text;

    if (!resultText) {
      throw new Error("Gemini returned empty response.");
    }

    const parsedRaw = JSON.parse(resultText);
    const validated = validateGeminiExtraction(parsedRaw);

    res.json(validated);
  } catch (error: any) {
    console.error("Error analyzing image with Gemini:", safeErrorMetadata(error));

    // Multer file size error
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
      });
    }

    res.status(500).json({
      error: "画像の解析中にエラーが発生しました。",
    });
  }
});

// ─── Error Handling Middleware ─────────────────────────────────

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction): any => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
      });
    }
    return res.status(400).json({ error: `アップロードエラー: ${err.message}` });
  }

  if (err.message && (err.message.includes("許可されていない画像形式") || err.message.includes("画像形式"))) {
    return res.status(400).json({ error: err.message });
  }

  console.error("Unhandled error:", safeErrorMetadata(err));
  res.status(500).json({ error: "サーバーエラーが発生しました。" });
});

// ─── Start Server ──────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`LifeSnap Action API server running on http://localhost:${PORT}`);
});
