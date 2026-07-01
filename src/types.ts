import type { GeminiExtraction } from "./shared/gemini-schema";

// Re-export the shared type for frontend convenience
export type { GeminiExtraction };

export type ScreenType =
  | "LOGIN"
  | "SCAN"
  | "PROCESSING"
  | "REVIEW"
  | "EDIT"
  | "SUCCESS"
  | "ERROR"
  | "ACCOUNT"
  | "NO_ACTION";

export interface UserProfile {
  googleId: string;
  name: string;
  email: string;
  avatar: string;
  calendarLinked: boolean;
  calendarAccessToken?: string;
}

export interface CalendarEventResult {
  eventId: string;
  htmlLink: string;
}
