import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import {
  geminiResponseSchema,
  GEMINI_EXTRACTION_PROMPT,
  validateGeminiExtraction,
} from "./src/shared/gemini-schema";
import {
  buildCalendarEventPayload,
  createCalendarEvent,
  exchangeCodeForToken,
  checkForDuplicateEvent,
} from "./src/shared/calendar-service";
import { GeminiExtractionSchema } from "./src/shared/gemini-schema";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);

// Increase payload size limit to handle large base64 images
app.use(express.json({ limit: "20mb" }));

// Initialize GoogleGenAI client (Server-side only)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// ─── Health Check ──────────────────────────────────────────────

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── API Route: Frontend Config ────────────────────────────────

app.get("/api/config", (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  });
});

// ─── API Route: Verify Google ID Token ─────────────────────────

app.post("/api/auth/google", async (req, res): Promise<any> => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: "credential is required" });
    }

    // Verify the ID token with Google's tokeninfo endpoint
    const tokenRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
    );

    if (!tokenRes.ok) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const tokenInfo = (await tokenRes.json()) as any;

    // Verify the audience matches our client ID
    const expectedClientId = process.env.GOOGLE_CLIENT_ID;
    if (expectedClientId && tokenInfo.aud !== expectedClientId) {
      return res.status(401).json({ error: "Token audience mismatch" });
    }

    res.json({
      googleId: tokenInfo.sub,
      name: tokenInfo.name || tokenInfo.email?.split("@")[0] || "User",
      email: tokenInfo.email,
      avatar:
        tokenInfo.picture ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
          tokenInfo.name || "U"
        )}&background=4285F4&color=fff&size=128&bold=true`,
      calendarLinked: false,
    });
  } catch (error: any) {
    console.error("Auth error:", error);
    res.status(500).json({ error: "認証中にエラーが発生しました。" });
  }
});

// ─── API Route: Exchange Calendar OAuth Code ───────────────────

app.post("/api/auth/google/calendar", async (req, res): Promise<any> => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      return res.status(400).json({ error: "code is required" });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res
        .status(500)
        .json({ error: "OAuth client credentials not configured on server." });
    }

    const tokenData = await exchangeCodeForToken(
      code,
      clientId,
      clientSecret,
      redirectUri || "postmessage"
    );

    res.json({
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
    });
  } catch (error: any) {
    console.error("Calendar OAuth error:", error);
    res.status(500).json({ error: "カレンダー認証中にエラーが発生しました。" });
  }
});

// ─── API Route: Extract Event Details from Image ───────────────

app.post("/api/extract", async (req, res): Promise<any> => {
  try {
    const { image, mimeType } = req.body;
    
    if (!image) {
      return res.status(400).json({
        error: "画像データ（image）を指定してください。",
      });
    }

    let finalMimeType = mimeType || "image/jpeg";
    let base64Data = "";

    // Direct base64 input — strip out base64 header if present
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      finalMimeType = match[1];
      base64Data = match[2];
    } else {
      base64Data = image;
    }

    // MIME type validation (SSRF / Format restriction)
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    if (!allowedMimes.includes(finalMimeType.toLowerCase())) {
      return res.status(400).json({
        error: "許可されていない画像形式です。JPEG、PNG、WebP画像のみアップロード可能です。",
      });
    }

    // Size validation (Max 10MB)
    const approximateSizeBytes = (base64Data.length * 3) / 4;
    if (approximateSizeBytes > 10 * 1024 * 1024) {
      return res.status(400).json({
        error: "画像サイズが大きすぎます。10MB以下の画像をアップロードしてください。",
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.warn(
        "GEMINI_API_KEY is not defined. Falling back to mock extraction."
      );
      // Fallback response for dev when API key is missing
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

    console.log("Calling Gemini API for image analysis...");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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

    // Validate with Zod
    const validated = validateGeminiExtraction(parsedRaw);

    res.json(validated);
  } catch (error: any) {
    console.error("Error analyzing image with Gemini:", error);
    res.status(500).json({
      error: "画像の解析中にエラーが発生しました。",
      details: error.message,
    });
  }
});

// ─── API Route: Create Calendar Event ──────────────────────────

app.post("/api/create-calendar-event", async (req, res): Promise<any> => {
  try {
    const { extraction, accessToken } = req.body;

    if (!accessToken) {
      return res.status(401).json({ error: "accessToken is required" });
    }

    if (!extraction) {
      return res.status(400).json({ error: "extraction is required" });
    }

    // Validate extraction data
    const validatedExtraction = GeminiExtractionSchema.parse(extraction);

    if (validatedExtraction.route !== "calendar_action") {
      return res.status(400).json({
        error: `Cannot create event for route: ${validatedExtraction.route}`,
      });
    }

    // Build Calendar API payload
    const payload = buildCalendarEventPayload(validatedExtraction);

    // Check for duplicate event using the hash
    if (payload.extendedProperties?.private?.lifesnap_draft_hash) {
      const existingEvent = await checkForDuplicateEvent(
        accessToken,
        payload.extendedProperties.private.lifesnap_draft_hash
      );
      if (existingEvent) {
        console.log("Duplicate event found, returning existing event details:", existingEvent.eventId);
        return res.json({
          eventId: existingEvent.eventId,
          htmlLink: existingEvent.htmlLink,
        });
      }
    }

    // Create event via Calendar API
    const result = await createCalendarEvent(accessToken, payload);

    console.log("Calendar event created:", result.eventId);

    res.json({
      eventId: result.eventId,
      htmlLink: result.htmlLink,
    });
  } catch (error: any) {
    console.error("Error creating calendar event:", error);

    if (error.message?.includes("401")) {
      return res.status(401).json({
        error: "カレンダーのアクセストークンが無効です。再認証してください。",
      });
    }

    res.status(500).json({
      error: "カレンダーイベントの作成中にエラーが発生しました。",
      details: error.message,
    });
  }
});

// ─── Setup Static Files & Vite Middleware ──────────────────────

async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupServer();
