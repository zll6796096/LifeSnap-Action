import { describe, it, expect } from "vitest";
import { buildCalendarEventPayload } from "../calendar-service";
import type { GeminiExtraction } from "../gemini-schema";

function makeExtraction(overrides: Partial<GeminiExtraction> = {}): GeminiExtraction {
  return {
    route: "calendar_action",
    document_type: "",
    task_type: "",
    title: "テストイベント",
    due_date: "",
    start_datetime: "2026-07-20T14:00",
    end_datetime: "2026-07-20T15:00",
    amount: 0,
    issuer: "",
    location: "",
    summary: "",
    confidence: 0.9,
    risk_flags: [],
    evidence: "",
    calendar_event: {
      title: "テストイベント",
      start: "2026-07-20T14:00",
      end: "2026-07-20T15:00",
      description: "",
      location: "",
    },
    ...overrides,
  };
}

describe("buildCalendarEventPayload", () => {
  // ── Timed events ─────────────────────────────────────────────

  it("builds a timed event payload correctly", () => {
    const extraction = makeExtraction();
    const payload = buildCalendarEventPayload(extraction);

    expect(payload.summary).toBe("テストイベント");
    expect(payload.start.dateTime).toBe("2026-07-20T14:00:00");
    expect(payload.start.timeZone).toBe("Asia/Tokyo");
    expect(payload.end.dateTime).toBe("2026-07-20T15:00:00");
    expect(payload.end.timeZone).toBe("Asia/Tokyo");
    expect(payload.start.date).toBeUndefined();
  });

  it("defaults to 1 hour duration when end time is missing", () => {
    const extraction = makeExtraction({
      end_datetime: "",
      calendar_event: {
        title: "テスト",
        start: "2026-07-20T14:00",
        end: "",
        description: "",
        location: "",
      },
    });

    const payload = buildCalendarEventPayload(extraction);

    expect(payload.start.dateTime).toBe("2026-07-20T14:00:00");
    // End should be ~1 hour after start
    expect(payload.end.dateTime).toContain("2026-07-20T");
  });

  // ── All-day events ───────────────────────────────────────────

  it("builds an all-day event payload correctly", () => {
    const extraction = makeExtraction({
      start_datetime: "2026-08-10",
      end_datetime: "",
      calendar_event: {
        title: "夏休み初日",
        start: "2026-08-10",
        end: "",
        description: "",
        location: "",
      },
    });

    const payload = buildCalendarEventPayload(extraction);

    expect(payload.start.date).toBe("2026-08-10");
    expect(payload.end.date).toBe("2026-08-11"); // Next day (exclusive end)
    expect(payload.start.dateTime).toBeUndefined();
    expect(payload.end.dateTime).toBeUndefined();
  });

  it("handles multi-day all-day event", () => {
    const extraction = makeExtraction({
      start_datetime: "2026-08-10",
      end_datetime: "2026-08-12",
      calendar_event: {
        title: "夏季休暇",
        start: "2026-08-10",
        end: "2026-08-12",
        description: "",
        location: "",
      },
    });

    const payload = buildCalendarEventPayload(extraction);

    expect(payload.start.date).toBe("2026-08-10");
    expect(payload.end.date).toBe("2026-08-13"); // Day after end (exclusive)
  });

  // ── Description building ─────────────────────────────────────

  it("includes amount and issuer in description", () => {
    const extraction = makeExtraction({
      amount: 15000,
      issuer: "東京電力",
      summary: "電気代の支払い期限",
      calendar_event: {
        title: "電気代支払い",
        start: "2026-07-31",
        end: "",
        description: "電気代の支払い",
        location: "",
      },
    });

    const payload = buildCalendarEventPayload(extraction);

    expect(payload.description).toContain("¥15,000");
    expect(payload.description).toContain("東京電力");
    expect(payload.description).toContain("LifeSnap Action");
  });

  it("includes summary from extraction", () => {
    const extraction = makeExtraction({
      summary: "持ち物: スリッパ、筆記用具",
    });

    const payload = buildCalendarEventPayload(extraction);

    expect(payload.description).toContain("持ち物: スリッパ、筆記用具");
  });

  // ── Location ─────────────────────────────────────────────────

  it("passes location through correctly", () => {
    const extraction = makeExtraction({
      location: "体育館 2F",
      calendar_event: {
        title: "保護者会",
        start: "2026-07-15T14:00",
        end: "2026-07-15T15:30",
        description: "",
        location: "体育館 2F",
      },
    });

    const payload = buildCalendarEventPayload(extraction);
    expect(payload.location).toBe("体育館 2F");
  });

  // ── Fallback behavior ────────────────────────────────────────

  it("uses top-level fields when calendar_event is missing", () => {
    const extraction = makeExtraction({
      title: "Fallbackイベント",
      start_datetime: "2026-09-01T10:00",
      end_datetime: "2026-09-01T11:30",
      location: "会議室A",
      calendar_event: undefined,
    });

    const payload = buildCalendarEventPayload(extraction);

    expect(payload.summary).toBe("Fallbackイベント");
    expect(payload.start.dateTime).toBe("2026-09-01T10:00:00");
    expect(payload.end.dateTime).toBe("2026-09-01T11:30:00");
    expect(payload.location).toBe("会議室A");
  });

  it("falls back to due_date when start_datetime is empty", () => {
    const extraction = makeExtraction({
      start_datetime: "",
      due_date: "2026-09-30",
      calendar_event: undefined,
    });

    const payload = buildCalendarEventPayload(extraction);

    expect(payload.start.date).toBe("2026-09-30");
    expect(payload.end.date).toBe("2026-10-01");
  });

  it("uses default title when none provided", () => {
    const extraction = makeExtraction({
      title: "",
      calendar_event: {
        title: "",
        start: "2026-07-20T14:00",
        end: "",
        description: "",
        location: "",
      },
    });

    const payload = buildCalendarEventPayload(extraction);

    // Should use fallback title
    expect(payload.summary.length).toBeGreaterThan(0);
  });

  // ── Custom timezone ──────────────────────────────────────────

  it("supports custom timezone", () => {
    const extraction = makeExtraction();
    const payload = buildCalendarEventPayload(extraction, "America/New_York");

    expect(payload.start.timeZone).toBe("America/New_York");
    expect(payload.end.timeZone).toBe("America/New_York");
  });

  // ── Date/Time Parsing ────────────────────────────────────────

  it("normalizes datetime without seconds", () => {
    const extraction = makeExtraction({
      calendar_event: {
        title: "テスト",
        start: "2026-07-20T14:00",
        end: "2026-07-20T15:00",
        description: "",
        location: "",
      },
    });

    const payload = buildCalendarEventPayload(extraction);

    // Should add :00 seconds
    expect(payload.start.dateTime).toBe("2026-07-20T14:00:00");
    expect(payload.end.dateTime).toBe("2026-07-20T15:00:00");
  });

  it("preserves datetime with seconds", () => {
    const extraction = makeExtraction({
      calendar_event: {
        title: "テスト",
        start: "2026-07-20T14:00:30",
        end: "2026-07-20T15:00:45",
        description: "",
        location: "",
      },
    });

    const payload = buildCalendarEventPayload(extraction);

    expect(payload.start.dateTime).toBe("2026-07-20T14:00:30");
    expect(payload.end.dateTime).toBe("2026-07-20T15:00:45");
  });

  // ── Duplicate Event Hash ─────────────────────────────────────

  it("includes issuer, amount, task_type, and end time in duplicate hash", () => {
    const extraction1 = makeExtraction({
      issuer: "Issuer A",
      amount: 1000,
      task_type: "event",
      end_datetime: "2026-07-20T15:00",
    });

    const extraction2 = makeExtraction({
      issuer: "Issuer B", // different issuer
      amount: 1000,
      task_type: "event",
      end_datetime: "2026-07-20T15:00",
    });

    const extraction3 = makeExtraction({
      issuer: "Issuer A",
      amount: 2000, // different amount
      task_type: "event",
      end_datetime: "2026-07-20T15:00",
    });

    const extraction4 = makeExtraction({
      issuer: "Issuer A",
      amount: 1000,
      task_type: "payment_deadline", // different task_type
      end_datetime: "2026-07-20T15:00",
    });

    const extraction5 = makeExtraction({
      issuer: "Issuer A",
      amount: 1000,
      task_type: "event",
      end_datetime: "2026-07-20T16:00", // different end_datetime
      calendar_event: {
        title: "テストイベント",
        start: "2026-07-20T14:00",
        end: "2026-07-20T16:00",
        description: "",
        location: "",
      },
    });

    const hash1 = buildCalendarEventPayload(extraction1).extendedProperties?.private?.lifesnap_draft_hash;
    const hash2 = buildCalendarEventPayload(extraction2).extendedProperties?.private?.lifesnap_draft_hash;
    const hash3 = buildCalendarEventPayload(extraction3).extendedProperties?.private?.lifesnap_draft_hash;
    const hash4 = buildCalendarEventPayload(extraction4).extendedProperties?.private?.lifesnap_draft_hash;
    const hash5 = buildCalendarEventPayload(extraction5).extendedProperties?.private?.lifesnap_draft_hash;

    expect(hash1).toBeDefined();
    expect(hash2).toBeDefined();
    expect(hash3).toBeDefined();
    expect(hash4).toBeDefined();
    expect(hash5).toBeDefined();

    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).not.toBe(hash4);
    expect(hash1).not.toBe(hash5);
  });
});
