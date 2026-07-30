import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  cert,
  deleteApp,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { describe, expect, it, vi } from "vitest";
import {
  createProductionApp,
  type SecurityDependencies,
} from "../../../server";
import {
  buildRuntimeSecurity,
  type FirebaseFactory,
} from "../firebase";

const VALID_INSTALLATION_ID =
  "e8b18b25-64a6-4af9-b31f-9b0b6d3c3d4e";

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
  const credential = {
    getAccessToken: vi.fn(async () => ({
      access_token: "adc-test-token",
      expires_in: 3600,
    })),
  };
  const app = {
    name: "lifesnap-runtime",
    options: {
      credential,
      projectId: "zhang23-23",
    },
  };
  const verifyToken = vi.fn(async () => ({
    appId: "1:1234567890:ios:security-test",
    alreadyConsumed: false,
  }));
  const appCheck = { verifyToken };
  const firestore = {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  };
  const getApps = vi.fn<FirebaseFactory["getApps"]>(() => []);
  const initializeApp =
    vi.fn<FirebaseFactory["initializeApp"]>(() => app);
  const getAppCheck =
    vi.fn<FirebaseFactory["getAppCheck"]>(() => appCheck);
  const getFirestore =
    vi.fn<FirebaseFactory["getFirestore"]>(() => firestore);

  return {
    credential,
    app,
    appCheck,
    verifyToken,
    firestore,
    factory: {
      applicationDefault: vi.fn(() => credential),
      getApps,
      initializeApp,
      getAppCheck,
      getFirestore,
    },
  };
}

describe("production Firebase runtime", () => {
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

  it.each([
    "FIREBASE_PROJECT_ID",
    "FIREBASE_APP_ID",
    "FIRESTORE_DATABASE_ID",
    "INSTALLATION_HMAC_KEY",
  ])("fails closed when %s contains only whitespace", (name) => {
    const env = completeProductionEnv();
    env[name] = " \t ";

    expect(() => buildRuntimeSecurity(env)).toThrow(`${name} is required`);
  });

  it("rejects a project outside the approved production project", () => {
    const env = completeProductionEnv();
    env.FIREBASE_PROJECT_ID = "other-project";

    expect(() => buildRuntimeSecurity(env)).toThrow(
      "FIREBASE_PROJECT_ID must equal zhang23-23",
    );
  });

  it("rejects a database outside the approved named quota database", () => {
    const env = completeProductionEnv();
    env.FIRESTORE_DATABASE_ID = "(default)";

    expect(() => buildRuntimeSecurity(env)).toThrow(
      "FIRESTORE_DATABASE_ID must equal lifesnap-quota",
    );
  });

  it("rejects a short installation HMAC key before Firebase initialization", () => {
    const env = completeProductionEnv();
    env.INSTALLATION_HMAC_KEY = "short";

    expect(() => buildRuntimeSecurity(env)).toThrow(
      "INSTALLATION_HMAC_KEY must contain at least 32 characters",
    );
  });

  it.each([
    ["exactly", "r".repeat(48), "r".repeat(48)],
    [
      "after trimming surrounding whitespace",
      `  ${"s".repeat(48)}\t`,
      `\n${"s".repeat(48)}  `,
    ],
  ])(
    "rejects HMAC and Gemini secret reuse %s before Firebase initialization",
    (_case, hmacKey, geminiKey) => {
      const fake = fakeFirebaseFactory();
      const env = completeProductionEnv();
      env.INSTALLATION_HMAC_KEY = hmacKey;
      env.GEMINI_API_KEY = geminiKey;

      expect(() =>
        buildRuntimeSecurity(env, fake.factory),
      ).toThrow(
        "INSTALLATION_HMAC_KEY must not reuse GEMINI_API_KEY",
      );
      expect(fake.factory.getApps).not.toHaveBeenCalled();
      expect(fake.factory.applicationDefault).not.toHaveBeenCalled();
      expect(fake.factory.initializeApp).not.toHaveBeenCalled();
    },
  );

  it("builds ADC, consumed App Check, named Firestore, and deterministic HMAC dependencies", async () => {
    const fake = fakeFirebaseFactory();
    const env = completeProductionEnv();
    env.FIREBASE_CREDENTIALS_JSON = "must-not-be-read";
    env.FIREBASE_SERVICE_ACCOUNT_KEY = "must-not-be-read";

    const dependencies = buildRuntimeSecurity(env, fake.factory);
    await expect(
      dependencies.appCheckVerifier.verify("limited-use-token"),
    ).resolves.toEqual({
      appId: "1:1234567890:ios:security-test",
    });

    expect(fake.factory.applicationDefault).toHaveBeenCalledOnce();
    expect(fake.factory.initializeApp).toHaveBeenCalledWith(
      {
        credential: fake.credential,
        projectId: "zhang23-23",
      },
      "lifesnap-runtime",
    );
    expect(fake.factory.initializeApp).not.toHaveBeenCalledWith(
      expect.objectContaining({
        credentialPath: expect.anything(),
        serviceAccount: expect.anything(),
      }),
      expect.anything(),
    );
    expect(fake.factory.getAppCheck).toHaveBeenCalledWith(fake.app);
    expect(fake.verifyToken).toHaveBeenCalledWith(
      "limited-use-token",
      { consume: true },
    );
    expect(fake.factory.getFirestore).toHaveBeenCalledWith(
      fake.app,
      "lifesnap-quota",
    );
    expect(
      dependencies.hashInstallationId(VALID_INSTALLATION_ID),
    ).toBe(
      "bd17aee85c25963672b87bafc68ee4e8a13b9cabc671bf896f94adc17d79f6d9",
    );
    expect(dependencies.now()).toBeInstanceOf(Date);
  });

  it("reuses only the matching named Firebase app owned by the same ADC credential", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.getApps.mockReturnValue([fake.app]);

    buildRuntimeSecurity(completeProductionEnv(), fake.factory);

    expect(fake.factory.applicationDefault).toHaveBeenCalledOnce();
    expect(fake.factory.initializeApp).not.toHaveBeenCalled();
    expect(fake.factory.getAppCheck).toHaveBeenCalledWith(fake.app);
    expect(fake.factory.getFirestore).toHaveBeenCalledWith(
      fake.app,
      "lifesnap-quota",
    );
  });

  it("rejects a conflicting project on the existing named Firebase app", () => {
    const fake = fakeFirebaseFactory();
    const conflictingApp = {
      name: "lifesnap-runtime",
      options: {
        credential: fake.credential,
        projectId: "other-project",
      },
    };
    fake.factory.getApps.mockReturnValue([conflictingApp]);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APP_IDENTITY_INVALID");
    expect(fake.factory.applicationDefault).toHaveBeenCalledOnce();
    expect(fake.factory.initializeApp).not.toHaveBeenCalled();
    expect(fake.factory.getAppCheck).not.toHaveBeenCalled();
    expect(fake.factory.getFirestore).not.toHaveBeenCalled();
  });

  it("fails startup when Firebase returns a malformed app registry", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.getApps.mockReturnValue(undefined);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APPS_INVALID");
  });

  it("fails startup when the Firebase app registry contains malformed entries", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.getApps.mockReturnValue([{}]);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APPS_INVALID");
    expect(fake.factory.applicationDefault).toHaveBeenCalledOnce();
  });

  it("fails startup when ADC returns a malformed credential", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.applicationDefault.mockReturnValue(undefined as never);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_ADC_INVALID");
    expect(fake.factory.initializeApp).not.toHaveBeenCalled();
  });

  it("maps throwing ADC access and calls to stable non-secret startup failures", () => {
    const rawDependencyMessage =
      "RAW_ADC_DEPENDENCY_DETAIL_MUST_NOT_ESCAPE";
    const throwingCall = fakeFirebaseFactory();
    throwingCall.factory.applicationDefault.mockImplementation(() => {
      throw new Error(rawDependencyMessage);
    });

    const buildWithThrowingAdc = () =>
      buildRuntimeSecurity(
        completeProductionEnv(),
        throwingCall.factory,
      );
    expect(buildWithThrowingAdc).toThrow(
      new Error("FIREBASE_ADC_INVALID"),
    );

    const throwingAccess = fakeFirebaseFactory();
    const factoryWithAccessor = Object.defineProperty(
      { ...throwingAccess.factory },
      "applicationDefault",
      {
        get() {
          throw new Error(rawDependencyMessage);
        },
      },
    ) as FirebaseFactory;
    expect(() =>
      buildRuntimeSecurity(
        completeProductionEnv(),
        factoryWithAccessor,
      ),
    ).toThrow("FIREBASE_FACTORY_INVALID");

    const revoked = Proxy.revocable(
      throwingAccess.factory,
      {},
    );
    revoked.revoke();
    expect(() =>
      buildRuntimeSecurity(
        completeProductionEnv(),
        revoked.proxy,
      ),
    ).toThrow("FIREBASE_FACTORY_INVALID");
  });

  it("fails startup when Firebase initialization returns a conflicting app", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.initializeApp.mockReturnValue({
      name: "wrong-name",
      options: { projectId: "zhang23-23" },
    });

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APP_IDENTITY_INVALID");
    expect(fake.factory.getAppCheck).not.toHaveBeenCalled();
    expect(fake.factory.getFirestore).not.toHaveBeenCalled();
  });

  it("rejects duplicate matching Firebase apps", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.getApps.mockReturnValue([fake.app, fake.app]);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APP_IDENTITY_INVALID");
    expect(fake.factory.applicationDefault).toHaveBeenCalledOnce();
    expect(fake.factory.initializeApp).not.toHaveBeenCalled();
    expect(fake.factory.getAppCheck).not.toHaveBeenCalled();
  });

  it("rejects a same-project named app with a distinct credential", () => {
    const fake = fakeFirebaseFactory();
    const customCredential = {
      getAccessToken: vi.fn(async () => ({
        access_token: "custom-test-token",
        expires_in: 3600,
      })),
    };
    fake.factory.getApps.mockReturnValue([
      {
        name: "lifesnap-runtime",
        options: {
          credential: customCredential,
          projectId: "zhang23-23",
        },
      },
    ]);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APP_IDENTITY_INVALID");
    expect(fake.factory.applicationDefault).toHaveBeenCalledOnce();
    expect(fake.factory.initializeApp).not.toHaveBeenCalled();
    expect(fake.factory.getAppCheck).not.toHaveBeenCalled();
  });

  it("rejects unexpected security-affecting options on the named app", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.getApps.mockReturnValue([
      {
        name: "lifesnap-runtime",
        options: {
          credential: fake.credential,
          projectId: "zhang23-23",
          serviceAccountId: "unexpected@example.invalid",
        },
      },
    ]);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APP_IDENTITY_INVALID");
    expect(fake.factory.getAppCheck).not.toHaveBeenCalled();
  });

  it("rejects stateful own name and options getters without rereading them", () => {
    const fake = fakeFirebaseFactory();
    let nameReads = 0;
    let optionsReads = 0;
    const statefulApp = {
      get name() {
        nameReads += 1;
        return nameReads === 1
          ? "lifesnap-runtime"
          : "different-app";
      },
      get options() {
        optionsReads += 1;
        return {
          credential: fake.credential,
          projectId: "zhang23-23",
        };
      },
    };
    fake.factory.getApps.mockReturnValue([statefulApp]);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APPS_INVALID");
    expect(nameReads).toBe(0);
    expect(optionsReads).toBe(0);
    expect(fake.factory.getAppCheck).not.toHaveBeenCalled();
  });

  it("maps throwing and revoked app snapshots to stable startup failures", () => {
    const throwingApp = Object.defineProperties({}, {
      name: {
        get() {
          throw new Error("DEPENDENCY_DETAIL_MUST_NOT_ESCAPE");
        },
      },
      options: {
        value: {},
      },
    });
    const revoked = Proxy.revocable(
      {
        name: "lifesnap-runtime",
        options: {},
      },
      {},
    );
    revoked.revoke();

    for (const candidate of [throwingApp, revoked.proxy]) {
      const fake = fakeFirebaseFactory();
      fake.factory.getApps.mockReturnValue([candidate]);

      expect(() =>
        buildRuntimeSecurity(completeProductionEnv(), fake.factory),
      ).toThrow("FIREBASE_APPS_INVALID");
    }
  });

  it("rejects a real Firebase Admin certificate-owned named app without a network call", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
    });
    const certificateCredential = cert({
      projectId: "zhang23-23",
      clientEmail: "runtime-test@example.invalid",
      privateKey,
    });
    const certificateApp = initializeApp(
      {
        credential: certificateCredential,
        projectId: "zhang23-23",
      },
      "lifesnap-runtime",
    );

    try {
      expect(() =>
        buildRuntimeSecurity(completeProductionEnv()),
      ).toThrow("FIREBASE_APP_IDENTITY_INVALID");
    } finally {
      await deleteApp(certificateApp);
    }
  });

  it("accepts the pinned Firebase Admin ADC app shape without a network call", async () => {
    let runtimeApp:
      | ReturnType<typeof initializeApp>
      | undefined;
    try {
      const dependencies = buildRuntimeSecurity(
        completeProductionEnv(),
      );
      runtimeApp = getApps().find(
        (candidate) => candidate.name === "lifesnap-runtime",
      );

      expect(runtimeApp).toBeDefined();
      expect(
        dependencies.hashInstallationId(
          VALID_INSTALLATION_ID,
        ),
      ).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      const appToDelete =
        runtimeApp ??
        getApps().find(
          (candidate) =>
            candidate.name === "lifesnap-runtime",
        );
      if (appToDelete !== undefined) {
        await deleteApp(appToDelete);
      }
    }
  });

  it("fails startup when Firebase returns a malformed App Check client", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.getAppCheck.mockReturnValue({});

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("APP_CHECK_CLIENT_INVALID");
    expect(fake.factory.getFirestore).not.toHaveBeenCalled();
  });

  it("fails startup when Firebase returns a malformed Firestore client", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.getFirestore.mockReturnValue({
      collection: vi.fn(),
    });

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIRESTORE_CLIENT_INVALID");
  });

  it("pins bound Firestore methods against post-construction replacement", async () => {
    const fake = fakeFirebaseFactory();
    const documentReference = {};
    const set = vi.fn();
    const originalCollection = vi.fn(() => ({
      doc: vi.fn(() => documentReference),
    }));
    const originalRunTransaction = vi.fn(
      async (
        callback: (transaction: {
          getAll: (
            ...references: unknown[]
          ) => Promise<
            { exists: boolean; data: () => undefined }[]
          >;
          set: typeof set;
        }) => Promise<unknown>,
      ) =>
        callback({
          getAll: async (...references) =>
            references.map(() => ({
              exists: false,
              data: () => undefined,
            })),
          set,
        }),
    );
    fake.firestore.collection = originalCollection;
    fake.firestore.runTransaction = originalRunTransaction;
    const dependencies = buildRuntimeSecurity(
      completeProductionEnv(),
      fake.factory,
    );
    const replacementCollection = vi.fn(() => {
      throw new Error("REPLACEMENT_COLLECTION_MUST_NOT_RUN");
    });
    const replacementRunTransaction = vi.fn(async () => ({
      allowed: true as const,
    }));
    fake.firestore.collection = replacementCollection;
    fake.firestore.runTransaction = replacementRunTransaction;

    await expect(
      dependencies.quotaStore.consume(
        { kind: "legacy" },
        new Date("2026-07-31T00:00:00Z"),
      ),
    ).resolves.toEqual({ allowed: true });

    expect(originalCollection).toHaveBeenCalledOnce();
    expect(originalCollection.mock.contexts[0]).toBe(fake.firestore);
    expect(originalRunTransaction).toHaveBeenCalledOnce();
    expect(originalRunTransaction.mock.contexts[0]).toBe(
      fake.firestore,
    );
    expect(set).toHaveBeenCalledOnce();
    expect(replacementCollection).not.toHaveBeenCalled();
    expect(replacementRunTransaction).not.toHaveBeenCalled();
  });

  it("snapshots benign Firestore method getters exactly once", async () => {
    const fake = fakeFirebaseFactory();
    let collectionReads = 0;
    let transactionReads = 0;
    const set = vi.fn();
    const collection = vi.fn(() => ({
      doc: vi.fn(() => ({})),
    }));
    const runTransaction = vi.fn(
      async (
        callback: (transaction: {
          getAll: (
            ...references: unknown[]
          ) => Promise<
            { exists: boolean; data: () => undefined }[]
          >;
          set: typeof set;
        }) => Promise<unknown>,
      ) =>
        callback({
          getAll: async (...references) =>
            references.map(() => ({
              exists: false,
              data: () => undefined,
            })),
          set,
        }),
    );
    const firestore = {
      get collection() {
        collectionReads += 1;
        return collection;
      },
      get runTransaction() {
        transactionReads += 1;
        return runTransaction;
      },
    };
    fake.factory.getFirestore.mockReturnValue(firestore);

    const dependencies = buildRuntimeSecurity(
      completeProductionEnv(),
      fake.factory,
    );
    expect(collectionReads).toBe(1);
    expect(transactionReads).toBe(1);

    await dependencies.quotaStore.consume(
      { kind: "legacy" },
      new Date("2026-07-31T00:00:00Z"),
    );

    expect(collectionReads).toBe(1);
    expect(transactionReads).toBe(1);
    expect(collection.mock.contexts[0]).toBe(firestore);
    expect(runTransaction.mock.contexts[0]).toBe(firestore);
  });

  it("maps hostile and revoked Firestore clients to stable construction failures", () => {
    const hostileFirestore = Object.defineProperty(
      {},
      "collection",
      {
        get() {
          throw new Error("DEPENDENCY_DETAIL_MUST_NOT_ESCAPE");
        },
      },
    );
    const revoked = Proxy.revocable(
      {
        collection: vi.fn(),
        runTransaction: vi.fn(),
      },
      {},
    );
    revoked.revoke();

    for (const firestore of [
      hostileFirestore,
      revoked.proxy,
    ]) {
      const fake = fakeFirebaseFactory();
      fake.factory.getFirestore.mockReturnValue(firestore);

      expect(() =>
        buildRuntimeSecurity(completeProductionEnv(), fake.factory),
      ).toThrow("FIRESTORE_CLIENT_INVALID");
    }
  });

  it("constructs production security before creating the listenable app", () => {
    const env = completeProductionEnv();
    const calls: string[] = [];
    const security = {
      appCheckVerifier: {
        verify: vi.fn(async () => ({ appId: env.FIREBASE_APP_ID! })),
      },
      quotaStore: {
        consume: vi.fn(async () => ({ allowed: true as const })),
      },
      hashInstallationId: vi.fn(() => "a".repeat(64)),
      now: vi.fn(() => new Date("2026-07-31T00:00:00Z")),
    } satisfies SecurityDependencies;
    const listenableApp = { listen: vi.fn() };
    const buildSecurity = vi.fn(() => {
      calls.push("security");
      return security;
    });
    const createApplication = vi.fn(() => {
      calls.push("app");
      return listenableApp as never;
    });

    const app = createProductionApp(env, {
      buildRuntimeSecurity: buildSecurity,
      createApp: createApplication,
    });

    expect(app).toBe(listenableApp);
    expect(calls).toEqual(["security", "app"]);
    expect(buildSecurity).toHaveBeenCalledWith(env);
    expect(createApplication).toHaveBeenCalledWith({ env, security });
  });

  it("does not create a listenable app when production security construction fails", () => {
    const env = completeProductionEnv();
    const createApplication = vi.fn();
    const startupFailure = new Error("FIREBASE_APP_ID is required");

    expect(() =>
      createProductionApp(env, {
        buildRuntimeSecurity: vi.fn(() => {
          throw startupFailure;
        }),
        createApp: createApplication,
      }),
    ).toThrow(startupFailure);
    expect(createApplication).not.toHaveBeenCalled();
  });

  it("documents the exact ADC runtime environment without credential files or key reuse", () => {
    const example = readFileSync(
      new URL("../../../.env.example", import.meta.url),
      "utf8",
    );

    expect(example).toContain('FIREBASE_PROJECT_ID="zhang23-23"');
    expect(example).toContain('FIREBASE_APP_ID=""');
    expect(example).toContain(
      'FIRESTORE_DATABASE_ID="lifesnap-quota"',
    );
    expect(example).toContain('INSTALLATION_HMAC_KEY=""');
    expect(example).toMatch(/Application Default Credentials|ADC/);
    expect(example).toContain("distinct Secret Manager value");
    expect(example).toContain("must never reuse GEMINI_API_KEY");
    expect(example).not.toMatch(
      /FIREBASE_(?:CREDENTIALS_JSON|SERVICE_ACCOUNT_KEY)\s*=/,
    );
  });
});
