import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload size limit to handle large base64 images
app.use(express.json({ limit: "20mb" }));

// Initialize GoogleGenAI client (Server-side only)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API Route: Extract Event Details from Image (Base64 or URL)
app.post("/api/extract", async (req, res): Promise<any> => {
  try {
    const { image, mimeType, imageUrl } = req.body;
    let base64Data = "";
    let finalMimeType = mimeType || "image/jpeg";

    if (imageUrl) {
      console.log(`Fetching image from URL: ${imageUrl}`);
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image from URL. Status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        base64Data = Buffer.from(arrayBuffer).toString("base64");
        
        // Try to guess mime type from content-type header or URL extension
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.startsWith("image/")) {
          finalMimeType = contentType;
        } else if (imageUrl.toLowerCase().endsWith(".png")) {
          finalMimeType = "image/png";
        } else if (imageUrl.toLowerCase().endsWith(".webp")) {
          finalMimeType = "image/webp";
        } else if (imageUrl.toLowerCase().endsWith(".gif")) {
          finalMimeType = "image/gif";
        } else {
          finalMimeType = "image/jpeg";
        }
      } catch (err: any) {
        console.error("Error fetching hotlinked image:", err);
        return res.status(400).json({
          error: "画像の取得に失敗しました。URLが正しいか、またはホットリンク（外部からのアクセス）が許可されているか確認してください。",
          details: err.message
        });
      }
    } else if (image) {
      // Direct base64 input
      // Strip out base64 header if present
      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        finalMimeType = match[1];
        base64Data = match[2];
      } else {
        base64Data = image;
      }
    } else {
      return res.status(400).json({ error: "画像データ、または画像URL（imageUrl）を指定してください。" });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.warn("GEMINI_API_KEY is not defined. Falling back to mock extraction.");
      // Fallback response for dev when API key is missing (ensure graceful failure/mocking)
      return res.json({
        title: "デザインミーティング",
        date: "2026-10-25",
        time: "14:00 - 15:00",
        amount: 5000,
        issuer: "株式会社LifeSnap",
        location: "オンライン会議",
        notes: "次期プロジェクトのキックオフ。資料準備が必要。（※APIキー未設定によるテストデータ）",
        hasEvent: true
      });
    }

    console.log("Calling Gemini API for image analysis...");
    
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: finalMimeType,
            data: base64Data,
          }
        },
        {
          text: "このお知らせ・書類・画像から、カレンダー登録用の予定情報を抽出してください。項目が画像に記載されていない、または推測できない場合は、空欄（または金額は0）にしてください。日本語で分かりやすく抽出してください。カレンダーに登録すべき予定（イベント、タスク、予約、支払い期限、締め切りなど）が見つからない場合は、hasEventをfalseにしてください。"
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "予定の件名。例：デザインミーティング、週末のキャンプ旅行、歯科検診など" },
            date: { type: Type.STRING, description: "予定の日付（YYYY-MM-DD形式。不明な場合は本日の日付「2026-06-26」などを推測、または空欄）。例：2023-10-25" },
            time: { type: Type.STRING, description: "予定の時間（HH:MM形式、またはHH:MM-HH:MM形式などの時間帯。不明な場合は空欄）。例：14:00 - 15:00, 09:00" },
            amount: { type: Type.NUMBER, description: "金額（数値のみ。ない場合は0）。例：5000, 15000" },
            issuer: { type: Type.STRING, description: "発行元。主催者や店舗名など。例：株式会社LifeSnap、アウトドア用品店" },
            location: { type: Type.STRING, description: "場所。オンライン、住所、会議室名など。例：オンライン会議、奥多摩キャンプ場" },
            notes: { type: Type.STRING, description: "メモ・詳細。注意点や持ち物、補足情報など。例：テントのレンタル費用込み。食材は別途買い出し必要。" },
            hasEvent: { type: Type.BOOLEAN, description: "この画像からカレンダーに登録すべき予定（イベント、タスク、予約、支払い期限、締め切りなど）が検出されたかどうか" }
          },
          required: ["title", "date", "hasEvent"]
        }
      }
    });

    const resultText = response.text;
    console.log("Gemini API Raw Response:", resultText);

    if (!resultText) {
      throw new Error("Gemini returned empty response.");
    }

    const parsedResult = JSON.parse(resultText);
    res.json(parsedResult);

  } catch (error: any) {
    console.error("Error analyzing image with Gemini:", error);
    res.status(500).json({
      error: "画像の解析中にエラーが発生しました。",
      details: error.message
    });
  }
});

// Setup static files and Vite middleware
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupServer();
