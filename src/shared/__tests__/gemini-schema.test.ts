import { describe, it, expect } from "vitest";
import {
  GeminiExtractionSchema,
  validateGeminiExtraction,
  normalizeJapaneseEraDate,
} from "../gemini-schema";

describe("GeminiExtractionSchema", () => {
  // ── calendar_action ──────────────────────────────────────────

  it("validates a complete calendar_action payload", () => {
    const input = {
      route: "calendar_action",
      document_type: "school_notice",
      task_type: "event",
      title: "保護者会",
      due_date: "",
      start_datetime: "2026-07-15T14:00",
      end_datetime: "2026-07-15T15:30",
      amount: 0,
      issuer: "〇〇小学校",
      location: "体育館",
      summary: "7月の保護者会。スリッパ持参。",
      confidence: 0.92,
      risk_flags: [],
      evidence: "7月15日（火）14:00〜15:30 体育館にて",
      calendar_event: {
        title: "保護者会",
        start: "2026-07-15T14:00",
        end: "2026-07-15T15:30",
        description: "7月の保護者会。スリッパ持参。",
        location: "体育館",
      },
    };

    const result = validateGeminiExtraction(input);
    expect(result.route).toBe("calendar_action");
    expect(result.title).toBe("保護者会");
    expect(result.calendar_event?.start).toBe("2026-07-15T14:00");
    expect(result.confidence).toBe(0.92);
  });

  it("validates a minimal calendar_action with only required fields", () => {
    const input = {
      route: "calendar_action",
      calendar_event: {
        title: "Meeting",
        start: "2026-08-01T10:00",
      },
    };

    const result = validateGeminiExtraction(input);
    expect(result.route).toBe("calendar_action");
    expect(result.title).toBe(""); // defaults to empty
    expect(result.amount).toBe(0); // defaults to 0
    expect(result.risk_flags).toEqual([]);
    expect(result.calendar_event?.title).toBe("Meeting");
  });

  // ── no_action_detected ───────────────────────────────────────

  it("validates a no_action_detected payload", () => {
    const input = {
      route: "no_action_detected",
      document_type: "receipt",
      title: "",
      summary: "過去のレシート。将来のアクションなし。",
      confidence: 0.88,
      risk_flags: [],
    };

    const result = validateGeminiExtraction(input);
    expect(result.route).toBe("no_action_detected");
    expect(result.summary).toContain("過去のレシート");
    expect(result.calendar_event).toBeUndefined();
  });

  // ── needs_review ─────────────────────────────────────────────

  it("validates a needs_review payload with ambiguous date", () => {
    const input = {
      route: "needs_review",
      document_type: "flyer",
      task_type: "event",
      title: "夏祭り",
      start_datetime: "",
      end_datetime: "",
      summary: "日付が不明確。「今月末」とのみ記載。",
      confidence: 0.45,
      risk_flags: ["date_ambiguous"],
    };

    const result = validateGeminiExtraction(input);
    expect(result.route).toBe("needs_review");
    expect(result.risk_flags).toContain("date_ambiguous");
    expect(result.start_datetime).toBe("");
    expect(result.confidence).toBe(0.45);
  });

  // ── Validation errors ────────────────────────────────────────

  it("rejects an invalid route value", () => {
    const input = {
      route: "invalid_route",
    };

    expect(() => GeminiExtractionSchema.parse(input)).toThrow();
  });

  it("rejects missing route field", () => {
    const input = {
      title: "Test",
    };

    expect(() => GeminiExtractionSchema.parse(input)).toThrow();
  });

  it("rejects confidence out of range", () => {
    const input = {
      route: "calendar_action",
      confidence: 1.5,
    };

    expect(() => GeminiExtractionSchema.parse(input)).toThrow();
  });

  it("rejects negative confidence", () => {
    const input = {
      route: "calendar_action",
      confidence: -0.1,
    };

    expect(() => GeminiExtractionSchema.parse(input)).toThrow();
  });

  it("rejects calendar_event with missing title", () => {
    const input = {
      route: "calendar_action",
      calendar_event: {
        start: "2026-07-15T14:00",
      },
    };

    expect(() => GeminiExtractionSchema.parse(input)).toThrow();
  });

  it("rejects calendar_event with empty start", () => {
    const input = {
      route: "calendar_action",
      calendar_event: {
        title: "Meeting",
        start: "",
      },
    };

    expect(() => GeminiExtractionSchema.parse(input)).toThrow();
  });

  // ── Defaults ─────────────────────────────────────────────────

  it("applies defaults for optional fields", () => {
    const input = {
      route: "no_action_detected",
    };

    const result = validateGeminiExtraction(input);
    expect(result.title).toBe("");
    expect(result.amount).toBe(0);
    expect(result.issuer).toBe("");
    expect(result.location).toBe("");
    expect(result.summary).toBe("");
    expect(result.confidence).toBe(0);
    expect(result.risk_flags).toEqual([]);
    expect(result.evidence).toBe("");
  });

  // ── Japanese Era Normalization ────────────────────────────────

  it("normalizes Japanese era dates correctly", () => {

    // Reiwa
    expect(normalizeJapaneseEraDate("令和8年7月15日")).toBe("2026-07-15");
    expect(normalizeJapaneseEraDate("令和元年10月1日")).toBe("2019-10-01");
    expect(normalizeJapaneseEraDate("令8/7/15")).toBe("2026-07-15");
    expect(normalizeJapaneseEraDate("R8.7.15")).toBe("2026-07-15");
    expect(normalizeJapaneseEraDate("R8/7/15 14:00")).toBe("2026-07-15T14:00");

    // Heisei
    expect(normalizeJapaneseEraDate("平成30年5月20日")).toBe("2018-05-20");
    expect(normalizeJapaneseEraDate("平成元年1月1日")).toBe("1989-01-01");
    expect(normalizeJapaneseEraDate("H30.5.20")).toBe("2018-05-20");
    expect(normalizeJapaneseEraDate("平30/5/20 09:30")).toBe("2018-05-20T09:30");

    // Standard dates unchanged
    expect(normalizeJapaneseEraDate("2026-07-15")).toBe("2026-07-15");
    expect(normalizeJapaneseEraDate("2026-07-15T14:00")).toBe("2026-07-15T14:00");
  });

  it("normalizes era dates inside validateGeminiExtraction", () => {
    const input = {
      route: "calendar_action",
      start_datetime: "令和8年7月15日 14:00",
      end_datetime: "令和8年7月15日 15:30",
      calendar_event: {
        title: "保護者会",
        start: "令和8年7月15日 14:00",
        end: "令和8年7月15日 15:30",
      },
    };

    const result = validateGeminiExtraction(input);
    expect(result.start_datetime).toBe("2026-07-15T14:00");
    expect(result.end_datetime).toBe("2026-07-15T15:30");
    expect(result.calendar_event?.start).toBe("2026-07-15T14:00");
    expect(result.calendar_event?.end).toBe("2026-07-15T15:30");
  });
});
