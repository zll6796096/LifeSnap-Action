import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_QUOTA_POLICY,
  type QuotaPolicy,
  type QuotaScope,
} from "../contracts";
import { FirestoreQuotaStore } from "../firestore-quota-store";

type DocumentData = Record<string, unknown>;

class MemoryDocumentReference {
  constructor(readonly path: string) {}
}

class MemoryDocumentSnapshot {
  constructor(
    readonly exists: boolean,
    private readonly value: DocumentData | undefined,
  ) {}

  data(): DocumentData | undefined {
    return this.value;
  }
}

class MemoryTransaction {
  private readonly writes: Array<{
    ref: MemoryDocumentReference;
    data: DocumentData;
    merge: boolean;
  }> = [];

  constructor(private readonly documents: Map<string, DocumentData>) {}

  async getAll(...refs: MemoryDocumentReference[]) {
    return refs.map((ref) => {
      const value = this.documents.get(ref.path);
      return new MemoryDocumentSnapshot(value !== undefined, value);
    });
  }

  set(
    ref: MemoryDocumentReference,
    data: DocumentData,
    options?: { merge?: boolean },
  ): this {
    this.writes.push({ ref, data, merge: options?.merge === true });
    return this;
  }

  commit(): void {
    for (const write of this.writes) {
      const previous = this.documents.get(write.ref.path);
      this.documents.set(
        write.ref.path,
        write.merge ? { ...previous, ...write.data } : write.data,
      );
    }
  }
}

class MemoryFirestore {
  private readonly documents = new Map<string, DocumentData>();
  transactionCalls = 0;

  collection(collectionPath: string) {
    return {
      doc: (documentPath: string) =>
        new MemoryDocumentReference(`${collectionPath}/${documentPath}`),
    };
  }

  async runTransaction<T>(
    callback: (transaction: MemoryTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    const transaction = new MemoryTransaction(this.documents);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }

  seed(path: string, data: DocumentData): void {
    this.documents.set(path, data);
  }

  delete(path: string): void {
    this.documents.delete(path);
  }

  raw(path: string): DocumentData | undefined {
    return this.documents.get(path);
  }

  paths(): string[] {
    return [...this.documents.keys()].sort();
  }

  asFirestore(): Firestore {
    return this as unknown as Firestore;
  }
}

const NOW = new Date("2026-07-31T01:02:34.567Z");
const INSTALLATION_HASH = "a".repeat(64);
const V2_SCOPE: QuotaScope = {
  kind: "v2",
  installationHash: INSTALLATION_HASH,
};
const LEGACY_SCOPE: QuotaScope = { kind: "legacy" };
const EPOCH_MINUTE = Math.floor(NOW.getTime() / 60_000);
const TOKYO_DAY = "2026-07-31";
const MINUTE_PATH = `install_minute/${INSTALLATION_HASH}:${EPOCH_MINUTE}`;
const INSTALL_DAY_PATH = `install_day/${INSTALLATION_HASH}:${TOKYO_DAY}`;
const V2_SERVICE_PATH = `service_day/v2:${TOKYO_DAY}`;
const LEGACY_SERVICE_PATH = `service_day/legacy:${TOKYO_DAY}`;
const POLICY_FIELDS: ReadonlyArray<keyof QuotaPolicy> = [
  "installPerMinute",
  "installPerDay",
  "v2PerDay",
  "legacyPerDay",
];
const INVALID_POLICY_VALUES = [
  { label: "zero", value: 0 },
  { label: "negative", value: -1 },
  { label: "fractional", value: 1.5 },
  { label: "NaN", value: Number.NaN },
  { label: "Infinity", value: Number.POSITIVE_INFINITY },
  { label: "unsafe integer", value: Number.MAX_SAFE_INTEGER + 1 },
];
const INVALID_POLICY_CASES = POLICY_FIELDS.flatMap((field) =>
  INVALID_POLICY_VALUES.map(({ label, value }) => ({ field, label, value })),
);

function createStore(
  policy: QuotaPolicy = PRODUCTION_QUOTA_POLICY,
): { db: MemoryFirestore; store: FirestoreQuotaStore } {
  const db = new MemoryFirestore();
  return {
    db,
    store: new FirestoreQuotaStore(db.asFirestore(), policy),
  };
}

function countAt(db: MemoryFirestore, path: string): unknown {
  return db.raw(path)?.count;
}

function millisecondsAt(
  db: MemoryFirestore,
  path: string,
  field: string,
): number | undefined {
  const value = db.raw(path)?.[field];
  return value instanceof Timestamp ? value.toMillis() : undefined;
}

describe("FirestoreQuotaStore", () => {
  it("freezes the production quota policy", () => {
    expect(Object.isFrozen(PRODUCTION_QUOTA_POLICY)).toBe(true);
  });

  it.each([
    {
      label: "raw UUID",
      installationHash: "e8b18b25-64a6-4af9-b31f-9b0b6d3c3d4e",
    },
    { label: "uppercase hex", installationHash: "A".repeat(64) },
    { label: "short hex", installationHash: "a".repeat(63) },
    {
      label: "slash-containing value",
      installationHash: `${"a".repeat(32)}/${"b".repeat(31)}`,
    },
  ])(
    "rejects a $label installation hash before starting a transaction",
    async ({ installationHash }) => {
      const { db, store } = createStore();

      await expect(
        store.consume({ kind: "v2", installationHash }, NOW),
      ).rejects.toThrow(new Error("INSTALLATION_HASH_INVALID"));

      expect(db.transactionCalls).toBe(0);
      expect(db.paths()).toEqual([]);
    },
  );

  it.each(INVALID_POLICY_CASES)(
    "rejects a $label $field policy before starting a transaction",
    ({ field, value }) => {
      const db = new MemoryFirestore();
      const policy = {
        ...PRODUCTION_QUOTA_POLICY,
        [field]: value,
      };

      expect(
        () => new FirestoreQuotaStore(db.asFirestore(), policy),
      ).toThrow(new Error("QUOTA_POLICY_INVALID"));
      expect(db.transactionCalls).toBe(0);
      expect(db.paths()).toEqual([]);
    },
  );

  it("snapshots caller-owned policy so later mutation cannot weaken the cap", async () => {
    const callerPolicy = {
      installPerMinute: 1,
      installPerDay: 20,
      v2PerDay: 500,
      legacyPerDay: 50,
    };
    const { db, store } = createStore(callerPolicy);
    callerPolicy.installPerMinute = 2;

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: true,
    });
    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: false,
      code: "INSTALL_RATE_LIMITED",
      retryAfterSeconds: 26,
    });
    expect(countAt(db, MINUTE_PATH)).toBe(1);
  });

  it("computes threshold crossings exactly for very large safe integers", async () => {
    const maximumSafePolicy: QuotaPolicy = {
      installPerMinute: Number.MAX_SAFE_INTEGER,
      installPerDay: Number.MAX_SAFE_INTEGER,
      v2PerDay: Number.MAX_SAFE_INTEGER,
      legacyPerDay: Number.MAX_SAFE_INTEGER,
    };
    const { db, store } = createStore(maximumSafePolicy);
    db.seed(V2_SERVICE_PATH, { count: 6_305_039_478_318_693 });

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: true,
      crossedThreshold: 70,
    });
    expect(countAt(db, V2_SERVICE_PATH)).toBe(6_305_039_478_318_694);
  });

  it("allows the fifth minute request and rejects the sixth with Retry-After", async () => {
    const { db, store } = createStore();
    db.seed(MINUTE_PATH, { count: 4 });

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: true,
    });
    expect(countAt(db, MINUTE_PATH)).toBe(5);

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: false,
      code: "INSTALL_RATE_LIMITED",
      retryAfterSeconds: 26,
    });
    expect(countAt(db, MINUTE_PATH)).toBe(5);
    expect(countAt(db, INSTALL_DAY_PATH)).toBe(1);
    expect(countAt(db, V2_SERVICE_PATH)).toBe(1);
  });

  it("allows the twentieth install-day request and rejects the twenty-first", async () => {
    const { db, store } = createStore();
    db.seed(INSTALL_DAY_PATH, { count: 19 });

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: true,
    });
    expect(countAt(db, INSTALL_DAY_PATH)).toBe(20);

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: false,
      code: "INSTALL_DAILY_LIMITED",
      retryAfterSeconds: 50_246,
    });
    expect(countAt(db, MINUTE_PATH)).toBe(1);
    expect(countAt(db, INSTALL_DAY_PATH)).toBe(20);
    expect(countAt(db, V2_SERVICE_PATH)).toBe(1);
  });

  it("allows the 500th v2 service request at threshold 100 and rejects the 501st", async () => {
    const { db, store } = createStore();
    db.seed(V2_SERVICE_PATH, { count: 499 });

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: true,
      crossedThreshold: 100,
    });
    expect(countAt(db, V2_SERVICE_PATH)).toBe(500);

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: false,
      code: "SERVICE_DAILY_LIMITED",
      retryAfterSeconds: 50_246,
    });
    expect(countAt(db, MINUTE_PATH)).toBe(1);
    expect(countAt(db, INSTALL_DAY_PATH)).toBe(1);
    expect(countAt(db, V2_SERVICE_PATH)).toBe(500);
  });

  it("allows the 50th legacy request at threshold 100 and rejects the 51st", async () => {
    const { db, store } = createStore();
    db.seed(LEGACY_SERVICE_PATH, { count: 49 });

    await expect(store.consume(LEGACY_SCOPE, NOW)).resolves.toEqual({
      allowed: true,
      crossedThreshold: 100,
    });
    expect(countAt(db, LEGACY_SERVICE_PATH)).toBe(50);

    await expect(store.consume(LEGACY_SCOPE, NOW)).resolves.toEqual({
      allowed: false,
      code: "SERVICE_DAILY_LIMITED",
      retryAfterSeconds: 50_246,
    });
    expect(countAt(db, LEGACY_SERVICE_PATH)).toBe(50);
  });

  it("queues no partial writes when any boundary is already exhausted", async () => {
    const { db, store } = createStore();
    db.seed(INSTALL_DAY_PATH, { count: 20, marker: "unchanged" });

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toMatchObject({
      allowed: false,
      code: "INSTALL_DAILY_LIMITED",
    });

    expect(db.raw(MINUTE_PATH)).toBeUndefined();
    expect(db.raw(INSTALL_DAY_PATH)).toEqual({
      count: 20,
      marker: "unchanged",
    });
    expect(db.raw(V2_SERVICE_PATH)).toBeUndefined();
  });

  it("uses minute then install-day then service-day denial precedence without writes", async () => {
    const { db, store } = createStore();
    db.seed(MINUTE_PATH, { count: 5, marker: "minute" });
    db.seed(INSTALL_DAY_PATH, { count: 20, marker: "install-day" });
    db.seed(V2_SERVICE_PATH, { count: 500, marker: "service-day" });

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toMatchObject({
      allowed: false,
      code: "INSTALL_RATE_LIMITED",
    });
    expect(db.raw(MINUTE_PATH)).toEqual({ count: 5, marker: "minute" });
    expect(db.raw(INSTALL_DAY_PATH)).toEqual({
      count: 20,
      marker: "install-day",
    });
    expect(db.raw(V2_SERVICE_PATH)).toEqual({
      count: 500,
      marker: "service-day",
    });

    db.delete(MINUTE_PATH);
    await expect(store.consume(V2_SCOPE, NOW)).resolves.toMatchObject({
      allowed: false,
      code: "INSTALL_DAILY_LIMITED",
    });
    expect(db.raw(MINUTE_PATH)).toBeUndefined();
    expect(db.raw(INSTALL_DAY_PATH)).toEqual({
      count: 20,
      marker: "install-day",
    });
    expect(db.raw(V2_SERVICE_PATH)).toEqual({
      count: 500,
      marker: "service-day",
    });

    db.delete(INSTALL_DAY_PATH);
    await expect(store.consume(V2_SCOPE, NOW)).resolves.toMatchObject({
      allowed: false,
      code: "SERVICE_DAILY_LIMITED",
    });
    expect(db.raw(MINUTE_PATH)).toBeUndefined();
    expect(db.raw(INSTALL_DAY_PATH)).toBeUndefined();
    expect(db.raw(V2_SERVICE_PATH)).toEqual({
      count: 500,
      marker: "service-day",
    });
  });

  it("writes only the documents belonging to the selected scope", async () => {
    const legacy = createStore();
    await legacy.store.consume(LEGACY_SCOPE, NOW);
    expect(legacy.db.paths()).toEqual([LEGACY_SERVICE_PATH]);

    const v2 = createStore();
    await v2.store.consume(V2_SCOPE, NOW);
    expect(v2.db.paths()).toEqual(
      [MINUTE_PATH, INSTALL_DAY_PATH, V2_SERVICE_PATH].sort(),
    );
    expect(v2.db.raw(LEGACY_SERVICE_PATH)).toBeUndefined();
  });

  it.each([
    { priorCount: 349, threshold: 70 as const },
    { priorCount: 449, threshold: 90 as const },
    { priorCount: 499, threshold: 100 as const },
  ])(
    "reports threshold $threshold exactly once when advancing from $priorCount",
    async ({ priorCount, threshold }) => {
      const { db, store } = createStore();
      db.seed(V2_SERVICE_PATH, { count: priorCount });

      await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
        allowed: true,
        crossedThreshold: threshold,
      });

      const next = await store.consume(V2_SCOPE, NOW);
      if (threshold === 100) {
        expect(next).toEqual({
          allowed: false,
          code: "SERVICE_DAILY_LIMITED",
          retryAfterSeconds: 50_246,
        });
      } else {
        expect(next).toEqual({ allowed: true });
      }
    },
  );

  it("persists exact bucket, update, and expiry timestamps", async () => {
    const { db, store } = createStore();
    await store.consume(V2_SCOPE, NOW);

    expect(millisecondsAt(db, MINUTE_PATH, "bucket_start")).toBe(
      Date.parse("2026-07-31T01:02:00.000Z"),
    );
    expect(millisecondsAt(db, MINUTE_PATH, "updated_at")).toBe(NOW.getTime());
    expect(millisecondsAt(db, MINUTE_PATH, "expires_at")).toBe(
      Date.parse("2026-08-01T01:02:00.000Z"),
    );

    for (const path of [INSTALL_DAY_PATH, V2_SERVICE_PATH]) {
      expect(millisecondsAt(db, path, "bucket_start")).toBe(
        Date.parse("2026-07-30T15:00:00.000Z"),
      );
      expect(millisecondsAt(db, path, "updated_at")).toBe(NOW.getTime());
      expect(millisecondsAt(db, path, "expires_at")).toBe(
        Date.parse("2026-08-29T15:00:00.000Z"),
      );
    }
  });

  it("starts genuinely absent documents at zero", async () => {
    const { db, store } = createStore();
    db.delete(MINUTE_PATH);
    db.delete(INSTALL_DAY_PATH);
    db.delete(V2_SERVICE_PATH);

    await expect(store.consume(V2_SCOPE, NOW)).resolves.toEqual({
      allowed: true,
    });
    expect(countAt(db, MINUTE_PATH)).toBe(1);
    expect(countAt(db, INSTALL_DAY_PATH)).toBe(1);
    expect(countAt(db, V2_SERVICE_PATH)).toBe(1);
  });

  it.each([
    { label: "missing", data: {}, path: MINUTE_PATH },
    { label: "negative", data: { count: -1 }, path: INSTALL_DAY_PATH },
    { label: "fractional", data: { count: 1.5 }, path: V2_SERVICE_PATH },
    { label: "string", data: { count: "1" }, path: MINUTE_PATH },
    { label: "NaN", data: { count: Number.NaN }, path: INSTALL_DAY_PATH },
    {
      label: "unsafe integer",
      data: { count: Number.MAX_SAFE_INTEGER + 1 },
      path: V2_SERVICE_PATH,
    },
  ])(
    "rejects an existing $label counter and commits no writes",
    async ({ data, path }) => {
      const { db, store } = createStore();
      db.seed(path, { ...data, marker: "unchanged" });

      await expect(store.consume(V2_SCOPE, NOW)).rejects.toThrow(
        new Error("QUOTA_COUNTER_INVALID"),
      );

      expect(db.paths()).toEqual([path]);
      expect(db.raw(path)).toEqual({ ...data, marker: "unchanged" });
    },
  );
});
