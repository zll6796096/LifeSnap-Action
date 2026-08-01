import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QuotaPolicy, QuotaScope } from "../contracts";
import { FirestoreQuotaStore } from "../firestore-quota-store";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is required for the Firestore quota integration test",
  );
}

const PROJECT_ID = "demo-lifesnap";
const NOW = new Date("2026-07-31T01:02:34.567Z");
const INSTALLATION_HASH = "b".repeat(64);
const EPOCH_MINUTE = Math.floor(NOW.getTime() / 60_000);
const TOKYO_DAY = "2026-07-31";
const SCOPE: QuotaScope = {
  kind: "v2",
  installationHash: INSTALLATION_HASH,
};
const POLICY: QuotaPolicy = {
  installPerMinute: 3,
  installPerDay: 5,
  v2PerDay: 7,
  legacyPerDay: 2,
};

let app: App;

function testDocumentReferences() {
  const db = getFirestore(app);
  return [
    db
      .collection("install_minute")
      .doc(`${INSTALLATION_HASH}:${EPOCH_MINUTE}`),
    db
      .collection("install_day")
      .doc(`${INSTALLATION_HASH}:${TOKYO_DAY}`),
    db.collection("service_day").doc(`v2:${TOKYO_DAY}`),
    db.collection("service_day").doc(`legacy:${TOKYO_DAY}`),
  ];
}

async function clearTestDocuments(): Promise<void> {
  await Promise.all(testDocumentReferences().map((ref) => ref.delete()));
}

describe("FirestoreQuotaStore emulator", () => {
  beforeAll(async () => {
    app = initializeApp(
      { projectId: PROJECT_ID },
      `quota-integration-${process.pid}-${Date.now()}`,
    );
    await clearTestDocuments();
  });

  afterAll(async () => {
    await clearTestDocuments();
    await deleteApp(app);
  });

  it("atomically enforces the smallest limit under concurrent consumption", async () => {
    const db = getFirestore(app);
    const store = new FirestoreQuotaStore(db, POLICY);

    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => store.consume(SCOPE, NOW)),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(
      POLICY.installPerMinute,
    );
    expect(
      decisions.filter(
        (decision) =>
          !decision.allowed && decision.code === "INSTALL_RATE_LIMITED",
      ),
    ).toHaveLength(10 - POLICY.installPerMinute);

    const [minuteSnapshot, installDaySnapshot, v2ServiceSnapshot] =
      await Promise.all(
        testDocumentReferences()
          .slice(0, 3)
          .map((ref) => ref.get()),
      );
    expect(minuteSnapshot.data()?.count).toBe(POLICY.installPerMinute);
    expect(installDaySnapshot.data()?.count).toBe(POLICY.installPerMinute);
    expect(v2ServiceSnapshot.data()?.count).toBe(POLICY.installPerMinute);

    await expect(store.consume({ kind: "legacy" }, NOW)).resolves.toEqual({
      allowed: true,
    });
    const [v2AfterLegacy, legacySnapshot] = await Promise.all(
      testDocumentReferences().slice(2).map((ref) => ref.get()),
    );
    expect(v2AfterLegacy.data()?.count).toBe(POLICY.installPerMinute);
    expect(legacySnapshot.data()?.count).toBe(1);
  }, 15_000);
});
