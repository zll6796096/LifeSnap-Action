import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import {
  geminiResponseSchema,
  GEMINI_EXTRACTION_PROMPT,
  validateGeminiExtraction,
} from "./src/shared/gemini-schema";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);

// JSON body parser for base64 fallback
app.use(express.json({ limit: "20mb" }));

// Multer for multipart/form-data image uploads (10 MB limit)
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。"));
    }
  },
});

// Initialize GoogleGenAI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ─── Health Check ──────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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
      finalMimeType = mimeType || "image/jpeg";

      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        finalMimeType = match[1];
        base64Data = match[2];
      } else {
        base64Data = image;
      }

      // MIME validation for JSON path
      const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
      if (!allowedMimes.includes(finalMimeType.toLowerCase())) {
        return res.status(400).json({
          error: "許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。",
        });
      }

      // Size validation for JSON path (approx 10 MB)
      const approximateSizeBytes = (base64Data.length * 3) / 4;
      if (approximateSizeBytes > 10 * 1024 * 1024) {
        return res.status(400).json({
          error: "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
        });
      }
    } else {
      return res.status(400).json({
        error: "画像データが必要です。multipart/form-data の 'image' フィールド、または JSON body の 'image' フィールドで送信してください。",
      });
    }

    // Guard: GEMINI_API_KEY required in production
    if (!process.env.GEMINI_API_KEY) {
      if (process.env.NODE_ENV === "production" || process.env.MOCK_MODE !== "true") {
        return res.status(503).json({
          error: "Service not configured: GEMINI_API_KEY is missing.",
        });
      }

      console.warn(
        "GEMINI_API_KEY is not defined. Falling back to mock extraction (MOCK_MODE=true in dev)."
      );
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

    console.log(`Calling Gemini API (${GEMINI_MODEL}) for image analysis...`);

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
    console.log("Gemini API Raw Response:", resultText);

    if (!resultText) {
      throw new Error("Gemini returned empty response.");
    }

    const parsedRaw = JSON.parse(resultText);
    const validated = validateGeminiExtraction(parsedRaw);

    res.json(validated);
  } catch (error: any) {
    console.error("Error analyzing image with Gemini:", error);

    // Multer file size error
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
      });
    }

    res.status(500).json({
      error: "画像の解析中にエラーが発生しました。",
      details: error.message,
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

  console.error("Unhandled error:", err);
  res.status(500).json({ error: "サーバーエラーが発生しました。", details: err.message });
});

// ─── Start Server ──────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`LifeSnap Action API server running on http://localhost:${PORT}`);
});
