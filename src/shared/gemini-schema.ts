import { z } from "zod";
import { Type } from "@google/genai";

// ─── Route Types ───────────────────────────────────────────────
export const ROUTES = ["calendar_action", "needs_review", "no_action_detected"] as const;
export type Route = (typeof ROUTES)[number];

// ─── Zod Schema ────────────────────────────────────────────────
// Runtime validation for Gemini structured output

export const CalendarEventSchema = z.object({
  title: z.string().min(1),
  start: z.string().min(1, "start is required for calendar_event"),
  end: z.string().optional().default(""),
  description: z.string().optional().default(""),
  location: z.string().optional().default(""),
});

export const GeminiExtractionSchema = z.object({
  route: z.enum(ROUTES),
  document_type: z.string().optional().default(""),
  task_type: z.string().optional().default(""),
  title: z.string().optional().default(""),
  due_date: z.string().optional().default(""),
  start_datetime: z.string().optional().default(""),
  end_datetime: z.string().optional().default(""),
  amount: z.number().optional().default(0),
  issuer: z.string().optional().default(""),
  location: z.string().optional().default(""),
  summary: z.string().optional().default(""),
  confidence: z.number().min(0).max(1).optional().default(0),
  risk_flags: z.array(z.string()).optional().default([]),
  evidence: z.string().optional().default(""),
  calendar_event: CalendarEventSchema.optional(),
});

export type GeminiExtraction = z.infer<typeof GeminiExtractionSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// ─── Gemini Structured Output Schema ───────────────────────────
// Used with @google/genai `responseSchema` config

export const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    route: {
      type: Type.STRING,
      enum: ["calendar_action", "needs_review", "no_action_detected"],
      description:
        "Routing decision. calendar_action: a clear future event/task/deadline was found. needs_review: a potential event exists but date, time, or action is unclear and needs user review. no_action_detected: no future actionable event was found in the image.",
    },
    document_type: {
      type: Type.STRING,
      description:
        "Document category. Examples: invoice, school_notice, appointment_confirmation, receipt, flyer, ticket, letter, other",
    },
    task_type: {
      type: Type.STRING,
      description:
        "Type of action. Examples: payment_deadline, event, appointment, reservation, meeting, deadline, reminder, other",
    },
    title: {
      type: Type.STRING,
      description: "Event/task title extracted from the document. Example: 保護者会, 歯科検診, 電気代支払い",
    },
    due_date: {
      type: Type.STRING,
      description: "Due date or deadline if applicable (YYYY-MM-DD). Leave empty if not found.",
    },
    start_datetime: {
      type: Type.STRING,
      description:
        "Event start datetime (ISO 8601: YYYY-MM-DDTHH:mm or YYYY-MM-DD for all-day). Leave empty if not clearly stated in the document. Do NOT guess or infer dates that are not explicitly written.",
    },
    end_datetime: {
      type: Type.STRING,
      description:
        "Event end datetime (ISO 8601: YYYY-MM-DDTHH:mm or YYYY-MM-DD for all-day). Leave empty if not clearly stated.",
    },
    amount: {
      type: Type.NUMBER,
      description: "Monetary amount if applicable (number only, no currency symbol). 0 if none.",
    },
    issuer: {
      type: Type.STRING,
      description: "Issuer, organizer, or sender. Example: 〇〇小学校, 東京電力, 山田歯科",
    },
    location: {
      type: Type.STRING,
      description: "Location or venue. Example: 体育館, オンライン, 東京都渋谷区...",
    },
    summary: {
      type: Type.STRING,
      description:
        "Brief human-readable summary of what the document says and what action is needed. Include any important notes, required items, or preparation instructions.",
    },
    confidence: {
      type: Type.NUMBER,
      description: "Confidence score from 0.0 to 1.0 for the extraction accuracy.",
    },
    risk_flags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Array of risk flags. Examples: ["date_ambiguous", "amount_estimated", "partial_ocr", "low_confidence"]',
    },
    evidence: {
      type: Type.STRING,
      description: "Relevant text excerpts from the image that support the extraction.",
    },
    calendar_event: {
      type: Type.OBJECT,
      description: "Pre-built calendar event fields. Only populated when route is calendar_action.",
      properties: {
        title: { type: Type.STRING, description: "Calendar event title" },
        start: {
          type: Type.STRING,
          description: "Start datetime (ISO 8601: YYYY-MM-DDTHH:mm or YYYY-MM-DD for all-day)",
        },
        end: {
          type: Type.STRING,
          description: "End datetime (ISO 8601: YYYY-MM-DDTHH:mm or YYYY-MM-DD for all-day). If unknown, leave empty.",
        },
        description: {
          type: Type.STRING,
          description: "Calendar event description/notes",
        },
        location: {
          type: Type.STRING,
          description: "Calendar event location",
        },
      },
      required: ["title", "start"],
    },
  },
  required: ["route"],
};

// ─── Gemini Prompt ─────────────────────────────────────────────

export const GEMINI_EXTRACTION_PROMPT = `あなたは書類・画像から予定やタスクを抽出するAIアシスタントです。

以下のルールに従って情報を抽出してください：

1. **日付の推測は禁止**: 日付が画像内に明記されていない場合は、推測しないでください。start_datetime, end_datetime, due_date を空欄にし、route を "needs_review" にしてください。

2. **ルーティング判定**:
   - "calendar_action": 明確な将来の予定・タスク・締切が検出された場合（日付・時刻が明記されている）
   - "needs_review": 予定らしきものはあるが、日付・時刻・アクションが不明確な場合
   - "no_action_detected": 将来のアクションが見つからない場合（レシートの記録のみ、過去の領収書など）

3. **calendar_event**: route が "calendar_action" の場合のみ、calendar_event オブジェクトを設定してください。

4. **金額**: 数値のみ（通貨記号なし）。なければ 0。

5. **confidence**: 抽出の確信度（0.0〜1.0）。

6. **risk_flags**: 注意すべき点があれば配列で返してください。例: ["date_ambiguous", "amount_estimated", "partial_ocr"]

日本語で分かりやすく抽出してください。`;

// ─── Japanese Era Date Normalizer ───────────────────────────────

export function normalizeJapaneseEraDate(text: string): string {
  if (!text) return text;

  let normalized = text.trim();

  // 1. Convert full-width characters to half-width
  normalized = normalized.replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
  normalized = normalized.replace(/　/g, " ");

  // 2. Remove weekday suffixes like (水), （水）, (水曜日) etc.
  normalized = normalized.replace(/[([（][日月火水木金土](?:曜日)?[\)\]）]/g, "");

  // 3. Normalize 午前/午後 and Japanese time representations (X時Y分, X時)
  // E.g. 午後2時 -> 14:00, 午前9時30分 -> 09:30
  // Convert 午後X to X+12
  normalized = normalized.replace(/午後\s*(\d+)/g, (_, h) => {
    const hour = parseInt(h, 10);
    return hour === 12 ? "12" : String(hour + 12);
  });
  // Convert 午前X to X (or 00 if 12)
  normalized = normalized.replace(/午前\s*(\d+)/g, (_, h) => {
    const hour = parseInt(h, 10);
    return hour === 12 ? "00" : String(hour);
  });

  // Convert X時Y分 to X:Y
  normalized = normalized.replace(/(\d+)\s*時\s*(\d+)\s*分?/g, (_, h, m) => {
    return `${String(parseInt(h, 10)).padStart(2, "0")}:${String(parseInt(m, 10)).padStart(2, "0")}`;
  });

  // Convert X時 to X:00
  normalized = normalized.replace(/(\d+)\s*時/g, (_, h) => {
    return `${String(parseInt(h, 10)).padStart(2, "0")}:00`;
  });

  // Helper regexes for Japanese Era conversion
  // Matches "令和8年7月15日", "令和元年10月1日", "令8/7/15", "R8.7.15", "R8/7/15" etc.
  const reiwaRegex = /^(?:令和|令|[Rr])[.\s]?(?:元|\d+)\s*年?\s*[-/./年]\s*(\d+)\s*月?\s*[-/./月]\s*(\d+)\s*日?/i;
  const heiseiRegex = /^(?:平成|平|[Hh])[.\s]?(?:元|\d+)\s*年?\s*[-/./年]\s*(\d+)\s*月?\s*[-/./月]\s*(\d+)\s*日?/i;

  let datePart = normalized;
  let timePart = "";

  // Split by space, T, or look for times
  const timeMatch = normalized.match(/(?:\s+|T)(\d{2}:\d{2}(?::\d{2})?)$/);
  if (timeMatch) {
    timePart = timeMatch[1];
    datePart = normalized.substring(0, timeMatch.index).trim();
  }

  let parsedDate = "";

  const rMatch = datePart.match(reiwaRegex);
  if (rMatch) {
    const yearStr = datePart.match(/(?:令和|令|[Rr])[.\s]?(元|\d+)/i)?.[1];
    const yearNum = yearStr === "元" ? 1 : parseInt(yearStr || "1", 10);
    const year = 2018 + yearNum;
    const month = String(parseInt(rMatch[1], 10)).padStart(2, "0");
    const day = String(parseInt(rMatch[2], 10)).padStart(2, "0");
    parsedDate = `${year}-${month}-${day}`;
  } else {
    const hMatch = datePart.match(heiseiRegex);
    if (hMatch) {
      const yearStr = datePart.match(/(?:平成|平|[Hh])[.\s]?(元|\d+)/i)?.[1];
      const yearNum = yearStr === "元" ? 1 : parseInt(yearStr || "1", 10);
      const year = 1988 + yearNum;
      const month = String(parseInt(hMatch[1], 10)).padStart(2, "0");
      const day = String(parseInt(hMatch[2], 10)).padStart(2, "0");
      parsedDate = `${year}-${month}-${day}`;
    }
  }

  if (parsedDate) {
    return timePart ? `${parsedDate}T${timePart}` : parsedDate;
  }

  return normalized;
}

export function normalizeExtractionDates(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;

  const result = { ...raw };

  if (result.start_datetime) {
    result.start_datetime = normalizeJapaneseEraDate(result.start_datetime);
  }
  if (result.end_datetime) {
    result.end_datetime = normalizeJapaneseEraDate(result.end_datetime);
  }
  if (result.due_date) {
    result.due_date = normalizeJapaneseEraDate(result.due_date);
  }

  if (result.calendar_event && typeof result.calendar_event === "object") {
    result.calendar_event = { ...result.calendar_event };
    if (result.calendar_event.start) {
      result.calendar_event.start = normalizeJapaneseEraDate(result.calendar_event.start);
    }
    if (result.calendar_event.end) {
      result.calendar_event.end = normalizeJapaneseEraDate(result.calendar_event.end);
    }
  }

  return result;
}

// ─── Validation Helper ─────────────────────────────────────────

export function validateGeminiExtraction(raw: unknown): GeminiExtraction {
  const normalized = normalizeExtractionDates(raw);
  return GeminiExtractionSchema.parse(normalized);
}

