export type QuotaScope =
  | { kind: "v2"; installationHash: string }
  | { kind: "legacy" };

export type QuotaDeniedCode =
  | "INSTALL_RATE_LIMITED"
  | "INSTALL_DAILY_LIMITED"
  | "SERVICE_DAILY_LIMITED";

export type QuotaDecision =
  | {
      allowed: true;
      crossedThreshold?: 70 | 90 | 100;
    }
  | {
      allowed: false;
      code: QuotaDeniedCode;
      retryAfterSeconds: number;
    };

export type QuotaPolicy = {
  readonly installPerMinute: number;
  readonly installPerDay: number;
  readonly v2PerDay: number;
  readonly legacyPerDay: number;
};

export const PRODUCTION_QUOTA_POLICY: QuotaPolicy = Object.freeze({
  installPerMinute: 5,
  installPerDay: 20,
  v2PerDay: 500,
  legacyPerDay: 50,
});

export interface QuotaStore {
  consume(scope: QuotaScope, now: Date): Promise<QuotaDecision>;
}
