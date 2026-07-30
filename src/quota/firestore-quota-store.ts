import {
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "@google-cloud/firestore";
import {
  buildQuotaBuckets,
  secondsUntilNextMinute,
  secondsUntilNextTokyoDay,
} from "./buckets";
import {
  PRODUCTION_QUOTA_POLICY,
  type QuotaDecision,
  type QuotaPolicy,
  type QuotaScope,
  type QuotaStore,
} from "./contracts";

const MINUTE_EXPIRY_MILLISECONDS = 24 * 60 * 60 * 1000;
const DAILY_EXPIRY_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const THRESHOLDS = [70, 90, 100] as const;

type CounterDocument = {
  count: number;
  bucket_start: Timestamp;
  updated_at: Timestamp;
  expires_at: Timestamp;
};

function readCount(snapshot: DocumentSnapshot): number {
  if (!snapshot.exists) {
    return 0;
  }

  const count = snapshot.data()?.count;
  if (
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 0
  ) {
    throw new Error("QUOTA_COUNTER_INVALID");
  }

  return count;
}

function counterDocument(
  count: number,
  bucketStart: Date,
  now: Date,
  expiryMilliseconds: number,
): CounterDocument {
  return {
    count,
    bucket_start: Timestamp.fromDate(bucketStart),
    updated_at: Timestamp.fromDate(now),
    expires_at: Timestamp.fromMillis(
      bucketStart.getTime() + expiryMilliseconds,
    ),
  };
}

function crossedThreshold(
  previousCount: number,
  nextCount: number,
  limit: number,
): 70 | 90 | 100 | undefined {
  return THRESHOLDS.find(
    (threshold) =>
      previousCount * 100 < limit * threshold &&
      nextCount * 100 >= limit * threshold,
  );
}

export class FirestoreQuotaStore implements QuotaStore {
  constructor(
    private readonly db: Firestore,
    private readonly policy: QuotaPolicy = PRODUCTION_QUOTA_POLICY,
  ) {}

  async consume(scope: QuotaScope, now: Date): Promise<QuotaDecision> {
    const buckets = buildQuotaBuckets(now);

    return this.db.runTransaction(async (transaction) => {
      if (scope.kind === "legacy") {
        return this.consumeLegacy(
          transaction,
          buckets.tokyoDay,
          buckets.tokyoDayStart,
          now,
        );
      }

      return this.consumeV2(
        transaction,
        scope.installationHash,
        buckets,
        now,
      );
    });
  }

  private async consumeLegacy(
    transaction: Transaction,
    tokyoDay: string,
    tokyoDayStart: Date,
    now: Date,
  ): Promise<QuotaDecision> {
    const serviceRef = this.db
      .collection("service_day")
      .doc(`legacy:${tokyoDay}`);
    const [serviceSnapshot] = await transaction.getAll(serviceRef);
    const serviceCount = readCount(serviceSnapshot);

    if (serviceCount >= this.policy.legacyPerDay) {
      return {
        allowed: false,
        code: "SERVICE_DAILY_LIMITED",
        retryAfterSeconds: secondsUntilNextTokyoDay(now),
      };
    }

    const nextServiceCount = serviceCount + 1;
    transaction.set(
      serviceRef,
      counterDocument(
        nextServiceCount,
        tokyoDayStart,
        now,
        DAILY_EXPIRY_MILLISECONDS,
      ),
      { merge: true },
    );

    return this.allowedDecision(
      serviceCount,
      nextServiceCount,
      this.policy.legacyPerDay,
    );
  }

  private async consumeV2(
    transaction: Transaction,
    installationHash: string,
    buckets: ReturnType<typeof buildQuotaBuckets>,
    now: Date,
  ): Promise<QuotaDecision> {
    const minuteRef = this.db
      .collection("install_minute")
      .doc(`${installationHash}:${buckets.epochMinute}`);
    const installDayRef = this.db
      .collection("install_day")
      .doc(`${installationHash}:${buckets.tokyoDay}`);
    const serviceRef = this.db
      .collection("service_day")
      .doc(`v2:${buckets.tokyoDay}`);
    const [minuteSnapshot, installDaySnapshot, serviceSnapshot] =
      await transaction.getAll(minuteRef, installDayRef, serviceRef);
    const minuteCount = readCount(minuteSnapshot);
    const installDayCount = readCount(installDaySnapshot);
    const serviceCount = readCount(serviceSnapshot);

    if (minuteCount >= this.policy.installPerMinute) {
      return {
        allowed: false,
        code: "INSTALL_RATE_LIMITED",
        retryAfterSeconds: secondsUntilNextMinute(now),
      };
    }
    if (installDayCount >= this.policy.installPerDay) {
      return {
        allowed: false,
        code: "INSTALL_DAILY_LIMITED",
        retryAfterSeconds: secondsUntilNextTokyoDay(now),
      };
    }
    if (serviceCount >= this.policy.v2PerDay) {
      return {
        allowed: false,
        code: "SERVICE_DAILY_LIMITED",
        retryAfterSeconds: secondsUntilNextTokyoDay(now),
      };
    }

    transaction.set(
      minuteRef,
      counterDocument(
        minuteCount + 1,
        buckets.minuteStart,
        now,
        MINUTE_EXPIRY_MILLISECONDS,
      ),
      { merge: true },
    );
    transaction.set(
      installDayRef,
      counterDocument(
        installDayCount + 1,
        buckets.tokyoDayStart,
        now,
        DAILY_EXPIRY_MILLISECONDS,
      ),
      { merge: true },
    );
    const nextServiceCount = serviceCount + 1;
    transaction.set(
      serviceRef,
      counterDocument(
        nextServiceCount,
        buckets.tokyoDayStart,
        now,
        DAILY_EXPIRY_MILLISECONDS,
      ),
      { merge: true },
    );

    return this.allowedDecision(
      serviceCount,
      nextServiceCount,
      this.policy.v2PerDay,
    );
  }

  private allowedDecision(
    previousServiceCount: number,
    nextServiceCount: number,
    limit: number,
  ): QuotaDecision {
    const threshold = crossedThreshold(
      previousServiceCount,
      nextServiceCount,
      limit,
    );
    return threshold === undefined
      ? { allowed: true }
      : { allowed: true, crossedThreshold: threshold };
  }
}
