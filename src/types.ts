export interface EventDetails {
  title: string;
  date: string;
  time: string;
  amount: number;
  issuer: string;
  location: string;
  notes: string;
  hasEvent: boolean;
}

export type ScreenType =
  | "LOGIN"
  | "SCAN"
  | "PROCESSING"
  | "REVIEW"
  | "EDIT"
  | "SUCCESS"
  | "ERROR"
  | "ACCOUNT";

export interface UserProfile {
  googleId: string;
  name: string;
  email: string;
  avatar: string;
  calendarLinked: boolean;
}
