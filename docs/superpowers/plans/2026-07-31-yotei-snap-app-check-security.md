# Yotei Snap App Check Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect Build 4 image extraction with Firebase App Check/App Attest, exact cross-instance quotas, and a least-privilege Cloud Run runtime while preserving the current URL and Build 3 compatibility window.

**Architecture:** Build 4 sends a limited-use App Check token and Keychain installation UUID to `POST /api/v2/extract`. Cloud Run consumes the token, HMACs the installation UUID, atomically reserves Firestore quota, and only then invokes Gemini; Build 3 remains on `/api/extract` behind a separate 50-call daily cap. A dedicated runtime service account can read only two named secrets, consume App Check tokens, and access the named quota database.

**Tech Stack:** Swift 5.9 / SwiftUI / Firebase Apple SDK 12.17.0 / App Attest / Keychain, Node.js 20 / TypeScript / Express / Vitest / Firebase Admin 13.10.0 / Firestore 7.11.6, Cloud Run / Cloud Build / Secret Manager / IAM.

---

## First-principles execution contract

- **Real objective:** prevent anonymous or replayed extraction abuse without
  breaking the released Build 3, changing the public URL, or weakening the
  existing consent and privacy boundaries.
- **Relevant rule:** risk control and verifiable evidence come before rollout;
  a healthy process or attractive UI is not security acceptance.
- **Minimal verifiable deliverable:** one backward-compatible backend revision
  with protected v2, capped legacy, exact cross-instance quotas, dedicated
  runtime identity, and one physical Release-device App Attest proof before
  traffic promotion.
- **Likely files:** only the backend, iOS security/client configuration, focused
  tests, release scripts, and sanitized release/verification documents listed
  below.
- **Explicitly out of scope:** product name/icon/UI changes, prompt/model/schema
  changes, App Store upload/submission, automatic legacy shutdown, Cloud Armor,
  Firebase Analytics/Auth/Crashlytics, cleanup of unrelated default service
  account roles, and service-account JSON keys.
- **Acceptance:** Gates A through E below pass with exact revisions, traffic,
  IAM, token replay, quota, privacy, and Git evidence; skipped or failed checks
  remain visible and block the next mutation.
- **Risks and guardrails:** App Check token consumption is a replay-protection
  dependency and remains fail-closed; Firestore is transactional; negative
  requests must not reach Gemini; production promotion is conditional and
  ownership-safe; no secret, token, image, installation identifier, extracted
  content, or raw Gemini response enters logs or evidence.
- **Verification commands:** each task gives the exact focused command first,
  then the complete backend/iOS/emulator/release/Git gates before any
  infrastructure or traffic change.

---

## Source specification and fixed decisions

Implement against:

`docs/superpowers/specs/2026-07-31-yotei-snap-app-check-security-design.md`

The following values are immutable within this plan:

| Item | Required value |
| --- | --- |
| GCP/Firebase project | `zhang23-23` |
| Cloud Run service | `lifesnap-action` |
| Cloud Run region | `asia-northeast1` |
| Public base URL | `https://lifesnap-action-sxielk4wua-an.a.run.app` |
| Bundle ID | `com.zll.lifesnapaction` |
| Build 4 route | `/api/v2/extract` |
| Build 3 route | `/api/extract` |
| Firestore database | `lifesnap-quota` in `asia-northeast1` |
| Runtime service account | `lifesnap-runtime@zhang23-23.iam.gserviceaccount.com` |
| HMAC secret | `lifesnap-installation-hmac-key` |
| v2 installation limit | 5/minute and 20/Asia-Tokyo day |
| v2 global limit | 500/Asia-Tokyo day |
| legacy global limit | 50/Asia-Tokyo day |
| App Check token TTL | 3600 seconds |

Do not change the product name, icon, Gemini prompt/model, extraction success schema, calendar behavior, Bundle ID, current public URL, or App Store state.

## File responsibility map

### Backend

- `src/security/installation-id.ts` — canonical UUID validation and HMAC-SHA256.
- `src/security/app-check.ts` — App Check header verification, app allowlist, replay handling, and stable failures.
- `src/quota/buckets.ts` — deterministic minute and Asia/Tokyo day bucket calculations.
- `src/quota/contracts.ts` — quota scope, decision, and store interfaces.
- `src/quota/firestore-quota-store.ts` — exact Firestore transaction implementation.
- `src/extraction/extraction-service.ts` — the existing Gemini request/schema validation, independent of HTTP and security.
- `src/runtime/firebase.ts` — production Firebase Admin/App Check/Firestore construction through ADC.
- `server.ts` — route ordering, dependency composition, stable HTTP errors, no-store, and safe logs.

### iOS

- `ios/LifeSnapAction/Services/AppCheckBootstrap.swift` — Debug versus App Attest provider selection and Firebase startup.
- `ios/LifeSnapAction/Services/AppCheckTokenProvider.swift` — limited-use token retrieval.
- `ios/LifeSnapAction/Services/InstallationIdentifierStore.swift` — Keychain UUID lifecycle.
- `ios/LifeSnapAction/Services/APIClient.swift` — v2 request, headers, one bounded token refresh, and Japanese error mapping.
- `ios/LifeSnapAction/LifeSnapAction.entitlements` — production App Attest entitlement.
- `ios/LifeSnapAction/GoogleService-Info.plist` — Firebase app configuration for the existing project and bundle.
- `ios/project.yml` and generated `ios/LifeSnapAction.xcodeproj/project.pbxproj` — pinned Firebase package and capability wiring.

### Release and evidence

- `scripts/promote-and-verify.sh` — zero-traffic candidate creation and non-secret candidate checks; no automatic promotion.
- `scripts/promote-verified-candidate.sh` — exact-candidate conditional promotion after recorded real-device evidence.
- `src/shared/__tests__/cloudbuild-contract.test.ts` — candidate/promotion ownership and rollback contract.
- `scripts/validate-yotei-snap-release.sh` — static Release/App Attest contract.
- `docs/release/yotei-snap-v1.1-app-store-release-gate.md` — append-only sanitized gate evidence.
- `docs/verification/yotei-snap-security/` — sanitized security evidence; never tokens, images, OCR, or extracted text.

## Execution gates

| Gate | Required evidence | Mutation allowed after pass |
| --- | --- | --- |
| A — Local | Unit, emulator, lint, build, Release contract, Git diff | Firebase/IAM provisioning |
| B — Infrastructure | Exact app, App Attest, database, TTL, secrets, conditional IAM | Zero-traffic candidate |
| C — Candidate | Exact image/runtime, public routes, negative App Check, legacy smoke | Real-device candidate smoke |
| D — Device | Release/App Attest valid v2 request and replay rejection | Production traffic cutover |
| E — Production | 100% exact revision, valid v2, negative v2, bounded legacy, safe logs | Mark backend security PASS |

No gate can be replaced by `/health`, simulator Debug Provider, a local mock, or a permissive production fallback.

### Task 1: Record the clean baseline

**Files:**
- Read: `package.json`
- Read: `server.ts`
- Read: `ios/project.yml`
- Read: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`
- No file changes

- [ ] **Step 1: Confirm the exact worktree and clean scope**

Run:

```bash
pwd
git rev-parse --show-toplevel
git status --short --branch
git log -1 --oneline
```

Expected:

- top level is `.worktrees/lifesnap-apple-native-ui`;
- branch is `codex/lifesnap-apple-native-ui`;
- no uncommitted files exist before implementation;
- HEAD contains the approved design and plan commits.

- [ ] **Step 2: Run the existing backend baseline**

Run:

```bash
npm test
npm run lint
npm run build
npm run validate:ios-release
```

Expected: 30 existing Vitest tests pass, type-check/build exit 0, and all current release-contract checks pass.

- [ ] **Step 3: Run the existing iOS baseline**

Resolve one available `LifeSnap iPhone 15` simulator and run:

```bash
simulator_udid="$(
  xcrun simctl list devices available -j |
    jq -r '
      [.devices[][] | select(.name == "LifeSnap iPhone 15") | .udid]
      | if length == 1 then .[0] else error("expected exactly one LifeSnap iPhone 15") end
    '
)"

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${simulator_udid}" \
  -derivedDataPath /tmp/yotei-security-baseline \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet
```

Expected: 12 existing iOS tests pass. If the named simulator is absent or duplicated, stop and report the observed device inventory; do not silently use a different acceptance device.

### Task 2: Add deterministic installation hashing and quota buckets

**Files:**
- Create: `src/security/installation-id.ts`
- Create: `src/security/__tests__/installation-id.test.ts`
- Create: `src/quota/buckets.ts`
- Create: `src/quota/__tests__/buckets.test.ts`

- [ ] **Step 1: Write failing installation-ID tests**

Create tests covering canonicalization, rejection, key separation, and non-disclosure:

```ts
import { describe, expect, it } from "vitest";
import {
  canonicalizeInstallationId,
  hashInstallationId,
} from "../installation-id";

describe("installation identifier", () => {
  const id = "E8B18B25-64A6-4AF9-B31F-9B0B6D3C3D4E";
  const keyOne = "1".repeat(32);
  const keyTwo = "2".repeat(32);

  it("canonicalizes a UUID without retaining the source in the digest", () => {
    expect(canonicalizeInstallationId(id)).toBe(id.toLowerCase());
    const digest = hashInstallationId(id, keyOne);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(id.toLowerCase());
  });

  it("rejects non-UUID identifiers", () => {
    expect(() => canonicalizeInstallationId("device-123")).toThrow(
      "INSTALLATION_ID_INVALID",
    );
  });

  it("uses a keyed digest", () => {
    expect(hashInstallationId(id, keyOne)).not.toBe(
      hashInstallationId(id, keyTwo),
    );
  });

  it("rejects a short HMAC key", () => {
    expect(() => hashInstallationId(id, "too-short")).toThrow(
      "INSTALLATION_HMAC_KEY must contain at least 32 characters",
    );
  });
});
```

- [ ] **Step 2: Write failing bucket tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildQuotaBuckets,
  secondsUntilNextTokyoDay,
} from "../buckets";

describe("quota buckets", () => {
  it("uses Asia/Tokyo for the daily key", () => {
    const beforeMidnight = new Date("2026-07-31T14:59:59.000Z");
    const afterMidnight = new Date("2026-07-31T15:00:00.000Z");
    expect(buildQuotaBuckets(beforeMidnight).tokyoDay).toBe("2026-07-31");
    expect(buildQuotaBuckets(afterMidnight).tokyoDay).toBe("2026-08-01");
  });

  it("uses UTC epoch minutes for exact minute windows", () => {
    const result = buildQuotaBuckets(new Date("2026-07-31T01:02:59.999Z"));
    expect(result.epochMinute).toBe(Math.floor(Date.parse("2026-07-31T01:02:00Z") / 60_000));
  });

  it("returns Retry-After to the next Tokyo day", () => {
    expect(secondsUntilNextTokyoDay(new Date("2026-07-31T14:59:59Z"))).toBe(1);
  });
});
```

- [ ] **Step 3: Verify the new tests fail**

Run:

```bash
npx vitest run \
  src/security/__tests__/installation-id.test.ts \
  src/quota/__tests__/buckets.test.ts
```

Expected: FAIL because the two implementation modules do not exist.

- [ ] **Step 4: Implement canonical UUID and HMAC-SHA256**

Add:

```ts
import crypto from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InstallationIdentifierError extends Error {
  readonly code = "INSTALLATION_ID_INVALID";
}

export function canonicalizeInstallationId(value: string): string {
  const canonical = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(canonical)) {
    throw new InstallationIdentifierError("INSTALLATION_ID_INVALID");
  }
  return canonical;
}

export function hashInstallationId(value: string, hmacKey: string): string {
  if (hmacKey.length < 32) {
    throw new Error("INSTALLATION_HMAC_KEY must contain at least 32 characters");
  }
  return crypto
    .createHmac("sha256", hmacKey)
    .update(canonicalizeInstallationId(value), "utf8")
    .digest("hex");
}
```

- [ ] **Step 5: Implement deterministic bucket helpers**

Add:

```ts
const TOKYO_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;

function tokyoDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function buildQuotaBuckets(now: Date) {
  const { year, month, day } = tokyoDateParts(now);
  const minuteStart = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000,
  );
  const tokyoDayStart = new Date(
    Date.UTC(year, month - 1, day) - TOKYO_OFFSET_MILLISECONDS,
  );
  return {
    epochMinute: Math.floor(now.getTime() / 60_000),
    tokyoDay: [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0"),
    ].join("-"),
    minuteStart,
    tokyoDayStart,
  };
}

export function secondsUntilNextMinute(now: Date): number {
  return 60 - (Math.floor(now.getTime() / 1000) % 60);
}

export function secondsUntilNextTokyoDay(now: Date): number {
  const { year, month, day } = tokyoDateParts(now);
  const nextMidnightUtc =
    Date.UTC(year, month - 1, day + 1) - TOKYO_OFFSET_MILLISECONDS;
  return Math.max(1, Math.ceil((nextMidnightUtc - now.getTime()) / 1000));
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run \
  src/security/__tests__/installation-id.test.ts \
  src/quota/__tests__/buckets.test.ts
npm run lint
```

Expected: both test files pass and type-check exits 0.

- [ ] **Step 7: Commit**

```bash
git add \
  src/security/installation-id.ts \
  src/security/__tests__/installation-id.test.ts \
  src/quota/buckets.ts \
  src/quota/__tests__/buckets.test.ts
git commit -m "feat: add private quota identifiers"
```

### Task 3: Implement exact Firestore quota transactions

**Files:**
- Create: `src/quota/contracts.ts`
- Create: `src/quota/firestore-quota-store.ts`
- Create: `src/quota/__tests__/firestore-quota-store.test.ts`
- Create: `src/quota/__tests__/firestore-quota.integration.test.ts`
- Create: `firebase.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Pin backend and emulator dependencies**

Run:

```bash
npm install --save-exact \
  firebase-admin@13.10.0 \
  @google-cloud/firestore@7.11.6
npm install --save-dev --save-exact firebase-tools@15.25.0
```

Expected: `package.json` contains exact versions without `^` or `~`; `package-lock.json` changes only through npm.

- [ ] **Step 2: Write the quota contract**

```ts
export type QuotaScope =
  | { kind: "v2"; installationHash: string }
  | { kind: "legacy" };

export type QuotaDeniedCode =
  | "INSTALL_RATE_LIMITED"
  | "INSTALL_DAILY_LIMITED"
  | "SERVICE_DAILY_LIMITED";

export type QuotaDecision =
  | { allowed: true; crossedThreshold?: 70 | 90 | 100 }
  | {
      allowed: false;
      code: QuotaDeniedCode;
      retryAfterSeconds: number;
    };

export type QuotaPolicy = {
  installPerMinute: number;
  installPerDay: number;
  v2PerDay: number;
  legacyPerDay: number;
};

export const PRODUCTION_QUOTA_POLICY: QuotaPolicy = {
  installPerMinute: 5,
  installPerDay: 20,
  v2PerDay: 500,
  legacyPerDay: 50,
};

export interface QuotaStore {
  consume(scope: QuotaScope, now: Date): Promise<QuotaDecision>;
}
```

- [ ] **Step 3: Write failing unit tests around exact edges**

Use an injected transaction adapter so the tests can assert:

```ts
it("allows the 500th v2 call and rejects the 501st", async () => {
  const store = makeTestStore({
    policy: { installPerMinute: 999, installPerDay: 999, v2PerDay: 500, legacyPerDay: 50 },
    counts: { installMinute: 499, installDay: 499, serviceDay: 499 },
  });
  await expect(store.consume(v2Scope, now)).resolves.toEqual({
    allowed: true,
    crossedThreshold: 100,
  });
  await expect(store.consume(v2Scope, now)).resolves.toMatchObject({
    allowed: false,
    code: "SERVICE_DAILY_LIMITED",
  });
});

it("never writes a partial set when one boundary is exhausted", async () => {
  const store = makeTestStore({
    policy: { installPerMinute: 5, installPerDay: 20, v2PerDay: 500, legacyPerDay: 50 },
    counts: { installMinute: 5, installDay: 3, serviceDay: 3 },
  });
  await store.consume(v2Scope, now);
  expect(store.snapshot()).toEqual({
    installMinute: 5,
    installDay: 3,
    serviceDay: 3,
  });
});

it.each([
  [349, 70],
  [449, 90],
  [499, 100],
] as const)(
  "reports the %i%% v2 global threshold exactly on the crossing",
  async (serviceDay, threshold) => {
    const store = makeTestStore({
      policy: {
        installPerMinute: 999,
        installPerDay: 999,
        v2PerDay: 500,
        legacyPerDay: 50,
      },
      counts: { installMinute: 0, installDay: 0, serviceDay },
    });
    await expect(store.consume(v2Scope, now)).resolves.toMatchObject({
      allowed: true,
      crossedThreshold: threshold,
    });
    const next = await store.consume(v2Scope, now);
    if (threshold === 100) {
      expect(next).toMatchObject({
        allowed: false,
        code: "SERVICE_DAILY_LIMITED",
      });
    } else {
      expect(next).toEqual({ allowed: true, crossedThreshold: undefined });
    }
  },
);
```

The same test file defines a complete in-memory Firestore-shaped adapter so failures are about quota behavior rather than missing helpers:

```ts
function makeTestStore(input: {
  policy: QuotaPolicy;
  counts: {
    installMinute: number;
    installDay: number;
    serviceDay: number;
  };
}) {
  const state = new Map<string, number>([
    ["install_minute", input.counts.installMinute],
    ["install_day", input.counts.installDay],
    ["service_day", input.counts.serviceDay],
  ]);
  const collectionFor = (path: string) => path.split("/")[0];
  const db = {
    collection(collection: string) {
      return {
        doc(id: string) {
          return { path: `${collection}/${id}` };
        },
      };
    },
    runTransaction<T>(
      run: (transaction: {
        getAll: (...refs: Array<{ path: string }>) => Promise<
          Array<{ data: () => { count: number } }>
        >;
        set: (
          ref: { path: string },
          data: { count: number },
          options: { merge: true },
        ) => void;
      }) => Promise<T>,
    ) {
      return run({
        getAll: async (...refs) =>
          refs.map((ref) => ({
            data: () => ({
              count: state.get(collectionFor(ref.path)) ?? 0,
            }),
          })),
        set: (ref, data) => {
          state.set(collectionFor(ref.path), data.count);
        },
      });
    },
  };
  const store = new FirestoreQuotaStore(
    db as unknown as Firestore,
    input.policy,
  );
  return {
    consume: store.consume.bind(store),
    snapshot: () => ({
      installMinute: state.get("install_minute"),
      installDay: state.get("install_day"),
      serviceDay: state.get("service_day"),
    }),
  };
}
```

Add explicit table-driven cases for:

- install minute count 4 → fifth allowed, then sixth rejected with
  `INSTALL_RATE_LIMITED`;
- install day count 19 → twentieth allowed, then twenty-first rejected with
  `INSTALL_DAILY_LIMITED`;
- v2 global count 499 → five-hundredth allowed, then five-hundred-first rejected
  with `SERVICE_DAILY_LIMITED`;
- legacy global count 49 → fiftieth allowed, then fifty-first rejected with
  `SERVICE_DAILY_LIMITED`;
- a legacy consume changes only `service_day/legacy:*`, while a v2 consume
  changes only its installation documents and `service_day/v2:*`.

- [ ] **Step 4: Verify quota tests fail**

Run:

```bash
npx vitest run src/quota/__tests__/firestore-quota-store.test.ts
```

Expected: FAIL because `FirestoreQuotaStore` and the test adapter are not implemented.

- [ ] **Step 5: Implement the Firestore transaction**

The production class must accept a `Firestore` instance so production uses the named database and tests use Emulator:

```ts
import {
  type DocumentReference,
  type Firestore,
  Timestamp,
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

type Counter = {
  ref: DocumentReference;
  count: number;
  limit: number;
  bucketStart: Date;
  deniedCode:
    | "INSTALL_RATE_LIMITED"
    | "INSTALL_DAILY_LIMITED"
    | "SERVICE_DAILY_LIMITED";
  retryAfterSeconds: number;
  expiresAt: Date;
};

export class FirestoreQuotaStore implements QuotaStore {
  constructor(
    private readonly db: Firestore,
    private readonly policy: QuotaPolicy = PRODUCTION_QUOTA_POLICY,
  ) {}

  async consume(scope: QuotaScope, now: Date): Promise<QuotaDecision> {
    const {
      epochMinute,
      tokyoDay,
      minuteStart,
      tokyoDayStart,
    } = buildQuotaBuckets(now);
    return this.db.runTransaction(async (transaction) => {
      const refs =
        scope.kind === "v2"
          ? [
              this.db.collection("install_minute").doc(
                `${scope.installationHash}:${epochMinute}`,
              ),
              this.db.collection("install_day").doc(
                `${scope.installationHash}:${tokyoDay}`,
              ),
              this.db.collection("service_day").doc(`v2:${tokyoDay}`),
            ]
          : [this.db.collection("service_day").doc(`legacy:${tokyoDay}`)];
      const snapshots = await transaction.getAll(...refs);
      const current = snapshots.map((snapshot) => {
        const value = snapshot.data()?.count;
        return Number.isInteger(value) && value >= 0 ? value : 0;
      });
      const minuteExpiry = new Date(
        minuteStart.getTime() + 24 * 60 * 60 * 1000,
      );
      const dayExpiry = new Date(
        tokyoDayStart.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      const counters: Counter[] =
        scope.kind === "v2"
          ? [
              {
                ref: refs[0],
                count: current[0],
                limit: this.policy.installPerMinute,
                bucketStart: minuteStart,
                deniedCode: "INSTALL_RATE_LIMITED",
                retryAfterSeconds: secondsUntilNextMinute(now),
                expiresAt: minuteExpiry,
              },
              {
                ref: refs[1],
                count: current[1],
                limit: this.policy.installPerDay,
                bucketStart: tokyoDayStart,
                deniedCode: "INSTALL_DAILY_LIMITED",
                retryAfterSeconds: secondsUntilNextTokyoDay(now),
                expiresAt: dayExpiry,
              },
              {
                ref: refs[2],
                count: current[2],
                limit: this.policy.v2PerDay,
                bucketStart: tokyoDayStart,
                deniedCode: "SERVICE_DAILY_LIMITED",
                retryAfterSeconds: secondsUntilNextTokyoDay(now),
                expiresAt: dayExpiry,
              },
            ]
          : [
              {
                ref: refs[0],
                count: current[0],
                limit: this.policy.legacyPerDay,
                bucketStart: tokyoDayStart,
                deniedCode: "SERVICE_DAILY_LIMITED",
                retryAfterSeconds: secondsUntilNextTokyoDay(now),
                expiresAt: dayExpiry,
              },
            ];

      const denied = counters.find((counter) => counter.count >= counter.limit);
      if (denied) {
        return {
          allowed: false,
          code: denied.deniedCode,
          retryAfterSeconds: denied.retryAfterSeconds,
        };
      }

      for (const counter of counters) {
        transaction.set(
          counter.ref,
          {
            count: counter.count + 1,
            bucket_start: Timestamp.fromDate(counter.bucketStart),
            updated_at: Timestamp.fromDate(now),
            expires_at: Timestamp.fromDate(counter.expiresAt),
          },
          { merge: true },
        );
      }

      const service = counters.at(-1)!;
      const previousPercent = Math.floor((service.count * 100) / service.limit);
      const nextPercent = Math.floor(((service.count + 1) * 100) / service.limit);
      const crossedThreshold = ([70, 90, 100] as const).find(
        (threshold) => previousPercent < threshold && nextPercent >= threshold,
      );
      return { allowed: true, crossedThreshold };
    });
  }
}
```

Add test assertions that `bucket_start` equals the exact UTC minute boundary for `install_minute` and Tokyo midnight for both daily collections.

- [ ] **Step 6: Configure and test the Firestore Emulator**

Add `firebase.json`:

```json
{
  "emulators": {
    "firestore": {
      "host": "127.0.0.1",
      "port": 8089
    },
    "ui": {
      "enabled": false
    }
  }
}
```

Add scripts:

```json
{
  "test:firestore": "firebase emulators:exec --only firestore --project demo-lifesnap \"vitest run src/quota/__tests__/firestore-quota.integration.test.ts\""
}
```

The integration test must initialize a uniquely named Firebase Admin app, use
the Emulator’s default database, clear the three test collection groups
(`install_minute`, `install_day`, and `service_day`, including both v2 and
legacy documents), and launch concurrent `consume()` calls under a reduced test
policy. Assert the number of `allowed: true` results equals the exact policy
limit.

Run:

```bash
npm run test:firestore
npx vitest run src/quota/__tests__/firestore-quota-store.test.ts
npm run lint
```

Expected: exact-boundary, atomicity, and emulator concurrency tests pass.

- [ ] **Step 7: Commit**

```bash
git add \
  package.json \
  package-lock.json \
  firebase.json \
  src/quota
git commit -m "feat: enforce atomic extraction quotas"
```

### Task 4: Add consumed App Check verification

**Files:**
- Create: `src/security/app-check.ts`
- Create: `src/security/__tests__/app-check.test.ts`

- [ ] **Step 1: Write failing verification tests**

Define a fake SDK verifier and cover:

```ts
it.each([
  [undefined, 401, "APP_CHECK_REQUIRED"],
  ["", 401, "APP_CHECK_REQUIRED"],
])("rejects a missing token before calling the SDK", async (token, status, code) => {
  const sdk = vi.fn();
  const verifier = new ConsumedAppCheckVerifier(sdk, APPROVED_APP_ID);
  await expect(verifier.verify(token)).rejects.toMatchObject({ status, code });
  expect(sdk).not.toHaveBeenCalled();
});

it("consumes the limited-use token and allows only the configured app", async () => {
  const sdk = vi.fn().mockResolvedValue({
    appId: APPROVED_APP_ID,
    alreadyConsumed: false,
  });
  await expect(new ConsumedAppCheckVerifier(sdk, APPROVED_APP_ID).verify("jwt"))
    .resolves.toEqual({ appId: APPROVED_APP_ID });
  expect(sdk).toHaveBeenCalledWith("jwt", { consume: true });
});

it("rejects a replay without returning decoded claims", async () => {
  const sdk = vi.fn().mockResolvedValue({
    appId: APPROVED_APP_ID,
    alreadyConsumed: true,
  });
  await expect(verifierFrom(sdk).verify("jwt")).rejects.toMatchObject({
    status: 401,
    code: "APP_CHECK_REPLAYED",
  });
});
```

Also cover wrong app ID (`403 APP_ID_FORBIDDEN`), invalid/expired token (`401 APP_CHECK_INVALID`), and network/permission/unknown SDK failure (`503 SECURITY_SERVICE_UNAVAILABLE`).

Define the synthetic app ID and helper in the same test file:

```ts
const APPROVED_APP_ID = "1:1234567890:ios:security-test";

function verifierFrom(sdk: VerifyToken) {
  return new ConsumedAppCheckVerifier(sdk, APPROVED_APP_ID);
}
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npx vitest run src/security/__tests__/app-check.test.ts
```

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the stable verifier boundary**

```ts
export type AppCheckClaims = {
  appId: string;
  alreadyConsumed?: boolean;
};

export type VerifyToken = (
  token: string,
  options: { consume: true },
) => Promise<AppCheckClaims>;

export type AppCheckIdentity = { appId: string };

export class AppCheckRequestError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly code:
      | "APP_CHECK_REQUIRED"
      | "APP_CHECK_INVALID"
      | "APP_CHECK_REPLAYED"
      | "APP_ID_FORBIDDEN"
      | "SECURITY_SERVICE_UNAVAILABLE",
  ) {
    super(code);
  }
}

const INVALID_CODES = new Set([
  "app-check/invalid-argument",
  "app-check/app-check-token-expired",
]);
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function hasNetworkCause(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && NETWORK_CODES.has(record.code)) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export class ConsumedAppCheckVerifier {
  constructor(
    private readonly verifyToken: VerifyToken,
    private readonly allowedAppId: string,
  ) {}

  async verify(token: string | undefined): Promise<AppCheckIdentity> {
    if (!token?.trim()) {
      throw new AppCheckRequestError(401, "APP_CHECK_REQUIRED");
    }
    try {
      const claims = await this.verifyToken(token, { consume: true });
      if (claims.appId !== this.allowedAppId) {
        throw new AppCheckRequestError(403, "APP_ID_FORBIDDEN");
      }
      if (claims.alreadyConsumed === true) {
        throw new AppCheckRequestError(401, "APP_CHECK_REPLAYED");
      }
      return { appId: claims.appId };
    } catch (error) {
      if (error instanceof AppCheckRequestError) throw error;
      const code =
        typeof error === "object" && error !== null
          ? (error as { code?: string }).code
          : undefined;
      if (!hasNetworkCause(error) && code && INVALID_CODES.has(code)) {
        throw new AppCheckRequestError(401, "APP_CHECK_INVALID");
      }
      throw new AppCheckRequestError(503, "SECURITY_SERVICE_UNAVAILABLE");
    }
  }
}
```

Do not log the SDK error message, token, or decoded claims. Tests must prove a nested network cause takes precedence over the SDK’s broad `invalid-argument` wrapper.

- [ ] **Step 4: Run focused tests and commit**

```bash
npx vitest run src/security/__tests__/app-check.test.ts
npm run lint
git add src/security/app-check.ts src/security/__tests__/app-check.test.ts
git commit -m "feat: verify consumed app check tokens"
```

Expected: tests and type-check pass before the commit.

### Task 5: Split extraction logic and add protected v2/limited legacy routes

**Files:**
- Create: `src/extraction/extraction-service.ts`
- Create: `src/shared/http-error.ts`
- Create: `src/shared/__tests__/server-security.test.ts`
- Modify: `server.ts`
- Modify: `src/shared/__tests__/server-privacy.test.ts`

- [ ] **Step 1: Extract the current Gemini service behind an interface**

Move only the existing Gemini call and schema validation into:

```ts
export type ImageInput = {
  buffer: Buffer;
  mimeType: string;
};

export interface ExtractionService {
  extract(image: ImageInput): Promise<ReturnType<typeof validateGeminiExtraction>>;
}
```

The concrete factory accepts the Gemini API key, model, and client factory. Preserve the current prompt, `responseMimeType`, response schema, Japanese public failures, and safe metadata. Do not alter the extraction result.

- [ ] **Step 2: Write failing route-order and zero-Gemini tests**

In `server-security.test.ts`, inject fake `appCheckVerifier`, `quotaStore`, `hashInstallationId`, `clock`, and `ExtractionService`. Add:

```ts
it.each([
  [undefined, 401, "APP_CHECK_REQUIRED"],
  ["invalid", 401, "APP_CHECK_INVALID"],
  ["replayed", 401, "APP_CHECK_REPLAYED"],
])("rejects %s App Check before quota and Gemini", async (token, status, code) => {
  const harness = securityHarness({ tokenOutcome: token });
  const response = await harness.postV2({
    token,
    installationId: VALID_INSTALLATION_ID,
    image: imageForm("image/png", 16),
  });
  await expectStablePublicError(response, status, code);
  expect(harness.quota.consume).not.toHaveBeenCalled();
  expect(harness.extraction.extract).not.toHaveBeenCalled();
});

it("validates the image before consuming quota", async () => {
  const harness = securityHarness();
  const response = await harness.postV2({
    token: "valid",
    installationId: VALID_INSTALLATION_ID,
    image: imageForm("text/plain", 16),
  });
  await expectStablePublicError(response, 415, "UNSUPPORTED_IMAGE_TYPE");
  expect(harness.quota.consume).not.toHaveBeenCalled();
});

it("reserves quota before Gemini and keeps it on upstream failure", async () => {
  const harness = securityHarness({ extractionError: new Error("upstream") });
  await harness.postValidV2();
  expect(harness.callOrder).toEqual(["app-check", "quota", "gemini"]);
  expect(harness.quota.consume).toHaveBeenCalledTimes(1);
});
```

Define the harness in the same test file:

```ts
const VALID_INSTALLATION_ID = "e8b18b25-64a6-4af9-b31f-9b0b6d3c3d4e";

function securityHarness(
  options: {
    tokenOutcome?: string;
    extractionError?: Error;
  } = {},
) {
  const callOrder: string[] = [];
  const appCheckVerifier = {
    verify: vi.fn(async (token: string | undefined) => {
      callOrder.push("app-check");
      if (!token) {
        throw new AppCheckRequestError(401, "APP_CHECK_REQUIRED");
      }
      if (token === "invalid" || options.tokenOutcome === "invalid") {
        throw new AppCheckRequestError(401, "APP_CHECK_INVALID");
      }
      if (token === "replayed" || options.tokenOutcome === "replayed") {
        throw new AppCheckRequestError(401, "APP_CHECK_REPLAYED");
      }
      return { appId: "1:1234567890:ios:security-test" };
    }),
  };
  const quota = {
    consume: vi.fn(async () => {
      callOrder.push("quota");
      return { allowed: true as const };
    }),
  };
  const extraction = {
    extract: vi.fn(async () => {
      callOrder.push("gemini");
      if (options.extractionError) throw options.extractionError;
      return validExtractionFixture();
    }),
  };
  const app = createApp({
    env: testEnv({ GEMINI_API_KEY: "unused-by-injected-service" }),
    extractionService: extraction,
    security: {
      appCheckVerifier,
      quotaStore: quota,
      hashInstallationId: () => "a".repeat(64),
      now: () => new Date("2026-07-31T01:00:00Z"),
    },
  });
  return {
    callOrder,
    quota,
    extraction,
    postV2: (input: {
      token?: string;
      installationId: string;
      image: FormData;
    }) =>
      requestOnce(app, "/api/v2/extract", {
        token: input.token,
        installationId: input.installationId,
        body: input.image,
      }),
    postValidV2: () =>
      requestOnce(app, "/api/v2/extract", {
        token: "valid",
        installationId: VALID_INSTALLATION_ID,
        body: imageForm("image/png", 16),
      }),
  };
}

async function requestOnce(
  app: ReturnType<typeof createApp>,
  path: string,
  input: { token?: string; installationId: string; body: FormData },
) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: {
        ...(input.token
          ? { "X-Firebase-AppCheck": input.token }
          : {}),
        "X-LifeSnap-Install-ID": input.installationId,
      },
      body: input.body,
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
```

Define the remaining helpers once at the bottom of the new test file; do not
import private test helpers from another test file:

```ts
function validExtractionFixture() {
  return validateGeminiExtraction({
    route: "calendar_action",
    document_type: "notice",
    task_type: "event",
    title: "Synthetic event",
    due_date: "",
    start_datetime: "2026-10-25T14:00",
    end_datetime: "2026-10-25T15:00",
    amount: 0,
    issuer: "",
    location: "",
    summary: "Synthetic summary",
    confidence: 0.9,
    risk_flags: [],
    evidence: "",
    calendar_event: {
      title: "Synthetic event",
      start: "2026-10-25T14:00",
      end: "2026-10-25T15:00",
      description: "Synthetic summary",
      location: "",
    },
  });
}

function imageForm(mimeType: string, sizeBytes: number) {
  const form = new FormData();
  form.append(
    "image",
    new Blob([Buffer.alloc(sizeBytes)], { type: mimeType }),
    "fixture",
  );
  return form;
}

function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return {
    NODE_ENV: "test",
    MOCK_MODE: "false",
    GEMINI_API_KEY: "",
    ...overrides,
  };
}

async function expectStablePublicError(
  response: Response,
  status: number,
  code: string,
) {
  const body = (await response.json()) as {
    code?: string;
    error?: string;
    details?: string;
  };
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body.code).toBe(code);
  expect(body.error).toBeTruthy();
  expect(body.details).toBeUndefined();
  expect(JSON.stringify(body)).not.toMatch(
    /GEMINI_API_KEY|X-Firebase-AppCheck|stack|Error:/,
  );
  return body;
}
```

Add boundaries for every `429` code and `Retry-After`, Firestore failure as `503`, success schema equality between v1/v2, all errors using no-store, and safe logs excluding token/UUID/HMAC/image/text.
For injected decisions carrying `crossedThreshold: 70`, `90`, or `100`, assert
one and only one `quota_threshold` structured event with only
`route_category` and `threshold_percent`; assert no event for an absent
threshold or a denied request.

- [ ] **Step 3: Verify the route tests fail**

Run:

```bash
npx vitest run src/shared/__tests__/server-security.test.ts
```

Expected: FAIL because `/api/v2/extract` and the dependency contract do not exist.

- [ ] **Step 4: Add explicit application dependencies**

Extend `CreateAppOptions` with:

```ts
export type SecurityDependencies = {
  appCheckVerifier: {
    verify(token: string | undefined): Promise<{ appId: string }>;
  };
  quotaStore: QuotaStore;
  hashInstallationId(value: string): string;
  now(): Date;
};

export type CreateAppOptions = {
  env?: AppEnvironment;
  logger?: PrivacySafeLogger;
  extractionService?: ExtractionService;
  security?: SecurityDependencies;
};
```

Tests must pass an explicit fake `security`. Production construction is added in Task 6. There must be no default allow-all verifier or in-memory production quota.

- [ ] **Step 5: Implement route composition**

Use a small `handleExtraction()` shared function, but keep security ordering at route definition:

```ts
app.post(
  "/api/v2/extract",
  setNoStore,
  verifyAppCheck(security.appCheckVerifier),
  hashInstallationHeader(security.hashInstallationId),
  v2Upload.single("image"),
  async (req, res) => {
    const image = requireImage(req);
    const decision = await security.quotaStore.consume(
      {
        kind: "v2",
        installationHash: res.locals.installationHash,
      },
      security.now(),
    );
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw quotaHttpError(decision.code);
    }
    logThreshold(decision.crossedThreshold, "v2");
    await handleExtraction(req, res, image, "v2");
  },
);

app.post(
  "/api/extract",
  setNoStore,
  legacyUpload.single("image"),
  async (req, res) => {
    const image = requireImage(req);
    const decision = await security.quotaStore.consume(
      { kind: "legacy" },
      security.now(),
    );
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw quotaHttpError(decision.code);
    }
    logThreshold(decision.crossedThreshold, "legacy");
    await handleExtraction(req, res, image, "legacy");
  },
);
```

`setNoStore` must run before every route middleware and the error handler must apply no-store to both paths. v2 uses `413/415`; legacy retains current `400` codes except its new `429`.

- [ ] **Step 6: Run focused and full backend tests**

```bash
npx vitest run \
  src/shared/__tests__/server-security.test.ts \
  src/shared/__tests__/server-privacy.test.ts
npm test
npm run lint
npm run build
```

Expected: all new security tests pass; all 30 pre-existing tests remain green or are updated only for explicit legacy quota injection.

- [ ] **Step 7: Commit**

```bash
git add \
  server.ts \
  src/extraction/extraction-service.ts \
  src/shared/http-error.ts \
  src/shared/__tests__/server-security.test.ts \
  src/shared/__tests__/server-privacy.test.ts
git commit -m "feat: protect v2 extraction route"
```

### Task 6: Add production Firebase runtime construction

**Files:**
- Create: `src/runtime/firebase.ts`
- Create: `src/runtime/__tests__/firebase.test.ts`
- Modify: `server.ts`
- Modify: `.env.example`
- Modify: `tsconfig.json`

- [ ] **Step 1: Write failing production-config tests**

Assert every required value:

```ts
it.each([
  "FIREBASE_PROJECT_ID",
  "FIREBASE_APP_ID",
  "FIRESTORE_DATABASE_ID",
  "INSTALLATION_HMAC_KEY",
])("fails closed when %s is missing", (name) => {
  const env = completeProductionEnv();
  delete env[name];
  expect(() => buildRuntimeSecurity(env)).toThrow(`${name} is required`);
});

it("targets the named quota database and consumed token verifier", () => {
  const fakes = fakeFirebaseFactory();
  const dependencies = buildRuntimeSecurity(completeProductionEnv(), fakes);
  expect(fakes.getFirestore).toHaveBeenCalledWith(
    expect.anything(),
    "lifesnap-quota",
  );
  expect(dependencies.hashInstallationId(VALID_ID)).toMatch(/^[a-f0-9]{64}$/);
});

const VALID_ID = "e8b18b25-64a6-4af9-b31f-9b0b6d3c3d4e";

function completeProductionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    FIREBASE_PROJECT_ID: "zhang23-23",
    FIREBASE_APP_ID: "1:1234567890:ios:security-test",
    FIRESTORE_DATABASE_ID: "lifesnap-quota",
    INSTALLATION_HMAC_KEY: "k".repeat(48),
  };
}

function fakeFirebaseFactory() {
  const app = { name: "lifesnap-runtime" };
  return {
    applicationDefault: vi.fn(() => ({}) as never),
    getApps: vi.fn(() => []),
    initializeApp: vi.fn(() => app as never),
    getAppCheck: vi.fn(() => ({
      verifyToken: vi.fn(),
    })),
    getFirestore: vi.fn(() => ({}) as never),
  };
}
```

- [ ] **Step 2: Implement ADC-only initialization**

```ts
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getFirestore } from "firebase-admin/firestore";

type FirebaseFactory = {
  applicationDefault: typeof applicationDefault;
  getApps: typeof getApps;
  initializeApp: typeof initializeApp;
  getAppCheck: typeof getAppCheck;
  getFirestore: typeof getFirestore;
};

const productionFirebaseFactory: FirebaseFactory = {
  applicationDefault,
  getApps,
  initializeApp,
  getAppCheck,
  getFirestore,
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function buildRuntimeSecurity(
  env: NodeJS.ProcessEnv,
  factory: FirebaseFactory = productionFirebaseFactory,
) {
  const projectId = required(env, "FIREBASE_PROJECT_ID");
  const appId = required(env, "FIREBASE_APP_ID");
  const databaseId = required(env, "FIRESTORE_DATABASE_ID");
  const hmacKey = required(env, "INSTALLATION_HMAC_KEY");
  const firebaseApp =
    factory.getApps().find((app) => app.name === "lifesnap-runtime") ??
    factory.initializeApp(
      { credential: factory.applicationDefault(), projectId },
      "lifesnap-runtime",
    );
  const appCheck = factory.getAppCheck(firebaseApp);
  const verifier = new ConsumedAppCheckVerifier(
    appCheck.verifyToken.bind(appCheck),
    appId,
  );
  const quotaStore = new FirestoreQuotaStore(
    factory.getFirestore(firebaseApp, databaseId),
  );
  return {
    appCheckVerifier: verifier,
    quotaStore,
    hashInstallationId: (value: string) =>
      hashInstallationId(value, hmacKey),
    now: () => new Date(),
  };
}
```

Do not accept a credentials JSON path or create service-account keys. Production startup must fail before listening if configuration is incomplete.

- [ ] **Step 3: Document exact environment contract**

Add to `.env.example` without values:

```dotenv
FIREBASE_PROJECT_ID="zhang23-23"
FIREBASE_APP_ID=""
FIRESTORE_DATABASE_ID="lifesnap-quota"
INSTALLATION_HMAC_KEY=""
```

Comments must state that `INSTALLATION_HMAC_KEY` is a distinct Secret Manager value and must never reuse `GEMINI_API_KEY`.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run src/runtime/__tests__/firebase.test.ts
npm test
npm run lint
npm run build
git add \
  .env.example \
  server.ts \
  tsconfig.json \
  src/runtime
git commit -m "feat: wire fail-closed firebase runtime"
```

### Task 7: Provision the no-traffic Firebase, Firestore, Secret, and IAM boundary

**Files:**
- Add after retrieval with `apply_patch`: `ios/LifeSnapAction/GoogleService-Info.plist`
- Create: `docs/verification/yotei-snap-security/infrastructure-preflight.txt`
- External state: Firebase project/app/App Check, Firestore, Secret Manager, IAM

- [ ] **Step 1: Re-run read-only preflight and stop on conflict**

Use an isolated temporary directory:

```bash
security_tmp_dir="$(mktemp -d)"
project_id="zhang23-23"
project_number="$(
  gcloud projects describe "${project_id}" \
    --format='value(projectNumber)'
)"

gcloud run services describe lifesnap-action \
  --project="${project_id}" \
  --region=asia-northeast1 \
  --format=json > "${security_tmp_dir}/service-before.json"

gcloud firestore databases list \
  --project="${project_id}" \
  --format=json > "${security_tmp_dir}/databases-before.json"

gcloud iam service-accounts describe \
  "lifesnap-runtime@${project_id}.iam.gserviceaccount.com" \
  --project="${project_id}" \
  --format=json > "${security_tmp_dir}/runtime-sa-before.json" 2>/dev/null || true
```

Expected:

- current service identity remains the previously observed default Compute service account;
- no conflicting database named `lifesnap-quota` exists; if it exists, it must already be Firestore Native, Standard, `asia-northeast1`, and delete-protected;
- any pre-existing `lifesnap-runtime` account must have no unexpected roles.

Write only sanitized facts to the verification file. Do not copy access tokens, IAM credentials, secret payloads, user emails, or unrelated principals.

- [ ] **Step 2: Resolve exactly one Apple Team ID**

Read certificate subjects and require one unique Organizational Unit:

```bash
team_ids="$(
  security find-certificate -a -c "Apple Development" -p |
    openssl crl2pkcs7 -nocrl -certfile /dev/stdin |
    openssl pkcs7 -print_certs -noout |
    sed -n 's/.*OU=\\([^,/]*\\).*/\\1/p' |
    sort -u
)"
apple_team_id="$(
  printf '%s\n' "${team_ids}" |
    awk 'NF { values[++count]=$0 } END {
      if (count != 1 || length(values[1]) != 10) exit 1
      print values[1]
    }'
)"
```

Expected: exactly one non-empty 10-character Team ID. If zero or multiple values appear, stop. Do not guess or use the App Store numeric Apple ID as a Team ID.

- [ ] **Step 3: Enable only required APIs**

```bash
gcloud services enable \
  firebase.googleapis.com \
  firebaseappcheck.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  --project="${project_id}"
```

Do not enable Firebase Authentication, Analytics, Cloud Armor, or load-balancing APIs.

- [ ] **Step 4: Attach Firebase to the existing GCP project if absent**

First GET:

```bash
access_token="$(gcloud auth print-access-token)"
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${access_token}" \
  "https://firebase.googleapis.com/v1beta1/projects/${project_id}"
```

If and only if this returns a confirmed 404, call:

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  --header "Authorization: Bearer ${access_token}" \
  --header "Content-Type: application/json" \
  --data '{}' \
  "https://firebase.googleapis.com/v1beta1/projects/${project_id}:addFirebase"
```

Poll the returned operation until `done=true`, then GET the project again and require `projectId=zhang23-23`, the expected project number, and `state=ACTIVE`.

- [ ] **Step 5: Reuse or create exactly one iOS app**

List iOS apps:

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${access_token}" \
  "https://firebase.googleapis.com/v1beta1/projects/${project_id}/iosApps"
```

If one ACTIVE app has `bundleId=com.zll.lifesnapaction`, reuse it. If none exists, build the create body from the Team ID resolved in Step 2:

```bash
ios_app_body="$(
  jq -n \
    --arg display_name "よていスナップ" \
    --arg bundle_id "com.zll.lifesnapaction" \
    --arg team_id "${apple_team_id}" \
    '{
      displayName: $display_name,
      bundleId: $bundle_id,
      teamId: $team_id
    }'
)"
```

Poll the operation. Patch the reused app’s `displayName` and `teamId` only when
the current values differ, using its current `etag`. Then list again and resolve
the selected app fail-closed:

```bash
ios_apps_json="$(
  curl --fail-with-body --silent --show-error \
    --header "Authorization: Bearer ${access_token}" \
    "https://firebase.googleapis.com/v1beta1/projects/${project_id}/iosApps"
)"
matching_app_count="$(
  jq '[.apps[] |
    select(
      .bundleId == "com.zll.lifesnapaction" and
      .state == "ACTIVE"
    )
  ] | length' <<<"${ios_apps_json}"
)"
test "${matching_app_count}" -eq 1
firebase_app_id="$(
  jq -r '.apps[] |
    select(
      .bundleId == "com.zll.lifesnapaction" and
      .state == "ACTIVE"
    ) |
    .appId' <<<"${ios_apps_json}"
)"
test -n "${firebase_app_id}"
test "${firebase_app_id}" != "null"
```

If more than one ACTIVE app has that Bundle ID, stop and report the conflict.

- [ ] **Step 6: Configure App Attest and download the app config**

Build the exact resource name and patch body:

```bash
app_attest_name="projects/${project_number}/apps/${firebase_app_id}/appAttestConfig"
app_attest_body="$(
  jq -n \
    --arg name "${app_attest_name}" \
    '{name: $name, tokenTtl: "3600s"}'
)"
curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header "Authorization: Bearer ${access_token}" \
  --header "Content-Type: application/json" \
  --data "${app_attest_body}" \
  "https://firebaseappcheck.googleapis.com/v1/${app_attest_name}?updateMask=tokenTtl"
```

GET the resource and require the exact name and TTL. Retrieve:

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${access_token}" \
  "https://firebase.googleapis.com/v1beta1/projects/${project_id}/iosApps/${firebase_app_id}/config"
```

Decode `configFileContents` into the temporary directory. Inspect that:

- `BUNDLE_ID=com.zll.lifesnapaction`;
- `PROJECT_ID=zhang23-23`;
- `GOOGLE_APP_ID` equals the selected Firebase app ID;
- Analytics, AdMob, Messaging, and Sign-In are not added by this plan.

Use `apply_patch` to add the reviewed XML plist to `ios/LifeSnapAction/GoogleService-Info.plist`; do not use shell redirection to write into the repository.

- [ ] **Step 7: Create the named Firestore database and TTL policies**

Only if absent:

```bash
gcloud firestore databases create \
  --project="${project_id}" \
  --database=lifesnap-quota \
  --location=asia-northeast1 \
  --type=firestore-native \
  --edition=standard \
  --delete-protection
```

Enable `expires_at` TTL for exactly these collection groups:

```bash
for collection_group in install_minute install_day service_day; do
  gcloud firestore fields ttls update expires_at \
    --project="${project_id}" \
    --database=lifesnap-quota \
    --collection-group="${collection_group}" \
    --enable-ttl
done
```

Describe the database afterward and require exact ID, location, type, edition, and delete protection.

- [ ] **Step 8: Create the independent HMAC Secret**

If the Secret resource is absent:

```bash
gcloud secrets create lifesnap-installation-hmac-key \
  --project="${project_id}" \
  --replication-policy=automatic
openssl rand -base64 48 |
  gcloud secrets versions add lifesnap-installation-hmac-key \
    --project="${project_id}" \
    --data-file=-
```

Require one enabled latest version. Never print, compare suffixes, or record the payload. Do not modify the existing Gemini Secret payload.

- [ ] **Step 9: Create and bind the least-privilege runtime identity**

Create the account if absent:

```bash
gcloud iam service-accounts create lifesnap-runtime \
  --project="${project_id}" \
  --display-name="LifeSnap production runtime"
```

Grant Secret access at each Secret resource:

```bash
for secret_name in \
  lifesnap-gemini-api-key \
  lifesnap-installation-hmac-key
do
  gcloud secrets add-iam-policy-binding "${secret_name}" \
    --project="${project_id}" \
    --member="serviceAccount:lifesnap-runtime@${project_id}.iam.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

Grant token verification:

```bash
gcloud projects add-iam-policy-binding "${project_id}" \
  --member="serviceAccount:lifesnap-runtime@${project_id}.iam.gserviceaccount.com" \
  --role=roles/firebaseappcheck.tokenVerifier \
  --condition=None
```

Grant Firestore access only to the named database:

```bash
gcloud projects add-iam-policy-binding "${project_id}" \
  --member="serviceAccount:lifesnap-runtime@${project_id}.iam.gserviceaccount.com" \
  --role=roles/datastore.user \
  --condition='title=LifeSnapQuotaDatabase,description=LifeSnap quota database only,expression=resource.name=="projects/zhang23-23/databases/lifesnap-quota"'
```

Allow only the already configured Cloud Build deployment identity to attach the
runtime account:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "lifesnap-runtime@${project_id}.iam.gserviceaccount.com" \
  --project="${project_id}" \
  --member="serviceAccount:apps-cloud-build@${project_id}.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountUser
```

Before adding this binding, require `cloudbuild.yaml` to name exactly
`apps-cloud-build@zhang23-23.iam.gserviceaccount.com`; if it differs, stop and
inventory the actual deployment principal. This resource-level binding grants
that deployment identity `actAs` only on `lifesnap-runtime`; do not add
project-level Service Account User.

Do not grant Editor, Run Admin, Service Account User, Storage Admin, Artifact Registry Writer, Cloud Build Builder, Owner, or Secret Manager Admin to the runtime identity.

- [ ] **Step 10: Verify and commit only the reviewed local config/evidence**

Use `gcloud projects get-iam-policy`, both Secret IAM policies, App Attest GET,
Firestore describe/TTL list, runtime service-account describe, and
`gcloud iam service-accounts get-iam-policy` for the runtime account. Sanitize
to resource names, roles, conditions, database properties, provider type, and
the one expected Cloud Build principal.

```bash
git diff --check
git status --short --branch
git add \
  ios/LifeSnapAction/GoogleService-Info.plist \
  docs/verification/yotei-snap-security/infrastructure-preflight.txt
git commit -m "chore: register app check infrastructure"
```

Expected: no token, Secret payload, personal account, or unrelated IAM member appears in the commit.

### Task 8: Bootstrap Firebase App Check and the production entitlement on iOS

**Files:**
- Create: `ios/LifeSnapAction/Services/AppCheckBootstrap.swift`
- Create: `ios/LifeSnapAction/LifeSnapAction.entitlements`
- Create: `ios/LifeSnapActionTests/AppCheckBootstrapTests.swift`
- Modify: `ios/LifeSnapAction/App/LifeSnapActionApp.swift`
- Modify: `ios/project.yml`
- Regenerate: `ios/LifeSnapAction.xcodeproj/project.pbxproj`
- Create/update: `ios/LifeSnapAction.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`

- [ ] **Step 1: Add the pinned Firebase package and entitlement path**

Modify `ios/project.yml`:

```yaml
packages:
  Firebase:
    url: https://github.com/firebase/firebase-ios-sdk
    exactVersion: 12.17.0

targets:
  LifeSnapAction:
    dependencies:
      - package: Firebase
        product: FirebaseCore
      - package: Firebase
        product: FirebaseAppCheck
      - sdk: Security.framework
    settings:
      CODE_SIGN_ENTITLEMENTS: LifeSnapAction/LifeSnapAction.entitlements
```

Add:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.devicecheck.appattest-environment</key>
    <string>production</string>
</dict>
</plist>
```

- [ ] **Step 2: Write the bootstrap mode test**

```swift
import XCTest
@testable import LifeSnapAction

final class AppCheckBootstrapTests: XCTestCase {
    func testDebugBuildUsesOnlyDebugMode() {
        #if DEBUG
        XCTAssertEqual(AppCheckBuildMode.current, .debug)
        #else
        XCTAssertEqual(AppCheckBuildMode.current, .appAttest)
        #endif
    }
}
```

- [ ] **Step 3: Implement the provider factory**

```swift
import FirebaseAppCheck
import FirebaseCore

enum AppCheckBuildMode: Equatable {
    case debug
    case appAttest

    static var current: Self {
        #if DEBUG
        return .debug
        #else
        return .appAttest
        #endif
    }
}

final class LifeSnapAppAttestProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        AppAttestProvider(app: app)
    }
}

enum AppCheckBootstrap {
    static func configure() {
        switch AppCheckBuildMode.current {
        case .debug:
            AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
        case .appAttest:
            AppCheck.setAppCheckProviderFactory(
                LifeSnapAppAttestProviderFactory()
            )
        }
        FirebaseApp.configure()
    }
}
```

Call `AppCheckBootstrap.configure()` from `LifeSnapActionApp.init()` before the scene body can create `APIClient`.

- [ ] **Step 4: Regenerate and test the project**

```bash
xcodegen generate --spec ios/project.yml
xcodebuild \
  -resolvePackageDependencies \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction

plutil -lint \
  ios/LifeSnapAction/LifeSnapAction.entitlements \
  ios/LifeSnapAction/GoogleService-Info.plist

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${simulator_udid}" \
  -derivedDataPath /tmp/yotei-security-bootstrap \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet
```

Expected: the new bootstrap test passes and the project pins Firebase 12.17.0.

- [ ] **Step 5: Commit**

```bash
git add \
  ios/project.yml \
  ios/LifeSnapAction.xcodeproj \
  ios/LifeSnapAction/App/LifeSnapActionApp.swift \
  ios/LifeSnapAction/Services/AppCheckBootstrap.swift \
  ios/LifeSnapAction/LifeSnapAction.entitlements \
  ios/LifeSnapActionTests/AppCheckBootstrapTests.swift
git commit -m "feat: bootstrap app attest for release"
```

### Task 9: Add Keychain installation identity and limited-use tokens

**Files:**
- Create: `ios/LifeSnapAction/Services/InstallationIdentifierStore.swift`
- Create: `ios/LifeSnapAction/Services/AppCheckTokenProvider.swift`
- Create: `ios/LifeSnapActionTests/SecurityCredentialTests.swift`

- [ ] **Step 1: Write failing tests with injected stores/providers**

```swift
func testInstallationIdentifierIsCreatedOnceAndReused() throws {
    let keychain = InMemoryKeychain()
    let store = KeychainInstallationIdentifierStore(keychain: keychain)
    let first = try store.identifier()
    let second = try store.identifier()
    XCTAssertEqual(first, second)
    XCTAssertEqual(keychain.writeCount, 1)
}

func testCorruptIdentifierIsReplacedWithoutReturningIt() throws {
    let keychain = InMemoryKeychain(initial: Data("not-a-uuid".utf8))
    let store = KeychainInstallationIdentifierStore(keychain: keychain)
    XCTAssertNotNil(UUID(uuidString: try store.identifier()))
    XCTAssertEqual(keychain.deleteCount, 1)
}

func testLimitedUseProviderReturnsOnlyTheTokenString() async throws {
    var callCount = 0
    let provider = FirebaseLimitedUseTokenProvider { completion in
        callCount += 1
        completion(.success("limited-token"))
    }
    XCTAssertEqual(try await provider.token(), "limited-token")
    XCTAssertEqual(callCount, 1)
}
```

Define the test Keychain in the same file:

```swift
private final class InMemoryKeychain: KeychainPersisting {
    var data: Data?
    var writeCount = 0
    var deleteCount = 0

    init(initial: Data? = nil) {
        data = initial
    }

    func read(service: String, account: String) throws -> Data? {
        data
    }

    func write(
        _ data: Data,
        service: String,
        account: String
    ) throws {
        self.data = data
        writeCount += 1
    }

    func delete(service: String, account: String) throws {
        data = nil
        deleteCount += 1
    }
}
```

- [ ] **Step 2: Verify tests fail**

Run the focused XCTest target:

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${simulator_udid}" \
  -only-testing:LifeSnapActionTests/SecurityCredentialTests \
  CODE_SIGNING_ALLOWED=NO \
  test
```

Expected: FAIL because the credential components do not exist.

- [ ] **Step 3: Implement Keychain storage**

Use:

```swift
protocol InstallationIdentifierProviding {
    func identifier() throws -> String
}

protocol KeychainPersisting {
    func read(service: String, account: String) throws -> Data?
    func write(
        _ data: Data,
        service: String,
        account: String
    ) throws
    func delete(service: String, account: String) throws
}

final class KeychainInstallationIdentifierStore:
    InstallationIdentifierProviding
{
    private let service = "com.zll.lifesnapaction.security"
    private let account = "app-check-installation-id-v1"
    private let keychain: KeychainPersisting

    init(keychain: KeychainPersisting = SystemKeychain()) {
        self.keychain = keychain
    }

    func identifier() throws -> String {
        if let data = try keychain.read(service: service, account: account),
           let stored = String(data: data, encoding: .utf8),
           let uuid = UUID(uuidString: stored) {
            return uuid.uuidString.lowercased()
        }
        try keychain.delete(service: service, account: account)
        let created = UUID().uuidString.lowercased()
        try keychain.write(
            Data(created.utf8),
            service: service,
            account: account
        )
        return created
    }
}
```

The concrete Keychain query must use:

```swift
kSecClassGenericPassword
kSecAttrService
kSecAttrAccount
kSecAttrAccessibleWhenUnlockedThisDeviceOnly
```

It must not use iCloud synchronization, logs, `UserDefaults`, pasteboard, or vendor/advertising identifiers.

- [ ] **Step 4: Implement limited-use token retrieval**

```swift
protocol AppCheckTokenProviding {
    func token() async throws -> String
}

struct FirebaseLimitedUseTokenProvider: AppCheckTokenProviding {
    typealias Fetch = (
        @escaping (Result<String, Error>) -> Void
    ) -> Void

    private let fetch: Fetch

    init(fetch: @escaping Fetch = { completion in
        AppCheck.appCheck().limitedUseToken { token, error in
            if let error {
                completion(.failure(error))
            } else if let token {
                completion(.success(token.token))
            } else {
                completion(.failure(
                    APIError.securityVerificationUnavailable
                ))
            }
        }
    }) {
        self.fetch = fetch
    }

    func token() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            fetch { result in
                continuation.resume(with: result)
            }
        }
    }
}
```

Never cache or log the returned string.

- [ ] **Step 5: Run tests and commit**

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${simulator_udid}" \
  -only-testing:LifeSnapActionTests/SecurityCredentialTests \
  CODE_SIGNING_ALLOWED=NO \
  test

git add \
  ios/LifeSnapAction/Services/InstallationIdentifierStore.swift \
  ios/LifeSnapAction/Services/AppCheckTokenProvider.swift \
  ios/LifeSnapActionTests/SecurityCredentialTests.swift
git commit -m "feat: create private app check credentials"
```

### Task 10: Send secure v2 requests and map Japanese errors

**Files:**
- Modify: `ios/LifeSnapAction/Services/APIClient.swift`
- Modify: `ios/LifeSnapAction/Models/ExtractionResult.swift`
- Modify: `ios/LifeSnapAction/Info.plist`
- Modify: `ios/project.yml`
- Create: `ios/LifeSnapActionTests/APIClientSecurityTests.swift`
- Create: `ios/LifeSnapActionTests/AppAttestLiveSmokeTests.swift`

- [ ] **Step 1: Write failing request and retry tests**

Use injected `URLSessioning`, `AppCheckTokenProviding`, and `InstallationIdentifierProviding`. Cover:

```swift
func testV2RequestContainsBothSecurityHeaders() async throws {
    let session = StubSession(responses: [.successExtraction])
    let client = APIClient(
        baseURL: URL(string: "https://candidate.example")!,
        session: session,
        tokenProvider: StubTokenProvider(tokens: ["limited-1"]),
        installationStore: StubInstallationStore(id: validUUID)
    )
    _ = try await client.extractEvent(from: Data([0x01]))
    let request = try XCTUnwrap(session.requests.first)
    XCTAssertEqual(request.url?.path, "/api/v2/extract")
    XCTAssertEqual(
        request.value(forHTTPHeaderField: "X-Firebase-AppCheck"),
        "limited-1"
    )
    XCTAssertEqual(
        request.value(forHTTPHeaderField: "X-LifeSnap-Install-ID"),
        validUUID
    )
}

func testInvalidTokenRefreshesOnceWithANewLimitedToken() async throws {
    let session = StubSession(responses: [
        .error(401, "APP_CHECK_INVALID"),
        .successExtraction
    ])
    let tokens = StubTokenProvider(tokens: ["limited-1", "limited-2"])
    _ = try await makeClient(session, tokens).extractEvent(from: image)
    XCTAssertEqual(tokens.callCount, 2)
    XCTAssertEqual(session.requests.count, 2)
}

func testReplayQuotaAndNetworkFailuresNeverAutoRetry() async {
    for fixture in [
        StubResponse.error(401, "APP_CHECK_REPLAYED"),
        .error(429, "INSTALL_RATE_LIMITED"),
        .error(503, "SECURITY_SERVICE_UNAVAILABLE"),
        .transportFailure
    ] {
        let session = StubSession(responses: [fixture])
        do {
            _ = try await makeClient(session).extractEvent(from: image)
            XCTFail("Expected the request to fail")
        } catch {
            // Expected; the request count below proves no automatic retry.
        }
        XCTAssertEqual(session.requests.count, 1)
    }
}
```

Define the test doubles in the same file so the examples compile without a
shared hidden helper:

```swift
private let validUUID =
    "e8b18b25-64a6-4af9-b31f-9b0b6d3c3d4e"
private let image = Data([0x01])

private enum StubResponse {
    case successExtraction
    case error(Int, String)
    case transportFailure
}

private final class StubSession: URLSessioning {
    private var responses: [StubResponse]
    private(set) var requests: [URLRequest] = []

    init(responses: [StubResponse]) {
        self.responses = responses
    }

    func data(
        for request: URLRequest
    ) async throws -> (Data, URLResponse) {
        requests.append(request)
        let fixture = responses.removeFirst()
        if case .transportFailure = fixture {
            throw URLError(.networkConnectionLost)
        }
        let status: Int
        let data: Data
        switch fixture {
        case .successExtraction:
            status = 200
            data = Data(#"{"route":"no_action_detected"}"#.utf8)
        case .error(let value, let code):
            status = value
            data = try JSONEncoder().encode(
                APIErrorResponse(error: "public error", code: code)
            )
        case .transportFailure:
            fatalError("handled above")
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: nil,
            headerFields: ["Cache-Control": "no-store"]
        )!
        return (data, response)
    }
}

private final class StubTokenProvider: AppCheckTokenProviding {
    private var tokens: [String]
    private(set) var callCount = 0

    init(tokens: [String]) {
        self.tokens = tokens
    }

    func token() async throws -> String {
        callCount += 1
        return tokens.removeFirst()
    }
}

private struct StubInstallationStore:
    InstallationIdentifierProviding
{
    let id: String
    func identifier() throws -> String { id }
}

private func makeClient(
    _ session: StubSession,
    _ tokens: StubTokenProvider = StubTokenProvider(tokens: ["limited-1"])
) -> APIClient {
    APIClient(
        baseURL: URL(string: "https://candidate.example")!,
        session: session,
        tokenProvider: tokens,
        installationStore: StubInstallationStore(id: validUUID)
    )
}
```

Add one test for each server code in Step 4 and assert the exact Japanese
`errorDescription`. Also assert that `APP_CHECK_REQUIRED` is not retried,
because a missing header indicates local request construction failure rather
than a refreshable expired token.

- [ ] **Step 2: Verify the tests fail**

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${simulator_udid}" \
  -only-testing:LifeSnapActionTests/APIClientSecurityTests \
  CODE_SIGNING_ALLOWED=NO \
  test
```

Expected: FAIL because APIClient still calls `/api/extract` without credentials.

- [ ] **Step 3: Convert APIClient to an injectable instance**

Preserve the public privacy URL while making the extraction base URL an injected instance value:

```swift
static let productionBaseURL =
    "https://lifesnap-action-sxielk4wua-an.a.run.app"
static var privacyPolicyURL: URL {
    URL(string: "\(productionBaseURL)/privacy")!
}
```

Use:

```swift
protocol URLSessioning {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}
extension URLSession: URLSessioning {}

final class APIClient {
    private let baseURL: URL
    private let session: URLSessioning
    private let tokenProvider: AppCheckTokenProviding
    private let installationStore: InstallationIdentifierProviding

    func extractEvent(from imageData: Data) async throws -> ExtractionResponse {
        var attempt = 0
        while true {
            let request = try await makeRequest(imageData: imageData)
            let (data, response) = try await session.data(for: request)
            do {
                return try decode(data: data, response: response)
            } catch APIError.appCheckInvalid where attempt == 0 {
                attempt += 1
                continue
            }
        }
    }
}
```

`makeRequest` obtains a new limited-use token on each loop, reads the Keychain UUID, builds the multipart body, and sends both headers. Do not log either value.

Add a build-setting-backed validation URL without changing the default:

```xml
<key>APIBaseURL</key>
<string>$(API_BASE_URL)</string>
```

```yaml
settings:
  API_BASE_URL: https://lifesnap-action-sxielk4wua-an.a.run.app
```

The default initializer reads `APIBaseURL` from `Info.plist`, validates it is HTTPS, and otherwise fails closed. Tests inject a URL directly. A candidate device build overrides the Xcode build setting on the command line; no candidate URL is committed.

- [ ] **Step 4: Add stable Japanese error mapping**

Map server codes without exposing backend messages:

```swift
case "APP_CHECK_REQUIRED", "APP_CHECK_INVALID":
    return .appCheckInvalid
case "APP_CHECK_REPLAYED":
    return .securityVerificationFailed(
        "安全確認に失敗しました。もう一度画像を選び直してください。"
    )
case "APP_ID_FORBIDDEN":
    return .securityVerificationFailed(
        "このアプリのバージョンでは利用できません。最新版に更新してください。"
    )
case "INSTALL_RATE_LIMITED":
    return .rateLimited(
        "短時間の読み取り回数が上限に達しました。少し待ってからお試しください。"
    )
case "INSTALL_DAILY_LIMITED":
    return .rateLimited(
        "本日の読み取り回数が上限に達しました。明日もう一度お試しください。"
    )
case "SERVICE_DAILY_LIMITED":
    return .rateLimited(
        "本日のサービス利用上限に達しました。明日もう一度お試しください。"
    )
case "SECURITY_SERVICE_UNAVAILABLE":
    return .securityVerificationUnavailable
```

The UI continues displaying `LocalizedError.errorDescription`; do not add a new screen or alter consent.

- [ ] **Step 5: Add a disabled-by-default real-device replay test**

`AppAttestLiveSmokeTests` must compile into the test target but skip unless the build includes `-DRUN_LIVE_APP_ATTEST_SMOKE`. In the enabled branch it:

1. obtains one limited-use App Check token;
2. reads the candidate base URL from `APIBaseURL`;
3. builds one multipart request from a generated synthetic PNG;
4. sends the exact same request twice without printing headers or body;
5. requires first response `200` with a decodable `ExtractionResponse`;
6. requires second response `401 APP_CHECK_REPLAYED`;
7. prints only `app_attest_provider=PASS`, `v2_extract=PASS`, and `replay_rejected=PASS`.

Use this compile guard:

```swift
func testLiveAppAttestAndReplayProtection() async throws {
    #if RUN_LIVE_APP_ATTEST_SMOKE
    try await runLiveSmokeWithoutLoggingCredentials()
    #else
    throw XCTSkip("RUN_LIVE_APP_ATTEST_SMOKE is not enabled")
    #endif
}
```

The helper must reuse the first request object for the second call; asking the token provider twice does not test replay.

- [ ] **Step 6: Run iOS tests and commit**

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${simulator_udid}" \
  -derivedDataPath /tmp/yotei-security-client \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet

git add \
  ios/LifeSnapAction/Services/APIClient.swift \
  ios/LifeSnapAction/Models/ExtractionResult.swift \
  ios/LifeSnapAction/Info.plist \
  ios/project.yml \
  ios/LifeSnapActionTests/APIClientSecurityTests.swift \
  ios/LifeSnapActionTests/AppAttestLiveSmokeTests.swift
git commit -m "feat: send attested v2 extraction requests"
```

### Task 11: Update privacy disclosures and Release validation

**Files:**
- Modify: `server.ts`
- Modify: `src/shared/__tests__/server-privacy.test.ts`
- Modify: `docs/app-store/privacy-policy.md`
- Modify: `docs/app-store/app-privacy-label-draft.md`
- Modify: `docs/release/app-store-connect-privacy-answers.md`
- Modify: `docs/app-store/app-review-notes.md`
- Modify: `scripts/validate-yotei-snap-release.sh`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`

- [ ] **Step 1: Write failing privacy and Release-contract assertions**

Backend privacy tests must require disclosure of:

- App Check/App Attest integrity processing;
- a random Keychain installation identifier;
- only an HMAC digest reaches Firestore;
- quota counters expire logically after 24 hours/30 days;
- Firebase replay protection may retain consumed App Check tokens for at most 30 days;
- no image or extracted document content is stored.

Release validator must require:

```bash
assert_contains "$entitlements" \
  '<key>com.apple.developer.devicecheck.appattest-environment</key>' \
  'App Attest entitlement key'
assert_contains "$entitlements" \
  '<string>production</string>' \
  'App Attest production environment'
assert_contains "$project_yml" \
  'exactVersion: 12.17.0' \
  'Firebase SDK version is pinned'
assert_contains "$api_client" \
  '/api/v2/extract' \
  'Build 4 uses v2 extraction'
assert_not_contains "$api_client" \
  'X-Firebase-AppCheck\", \"' \
  'No hard-coded App Check token'
```

Also validate `GoogleService-Info.plist` Bundle ID/project/app ID consistency without printing its API key.

- [ ] **Step 2: Verify the new assertions fail**

```bash
npx vitest run src/shared/__tests__/server-privacy.test.ts
npm run validate:ios-release
```

Expected: FAIL until the disclosures and validator inputs are updated.

- [ ] **Step 3: Update the privacy and review documents**

The App Store privacy drafts must classify the app-generated installation UUID/HMAC as an unlinked identifier used for App Functionality and Fraud Prevention, and document Firebase App Check attestation/assertion objects. They must not claim Firebase Analytics, Authentication, Crashlytics, Advertising, tracking, or user profiling.

Keep the distinction:

- Firestore quota records: up to 30 days;
- App Check replay token handling: Firebase retention up to 30 days;
- uploaded image/Gemini raw output/extracted content: no application persistence.

Do not mutate App Store Connect in this task.

- [ ] **Step 4: Run focused/full validation and commit**

```bash
npx vitest run src/shared/__tests__/server-privacy.test.ts
npm run validate:ios-release
npm test
npm run lint
npm run build

git add \
  server.ts \
  src/shared/__tests__/server-privacy.test.ts \
  docs/app-store/privacy-policy.md \
  docs/app-store/app-privacy-label-draft.md \
  docs/release/app-store-connect-privacy-answers.md \
  docs/app-store/app-review-notes.md \
  docs/release/yotei-snap-v1.1-app-store-release-gate.md \
  scripts/validate-yotei-snap-release.sh
git commit -m "docs: disclose app check quota processing"
```

### Task 12: Make deployment candidate-only until real-device evidence

**Files:**
- Modify: `scripts/promote-and-verify.sh`
- Create: `scripts/promote-verified-candidate.sh`
- Modify: `cloudbuild.yaml`
- Modify: `src/shared/__tests__/cloudbuild-contract.test.ts`

- [ ] **Step 1: Write failing release-contract tests**

Add assertions that:

- Cloud Build ends after a tagged zero-traffic candidate;
- candidate runtime identity equals `lifesnap-runtime@zhang23-23.iam.gserviceaccount.com`;
- both Secret Manager references exist;
- `FIREBASE_PROJECT_ID`, exact Firebase app ID, and `FIRESTORE_DATABASE_ID=lifesnap-quota` exist;
- candidate smoke performs health/privacy, one legacy success, one missing-token v2 rejection, and one invalid-token v2 rejection;
- negative v2 responses are `401`, `Cache-Control: no-store`, and stable codes;
- candidate deployment never calls the promotion function;
- promotion is a separate script requiring exact revision, tag, digest, source commit, and a sanitized real-device evidence file.

Run:

```bash
npx vitest run src/shared/__tests__/cloudbuild-contract.test.ts
```

Expected: FAIL because the current script promotes automatically and preserves the old runtime account.

- [ ] **Step 2: Modify candidate payload construction**

Resolve the Firebase app ID from the reviewed plist inside the candidate script:

```bash
firebase_app_id="$(
  /usr/libexec/PlistBuddy \
    -c 'Print :GOOGLE_APP_ID' \
    ios/LifeSnapAction/GoogleService-Info.plist
)"
test -n "${firebase_app_id}"

RUNTIME_SERVICE_ACCOUNT=lifesnap-runtime@zhang23-23.iam.gserviceaccount.com
FIREBASE_PROJECT_ID=zhang23-23
FIREBASE_APP_ID="${firebase_app_id}"
FIRESTORE_DATABASE_ID=lifesnap-quota
INSTALLATION_HMAC_SECRET=lifesnap-installation-hmac-key
```

The candidate payload must:

- set `spec.template.spec.serviceAccountName` to the required runtime identity;
- preserve the existing Gemini Secret reference;
- add `INSTALLATION_HMAC_KEY` from `lifesnap-installation-hmac-key:latest`;
- add the three non-secret Firebase/Firestore environment values;
- set revision label `api-contract=v2-app-check`;
- keep current production traffic at 100% and add one tagged 0% candidate.

- [ ] **Step 3: Make the orchestrator stop after candidate validation**

The final sequence becomes:

```bash
install_release_traps
assert_current_main
capture_initial_state
access_token="$(gcloud auth print-access-token)"
deploy_candidate
resolve_candidate
verify_candidate_runtime
verify_candidate_endpoints
printf 'candidate_gate=PASS revision=%s url=%s promotion=BLOCKED_BY_DEVICE_SMOKE\n' \
  "${candidate_revision}" "${candidate_url}"
candidate_mutation_started=0
```

Remove automatic calls to `conditionally_promote_candidate` and production extraction from the Cloud Build path. On candidate validation failure, cleanup still removes only the candidate created by this build and restores prior service labels/traffic.

- [ ] **Step 4: Add the explicit promotion script**

The new script must require:

```bash
: "${CANDIDATE_REVISION:?CANDIDATE_REVISION is required}"
: "${CANDIDATE_TAG:?CANDIDATE_TAG is required}"
: "${EXPECTED_IMAGE_DIGEST:?EXPECTED_IMAGE_DIGEST is required}"
: "${EXPECTED_SOURCE_COMMIT:?EXPECTED_SOURCE_COMMIT is required}"
: "${DEVICE_SMOKE_EVIDENCE:?DEVICE_SMOKE_EVIDENCE is required}"
```

Before any mutation it must:

- reject an evidence file outside `docs/verification/yotei-snap-security/`;
- require it contains `app_attest_provider=PASS`, `v2_extract=PASS`, `replay_rejected=PASS`, and no forbidden fields;
- compute and print only the evidence SHA-256;
- re-read the Cloud Run service and candidate revision;
- require exact tag, 0%, digest, source commit, runtime identity, `api-contract=v2-app-check`, and Ready state;
- require current production still equals the revision observed before device smoke;
- conditionally replace the service by `resourceVersion` with one untagged 100% target to the candidate;
- run health/privacy and negative v2 production smoke;
- preserve rollback information and conditionally restore only if this promotion still owns the service.

No script accepts or prints an App Check token.

- [ ] **Step 5: Run contract tests and commit**

```bash
npx vitest run src/shared/__tests__/cloudbuild-contract.test.ts
npm test
npm run lint
npm run build
git add \
  cloudbuild.yaml \
  scripts/promote-and-verify.sh \
  scripts/promote-verified-candidate.sh \
  src/shared/__tests__/cloudbuild-contract.test.ts
git commit -m "feat: gate production on app attest smoke"
```

### Task 13: Complete Gate A local verification and independent review

**Files:**
- Modify only if failures reveal in-scope defects
- Read: all changed files

- [ ] **Step 1: Run every backend gate**

```bash
npm ci
npm test
npm run test:firestore
npm run lint
npm run build
npm run validate:ios-release
git diff --check
```

Expected: all pass. Record exact test counts. Do not omit the emulator suite from the report.

- [ ] **Step 2: Run Debug tests and Release build**

```bash
xcodebuild \
  -resolvePackageDependencies \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${simulator_udid}" \
  -derivedDataPath /tmp/yotei-security-tests \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/yotei-security-release \
  build -quiet
```

Expected: all iOS tests pass and Release builds with the production entitlement. This still does not satisfy real-device App Attest.

- [ ] **Step 3: Run secret and privacy scans**

```bash
rg -n \
  'X-Firebase-AppCheck.*[A-Za-z0-9_-]{20}|App Check debug token|INSTALLATION_HMAC_KEY=.+' \
  --glob '!docs/superpowers/**' \
  .

rg -n \
  'uploaded image|base64|raw Gemini|installation UUID|App Check token' \
  docs/app-store \
  docs/release \
  server.ts
```

Expected: the first scan finds no hard-coded token/key; the second confirms accurate disclosures rather than claiming no persistent operational data.

- [ ] **Step 4: Dispatch independent reviews**

Using subagent-driven development, request:

1. spec-compliance review against every section of the approved design;
2. code-quality/security review focused on fail-closed behavior, quota concurrency, log privacy, IAM scope, rollback ownership, and Release/Debug separation.

Fix every Critical/Important in-scope finding with focused tests and a separate commit. Do not route traffic while either review is unresolved.

- [ ] **Step 5: Confirm clean local state**

```bash
git log --oneline --decorate -15
git diff main...HEAD --stat
git diff --check main...HEAD
git status --short --branch
```

Expected: clean worktree and only approved security/rebrand scope.

### Task 14: Deploy zero traffic, prove App Attest on device, and cut over

**Files:**
- Create: `docs/verification/yotei-snap-security/device-app-attest-smoke.txt`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`
- External state: branch publication/merge, Cloud Build, Cloud Run traffic

- [ ] **Step 1: Publish the reviewed source needed by the release provenance gate**

Use the finishing-development-branch workflow. Push only the reviewed branch, create or update one PR, wait for required CI, and merge only if the repository’s current branch policy permits it. Re-read `origin/main` afterward and require the merge commit contains every Gate A commit.

Do not stage with `git add .`; list exact changed paths.

- [ ] **Step 2: Trigger the candidate-only Cloud Build**

Submit the exact merged `origin/main` source through the existing regional trigger or an equivalent build whose `COMMIT_SHA` equals remote main. Record:

- build ID;
- source commit;
- immutable image digest;
- candidate revision;
- candidate tag/URL;
- old production revision;
- runtime identity;
- `promotion=BLOCKED_BY_DEVICE_SMOKE`.

The build must leave production traffic unchanged.

- [ ] **Step 3: Verify Gate B and Gate C read-only**

Re-run:

- Firebase project/app/App Attest GET;
- Firestore database/TTL describe;
- project/Secret IAM policy inspection;
- Cloud Run candidate revision describe;
- candidate `/health` and `/privacy`;
- candidate v2 missing/invalid token rejection;
- candidate legacy synthetic extraction.

Check Cloud Logging for the exact candidate window. Prove negative v2 attempts have `gemini_invoked=false`. Do not retrieve or print request bodies.

- [ ] **Step 4: Build a real-device Release pointing to the candidate URL**

Use an installed Apple Development or Distribution identity whose Team ID
matches Firebase. Resolve exactly one available physical iPhone and reject
simulators or an ambiguous inventory:

```bash
physical_device_udid="$(
  xcrun xcdevice list --timeout 15 |
    jq -r '
      [
        .[] |
        select(
          .platform == "com.apple.platform.iphoneos" and
          .available == true and
          .simulator == false
        )
      ] |
      if length == 1
      then .[0].identifier
      else error("expected exactly one available physical iPhone")
      end
    '
)"
xcrun devicectl device info details \
  --device "${physical_device_udid}"
```

Require the inspected device to run iOS 17 or newer and to be trusted,
developer-mode enabled, and available. Then run the Release-configured live
XCTest with the candidate URL as an Xcode build setting:

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -destination "platform=iOS,id=${physical_device_udid}" \
  -only-testing:LifeSnapActionTests/AppAttestLiveSmokeTests/testLiveAppAttestAndReplayProtection \
  API_BASE_URL="${candidate_url}" \
  'OTHER_SWIFT_FLAGS=$(inherited) -DRUN_LIVE_APP_ATTEST_SMOKE' \
  test
```

Then archive the same Release configuration for entitlement inspection:

```bash
xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/YoteiSnap-AppCheck.xcarchive \
  API_BASE_URL="${candidate_url}" \
  archive
```

Never hard-code or commit the candidate URL. The project default remains the current production URL.

Inspect the archive:

```bash
codesign -d --entitlements :- \
  /tmp/YoteiSnap-AppCheck.xcarchive/Products/Applications/LifeSnapAction.app
```

Require the production App Attest entitlement and the expected application identifier.

- [ ] **Step 5: Run the candidate real-device smoke**

On a physical iOS 17+ device:

1. require the Release-configured live XCTest to pass on a physical iOS 17+ device;
2. require its first request to return HTTP 200 with a schema-complete result;
3. require its second, byte-identical request to return `401 APP_CHECK_REPLAYED`;
4. verify logs show one Gemini invocation for the valid request and zero for replay;
5. record only PASS/FAIL, timestamps, app version/build, candidate revision/digest, provider type, response status/code, and sanitized log query.

The evidence file must contain:

```text
app_attest_provider=PASS
v2_extract=PASS
replay_rejected=PASS
gemini_valid_request_count=1
gemini_replay_request_count=0
```

Do not record token, installation UUID/HMAC, image contents, or extracted JSON fields.

- [ ] **Step 6: Promote the exact candidate**

Run the separate promotion script with the exact observed values and evidence file:

```bash
CANDIDATE_REVISION="${candidate_revision}" \
CANDIDATE_TAG="${candidate_tag}" \
EXPECTED_IMAGE_DIGEST="${image_digest}" \
EXPECTED_SOURCE_COMMIT="${source_commit}" \
DEVICE_SMOKE_EVIDENCE="docs/verification/yotei-snap-security/device-app-attest-smoke.txt" \
PROJECT_ID=zhang23-23 \
DEPLOY_REGION=asia-northeast1 \
SERVICE_NAME=lifesnap-action \
./scripts/promote-verified-candidate.sh
```

Expected: a resource-version-conditional promotion to one untagged 100% candidate target. If any ownership or digest check differs, no mutation occurs.

- [ ] **Step 7: Run Gate E production smoke**

Verify:

- unchanged public URL;
- `/health` 200;
- `/privacy` current text;
- v2 no token and invalid token rejected/no-store/no Gemini;
- physical Release app valid v2 request succeeds once;
- replay is rejected;
- one legacy synthetic request succeeds unless the 50/day cap is already reached;
- actual service identity is the dedicated account;
- production traffic, latest created/ready, image digest, source labels, secrets, environment, and contract label are exact;
- logs contain no forbidden values.

If the valid production v2 smoke fails, use the promotion script’s ownership-safe rollback before distributing Build 4. Do not weaken App Check or quota.

- [ ] **Step 8: Commit sanitized evidence**

```bash
git add \
  docs/verification/yotei-snap-security/device-app-attest-smoke.txt \
  docs/release/yotei-snap-v1.1-app-store-release-gate.md
git commit -m "docs: record app check production evidence"
```

### Task 15: Establish the legacy retirement observation gate

**Files:**
- Create: `docs/release/yotei-snap-legacy-retirement.md`
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`
- No route removal or App Store Connect mutation

- [ ] **Step 1: Write the gate as an explicit state machine**

Create the retirement record with these machine-readable fields:

```text
build4_public_at=NOT_STARTED
minimum_observation_days=30
legacy_share_window_days=7
legacy_share_threshold_percent=5
day60_manual_review=REQUIRED_IF_NOT_ELIGIBLE
app_attest_incidents_open=UNKNOWN
retirement_authorization=NOT_GRANTED
route_state=OPEN_CAPPED_50_PER_TOKYO_DAY
```

Document the allowed transitions:

1. `NOT_STARTED` → dated observation only after Build 4 is confirmed publicly
   available in the Japan storefront;
2. `OBSERVING` → `ELIGIBLE_FOR_REVIEW` only after at least 30 public days,
   seven complete consecutive Tokyo calendar days below 5% legacy share, and no
   unresolved App Attest compatibility incident;
3. `ELIGIBLE_FOR_REVIEW` does not remove the route; it requires separate user
   approval and a new implementation plan;
4. day 60 without eligibility becomes `MANUAL_REVIEW_REQUIRED`, never automatic
   closure or indefinite silent retention.

- [ ] **Step 2: Record a reproducible, privacy-safe query**

Use route-category log counts only:

```bash
observation_start="2026-07-31T00:00:00Z"
observation_end="2026-08-01T00:00:00Z"
logging_filter="resource.type=\"cloud_run_revision\" AND
resource.labels.service_name=\"lifesnap-action\" AND
jsonPayload.event=\"extraction_completed\" AND
(jsonPayload.route_category=\"v2\" OR jsonPayload.route_category=\"legacy\") AND
timestamp>=\"${observation_start}\" AND
timestamp<\"${observation_end}\""
gcloud logging read "${logging_filter}" \
  --project=zhang23-23 \
  --format='value(jsonPayload.route_category)'
```

For each complete Asia/Tokyo day, calculate:

```text
legacy_share_percent = legacy_count / (legacy_count + v2_count) * 100
```

If the denominator is zero, mark the day `NO_TRAFFIC`; it does not count toward
the seven qualifying days. Store only dates, aggregate counts, computed
percentages, query window, and query timestamp. Do not store request IDs,
tokens, installation identifiers, images, or extracted content.

- [ ] **Step 3: Verify the clock has not started prematurely**

Because App Store upload/review/public release is outside this security rollout,
leave `build4_public_at=NOT_STARTED` unless storefront evidence is actually
observed. Confirm `/api/extract` remains open behind the 50-per-Tokyo-day hard
cap and that no script contains an automatic legacy shutdown.

Run:

```bash
rg -n \
  'build4_public_at=NOT_STARTED|retirement_authorization=NOT_GRANTED|route_state=OPEN_CAPPED_50_PER_TOKYO_DAY' \
  docs/release/yotei-snap-legacy-retirement.md
rg -n \
  'delete.*api/extract|disable.*api/extract|retire.*api/extract' \
  scripts cloudbuild.yaml src server.ts
```

Expected: the first command finds all three fail-closed states. The second finds
no automatic shutdown implementation; any documentation-only match is reviewed
manually.

- [ ] **Step 4: Commit the observation gate**

```bash
git add \
  docs/release/yotei-snap-legacy-retirement.md \
  docs/release/yotei-snap-v1.1-app-store-release-gate.md
git commit -m "docs: establish legacy retirement gate"
```

### Task 16: Final verification and handoff

**Files:**
- Modify: `docs/release/yotei-snap-v1.1-app-store-release-gate.md`
- Modify: `docs/app-store/app-review-notes.md`
- No App Store Connect mutation

- [ ] **Step 1: Re-run local gates from the final source**

```bash
npm ci
npm test
npm run test:firestore
npm run lint
npm run build
npm run validate:ios-release

xcodebuild \
  -project ios/LifeSnapAction.xcodeproj \
  -scheme LifeSnapAction \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${simulator_udid}" \
  -derivedDataPath /tmp/yotei-security-final \
  CODE_SIGNING_ALLOWED=NO \
  test -quiet

git diff --check
git status --short --branch
```

- [ ] **Step 2: Re-run final cloud read-only verification**

Capture exact:

- Firebase app ID and App Attest TTL;
- Firestore database/location/delete protection/TTL;
- runtime service account roles and conditions;
- Secret resource bindings;
- Cloud Run generation, revision, digest, source commit, service identity, traffic;
- v2/legacy route results and no-store;
- sanitized logging query results.

Do not call Cloud Billing API, print Secret values, or perform App Store actions.

- [ ] **Step 3: Update the release gate without overstating state**

Mark the backend security gate `PASS` only if Gate E and both independent reviews pass. Keep Archive, export validation, Build 4 upload, metadata save, App Review submission, approval, and storefront availability at their actually observed states.

The final report must include:

- files changed by task;
- every verification command and result;
- exact commits;
- live revision/digest/runtime identity/traffic;
- remaining risks, including App Check replay protection beta and the temporary legacy route;
- next action: Apple signing/archive/upload remains a separate approval boundary.

- [ ] **Step 4: Final Git review**

```bash
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
git status --short --branch
```

Expected: clean state. Do not mark the overall App Store release `GO` merely because backend security is complete.
