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

function stableError(code: string): Error {
  return new Error(code);
}

function snapshotProperty(
  value: Record<PropertyKey, unknown>,
  key: PropertyKey,
  errorCode: string,
): unknown {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) {
        throw stableError(errorCode);
      }
      return descriptor.value;
    }
    return Reflect.get(value, key);
  } catch {
    throw stableError(errorCode);
  }
}

function snapshotCallable(
  value: Record<PropertyKey, unknown>,
  key: PropertyKey,
  errorCode: string,
): (...args: unknown[]) => unknown {
  const candidate = snapshotProperty(value, key, errorCode);
  if (typeof candidate !== "function") {
    throw stableError(errorCode);
  }
  return candidate as (...args: unknown[]) => unknown;
}

function callDependency(
  method: (...args: unknown[]) => unknown,
  receiver: object,
  args: unknown[],
  errorCode: string,
): unknown {
  try {
    return Reflect.apply(method, receiver, args);
  } catch {
    throw stableError(errorCode);
  }
}

type FirebaseFactorySnapshot = Readonly<{
  receiver: object;
  applicationDefault: (...args: unknown[]) => unknown;
  getApps: (...args: unknown[]) => unknown;
  initializeApp: (...args: unknown[]) => unknown;
  getAppCheck: (...args: unknown[]) => unknown;
  getFirestore: (...args: unknown[]) => unknown;
}>;

function snapshotFactory(factory: FirebaseFactory): FirebaseFactorySnapshot {
  if (!isRecord(factory)) {
    throw stableError("FIREBASE_FACTORY_INVALID");
  }
  return Object.freeze({
    receiver: factory,
    applicationDefault: snapshotCallable(
      factory,
      "applicationDefault",
      "FIREBASE_FACTORY_INVALID",
    ),
    getApps: snapshotCallable(
      factory,
      "getApps",
      "FIREBASE_FACTORY_INVALID",
    ),
    initializeApp: snapshotCallable(
      factory,
      "initializeApp",
      "FIREBASE_FACTORY_INVALID",
    ),
    getAppCheck: snapshotCallable(
      factory,
      "getAppCheck",
      "FIREBASE_FACTORY_INVALID",
    ),
    getFirestore: snapshotCallable(
      factory,
      "getFirestore",
      "FIREBASE_FACTORY_INVALID",
    ),
  });
}

type FirebaseAppSnapshot = Readonly<{
  app: App;
  name: string;
  projectId: unknown;
  credential: unknown;
  optionKeys: readonly PropertyKey[];
}>;

function snapshotFirebaseApp(
  value: unknown,
  errorCode: string,
): FirebaseAppSnapshot {
  if (!isRecord(value)) {
    throw stableError(errorCode);
  }

  const name = snapshotProperty(value, "name", errorCode);
  const options = snapshotProperty(value, "options", errorCode);
  if (typeof name !== "string" || !isRecord(options)) {
    throw stableError(errorCode);
  }

  let optionKeys: PropertyKey[];
  let optionsPrototype: object | null;
  try {
    optionKeys = Reflect.ownKeys(options);
    optionsPrototype = Reflect.getPrototypeOf(options);
  } catch {
    throw stableError(errorCode);
  }
  if (
    optionsPrototype !== Object.prototype &&
    optionsPrototype !== null
  ) {
    throw stableError(errorCode);
  }

  const projectId = snapshotProperty(options, "projectId", errorCode);
  const credential = snapshotProperty(
    options,
    "credential",
    errorCode,
  );
  return Object.freeze({
    app: value as unknown as App,
    name,
    projectId,
    credential,
    optionKeys: Object.freeze([...optionKeys]),
  });
}

function validateRuntimeAppIdentity(
  snapshot: FirebaseAppSnapshot,
  adcCredential: unknown,
): App {
  const allowedOptionKeys = new Set<PropertyKey>([
    "credential",
    "projectId",
  ]);
  if (
    snapshot.name !== FIREBASE_APP_NAME ||
    snapshot.projectId !== FIREBASE_PROJECT_ID ||
    snapshot.credential !== adcCredential ||
    snapshot.optionKeys.length !== allowedOptionKeys.size ||
    snapshot.optionKeys.some((key) => !allowedOptionKeys.has(key))
  ) {
    throw stableError("FIREBASE_APP_IDENTITY_INVALID");
  }
  return snapshot.app;
}

function asFirestore(value: unknown): Firestore {
  if (!isRecord(value)) {
    throw new Error("FIRESTORE_CLIENT_INVALID");
  }
  let collection: unknown;
  let runTransaction: unknown;
  try {
    collection = Reflect.get(value, "collection");
    runTransaction = Reflect.get(value, "runTransaction");
  } catch {
    throw stableError("FIRESTORE_CLIENT_INVALID");
  }
  if (
    typeof collection !== "function" ||
    typeof runTransaction !== "function"
  ) {
    throw new Error("FIRESTORE_CLIENT_INVALID");
  }
  const receiver = value;
  return Object.freeze({
    collection: (...args: unknown[]) =>
      Reflect.apply(collection, receiver, args),
    runTransaction: (...args: unknown[]) =>
      Reflect.apply(runTransaction, receiver, args),
  }) as unknown as Firestore;
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

  const firebase = snapshotFactory(factory);
  const credential = callDependency(
    firebase.applicationDefault,
    firebase.receiver,
    [],
    "FIREBASE_ADC_INVALID",
  );
  if (!isRecord(credential)) {
    throw stableError("FIREBASE_ADC_INVALID");
  }
  snapshotCallable(
    credential,
    "getAccessToken",
    "FIREBASE_ADC_INVALID",
  );

  const appsValue = callDependency(
    firebase.getApps,
    firebase.receiver,
    [],
    "FIREBASE_APPS_INVALID",
  );
  let appSnapshots: FirebaseAppSnapshot[];
  try {
    if (!Array.isArray(appsValue)) {
      throw stableError("FIREBASE_APPS_INVALID");
    }
    appSnapshots = appsValue.map((candidate) =>
      snapshotFirebaseApp(candidate, "FIREBASE_APPS_INVALID"),
    );
  } catch {
    throw stableError("FIREBASE_APPS_INVALID");
  }
  const matchingApps = appSnapshots.filter(
    (candidate) => candidate.name === FIREBASE_APP_NAME,
  );
  if (matchingApps.length > 1) {
    throw stableError("FIREBASE_APP_IDENTITY_INVALID");
  }

  let firebaseApp: App;
  if (matchingApps.length === 0) {
    const initializedApp = callDependency(
      firebase.initializeApp,
      firebase.receiver,
      [
        { credential, projectId },
        FIREBASE_APP_NAME,
      ],
      "FIREBASE_APP_INVALID",
    );
    firebaseApp = validateRuntimeAppIdentity(
      snapshotFirebaseApp(
        initializedApp,
        "FIREBASE_APP_INVALID",
      ),
      credential,
    );
  } else {
    firebaseApp = validateRuntimeAppIdentity(
      matchingApps[0],
      credential,
    );
  }

  const verifier = appCheckVerifier(
    callDependency(
      firebase.getAppCheck,
      firebase.receiver,
      [firebaseApp],
      "APP_CHECK_CLIENT_INVALID",
    ),
    appId,
  );
  const firestore = asFirestore(
    callDependency(
      firebase.getFirestore,
      firebase.receiver,
      [firebaseApp, databaseId],
      "FIRESTORE_CLIENT_INVALID",
    ),
  );

  return Object.freeze({
    appCheckVerifier: verifier,
    quotaStore: new FirestoreQuotaStore(firestore),
    hashInstallationId: (value: string) =>
      hashInstallationId(value, hmacKey),
    now: () => new Date(),
  });
}
