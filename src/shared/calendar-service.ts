import { createHash } from "crypto";
import type { GeminiExtraction } from "./gemini-schema";

// ─── Types ─────────────────────────────────────────────────────

export interface GoogleCalendarEventPayload {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: {
    private: {
      lifesnap_draft_hash: string;
    };
  };
}

export interface CalendarEventResult {
  eventId: string;
  htmlLink: string;
}

export function generateEventHash(payload: {
  summary: string;
  location?: string;
  start: { dateTime?: string; date?: string };
}): string {
  const startVal = payload.start.dateTime || payload.start.date || "";
  const data = `${payload.summary}|${startVal}|${payload.location || ""}`;
  return createHash("sha256").update(data).digest("hex");
}


// ─── Date/Time Parsing ─────────────────────────────────────────

/**
 * Determine if a datetime string is an all-day date (YYYY-MM-DD) or
 * a timed event (contains T or time component).
 */
function isAllDayDate(dt: string): boolean {
  // YYYY-MM-DD without time
  return /^\d{4}-\d{2}-\d{2}$/.test(dt.trim());
}

/**
 * Ensure a datetime string is properly formatted.
 * Accepts: YYYY-MM-DD, YYYY-MM-DDTHH:mm, YYYY-MM-DDTHH:mm:ss
 * Returns the string normalized.
 */
function normalizeDateTime(dt: string): string {
  const trimmed = dt.trim();

  // Already ISO-like with time
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    // Ensure seconds
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed + ":00";
    }
    return trimmed;
  }

  // Date only
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

/**
 * For all-day events, Google Calendar API expects end date to be the
 * day AFTER the event (exclusive end).
 */
function getNextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * For timed events without an end time, default to 1 hour after start.
 */
function addOneHour(dateTimeStr: string): string {
  const d = new Date(dateTimeStr);
  if (isNaN(d.getTime())) {
    return dateTimeStr;
  }
  d.setHours(d.getHours() + 1);
  return d.toISOString().replace(/\.000Z$/, "");
}

// ─── Payload Builder ───────────────────────────────────────────

export function buildCalendarEventPayload(
  extraction: GeminiExtraction,
  timeZone: string = "Asia/Tokyo"
): GoogleCalendarEventPayload {
  // Use calendar_event if available, fallback to top-level fields
  const ce = extraction.calendar_event;
  const title = ce?.title || extraction.title || "LifeSnap Event";
  const startRaw = ce?.start || extraction.start_datetime || extraction.due_date || "";
  const endRaw = ce?.end || extraction.end_datetime || "";
  const location = ce?.location || extraction.location || "";

  // Build description
  const descParts: string[] = [];
  if (ce?.description) descParts.push(ce.description);
  if (extraction.summary && extraction.summary !== ce?.description) {
    descParts.push(extraction.summary);
  }
  if (extraction.amount && extraction.amount > 0) {
    descParts.push(`【金額】¥${extraction.amount.toLocaleString()}`);
  }
  if (extraction.issuer) {
    descParts.push(`【発行元】${extraction.issuer}`);
  }
  descParts.push("— Created by LifeSnap Action");
  const description = descParts.join("\n");

  // Determine start/end
  const startNormalized = normalizeDateTime(startRaw);
  const startIsAllDay = isAllDayDate(startNormalized);

  let start: GoogleCalendarEventPayload["start"];
  let end: GoogleCalendarEventPayload["end"];

  if (startIsAllDay) {
    const endDate = endRaw && isAllDayDate(normalizeDateTime(endRaw))
      ? getNextDay(normalizeDateTime(endRaw))
      : getNextDay(startNormalized);
    start = { date: startNormalized };
    end = { date: endDate };
  } else {
    start = { dateTime: startNormalized, timeZone };
    if (endRaw && !isAllDayDate(normalizeDateTime(endRaw))) {
      end = { dateTime: normalizeDateTime(endRaw), timeZone };
    } else {
      end = { dateTime: addOneHour(startNormalized), timeZone };
    }
  }

  const hash = generateEventHash({
    summary: title,
    location,
    start,
  });

  return {
    summary: title,
    description,
    location,
    start,
    end,
    extendedProperties: {
      private: {
        lifesnap_draft_hash: hash,
      },
    },
  };
}

// ─── Calendar API Client ───────────────────────────────────────

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export async function checkForDuplicateEvent(
  accessToken: string,
  hash: string
): Promise<CalendarEventResult | null> {
  const url = `${CALENDAR_API_BASE}/calendars/primary/events?privateExtendedProperty=lifesnap_draft_hash%3D${hash}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    console.warn("Failed to check for duplicate event:", await response.text());
    return null;
  }

  const data = (await response.json()) as { items?: Array<{ id: string; htmlLink: string }> };
  if (data.items && data.items.length > 0) {
    return {
      eventId: data.items[0].id,
      htmlLink: data.items[0].htmlLink,
    };
  }

  return null;
}


export async function createCalendarEvent(
  accessToken: string,
  payload: GoogleCalendarEventPayload
): Promise<CalendarEventResult> {
  const response = await fetch(
    `${CALENDAR_API_BASE}/calendars/primary/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `Calendar API error (${response.status}): ${errBody}`
    );
  }

  const data = (await response.json()) as { id: string; htmlLink: string };
  return {
    eventId: data.id,
    htmlLink: data.htmlLink,
  };
}

// ─── OAuth Token Exchange ──────────────────────────────────────

export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ access_token: string; expires_in: number }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Token exchange error (${response.status}): ${errBody}`);
  }

  return response.json() as Promise<{ access_token: string; expires_in: number }>;
}
