import { readFileSync } from "node:fs";
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
    options: { projectId: "zhang23-23" },
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

  it("reuses the matching named Firebase app without recreating credentials", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.getApps.mockReturnValue([fake.app]);

    buildRuntimeSecurity(completeProductionEnv(), fake.factory);

    expect(fake.factory.applicationDefault).not.toHaveBeenCalled();
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
      options: { projectId: "other-project" },
    };
    fake.factory.getApps.mockReturnValue([conflictingApp]);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_APP_IDENTITY_INVALID");
    expect(fake.factory.applicationDefault).not.toHaveBeenCalled();
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
    expect(fake.factory.applicationDefault).not.toHaveBeenCalled();
  });

  it("fails startup when ADC returns a malformed credential", () => {
    const fake = fakeFirebaseFactory();
    fake.factory.applicationDefault.mockReturnValue(undefined as never);

    expect(() =>
      buildRuntimeSecurity(completeProductionEnv(), fake.factory),
    ).toThrow("FIREBASE_ADC_INVALID");
    expect(fake.factory.initializeApp).not.toHaveBeenCalled();
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
