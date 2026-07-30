import {
  applicationDefault,
  getApps,
  initializeApp,
  type App,
  type Credential,
} from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import {
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import { FirestoreQuotaStore } from "../quota/firestore-quota-store";
import {
  ConsumedAppCheckVerifier,
  type AppCheckClaims,
} from "../security/app-check";
import { hashInstallationId } from "../security/installation-id";

const FIREBASE_APP_NAME = "lifesnap-runtime";
const FIREBASE_PROJECT_ID = "zhang23-23";
const FIRESTORE_DATABASE_ID = "lifesnap-quota";

export type FirebaseFactory = {
  applicationDefault: () => Credential;
  getApps: () => unknown;
  initializeApp: (
    options: { credential: Credential; projectId: string },
    appName: string,
  ) => unknown;
  getAppCheck: (app: App) => unknown;
  getFirestore: (app: App, databaseId: string) => unknown;
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
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function readProperty(
  value: Record<PropertyKey, unknown>,
  key: PropertyKey,
): unknown {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function asFirebaseApp(value: unknown): App {
  if (!isRecord(value)) {
    throw new Error("FIREBASE_APP_INVALID");
  }
  const name = readProperty(value, "name");
  const options = readProperty(value, "options");
  const projectId =
    isRecord(options) ? readProperty(options, "projectId") : undefined;
  if (
    name !== FIREBASE_APP_NAME ||
    projectId !== FIREBASE_PROJECT_ID
  ) {
    throw new Error("FIREBASE_APP_IDENTITY_INVALID");
  }
  return value as unknown as App;
}

function asFirestore(value: unknown): Firestore {
  if (!isRecord(value)) {
    throw new Error("FIRESTORE_CLIENT_INVALID");
  }
  const collection = readProperty(value, "collection");
  const runTransaction = readProperty(value, "runTransaction");
  if (
    typeof collection !== "function" ||
    typeof runTransaction !== "function"
  ) {
    throw new Error("FIRESTORE_CLIENT_INVALID");
  }
  return value as unknown as Firestore;
}

function appCheckVerifier(value: unknown, allowedAppId: string) {
  if (!isRecord(value)) {
    throw new Error("APP_CHECK_CLIENT_INVALID");
  }
  const verifyToken = readProperty(value, "verifyToken");
  if (typeof verifyToken !== "function") {
    throw new Error("APP_CHECK_CLIENT_INVALID");
  }

  return new ConsumedAppCheckVerifier(
    async (token, options): Promise<AppCheckClaims> => {
      const result: unknown = await Reflect.apply(
        verifyToken,
        value,
        [token, options],
      );
      if (!isRecord(result)) {
        throw new Error("APP_CHECK_RESPONSE_INVALID");
      }
      const appId = readProperty(result, "appId");
      const alreadyConsumed = readProperty(
        result,
        "alreadyConsumed",
      );
      if (
        typeof appId !== "string" ||
        (alreadyConsumed !== undefined &&
          typeof alreadyConsumed !== "boolean")
      ) {
        throw new Error("APP_CHECK_RESPONSE_INVALID");
      }
      return { appId, alreadyConsumed };
    },
    allowedAppId,
  );
}

export function buildRuntimeSecurity(
  env: NodeJS.ProcessEnv,
  factory: FirebaseFactory = productionFirebaseFactory,
) {
  const projectId = required(env, "FIREBASE_PROJECT_ID");
  const appId = required(env, "FIREBASE_APP_ID");
  const databaseId = required(env, "FIRESTORE_DATABASE_ID");
  const hmacKey = required(env, "INSTALLATION_HMAC_KEY");

  if (projectId !== FIREBASE_PROJECT_ID) {
    throw new Error(
      `FIREBASE_PROJECT_ID must equal ${FIREBASE_PROJECT_ID}`,
    );
  }
  if (databaseId !== FIRESTORE_DATABASE_ID) {
    throw new Error(
      `FIRESTORE_DATABASE_ID must equal ${FIRESTORE_DATABASE_ID}`,
    );
  }
  if (hmacKey.length < 32) {
    throw new Error(
      "INSTALLATION_HMAC_KEY must contain at least 32 characters",
    );
  }
  const geminiApiKey = env.GEMINI_API_KEY?.trim();
  if (geminiApiKey && hmacKey === geminiApiKey) {
    throw new Error(
      "INSTALLATION_HMAC_KEY must not reuse GEMINI_API_KEY",
    );
  }

  const apps = factory.getApps();
  if (!Array.isArray(apps)) {
    throw new Error("FIREBASE_APPS_INVALID");
  }
  for (const candidate of apps) {
    if (
      !isRecord(candidate) ||
      typeof readProperty(candidate, "name") !== "string" ||
      !isRecord(readProperty(candidate, "options"))
    ) {
      throw new Error("FIREBASE_APPS_INVALID");
    }
  }
  const existing = apps.find(
    (candidate) =>
      isRecord(candidate) &&
      readProperty(candidate, "name") === FIREBASE_APP_NAME,
  );

  let firebaseApp: App;
  if (existing === undefined) {
    const credential = factory.applicationDefault();
    if (
      !isRecord(credential) ||
      typeof readProperty(credential, "getAccessToken") !== "function"
    ) {
      throw new Error("FIREBASE_ADC_INVALID");
    }
    firebaseApp = asFirebaseApp(
      factory.initializeApp(
        { credential, projectId },
        FIREBASE_APP_NAME,
      ),
    );
  } else {
    firebaseApp = asFirebaseApp(existing);
  }

  const verifier = appCheckVerifier(
    factory.getAppCheck(firebaseApp),
    appId,
  );
  const firestore = asFirestore(
    factory.getFirestore(firebaseApp, databaseId),
  );

  return Object.freeze({
    appCheckVerifier: verifier,
    quotaStore: new FirestoreQuotaStore(firestore),
    hashInstallationId: (value: string) =>
      hashInstallationId(value, hmacKey),
    now: () => new Date(),
  });
}
