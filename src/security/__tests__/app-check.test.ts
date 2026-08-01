import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AppCheckRequestError,
  ConsumedAppCheckVerifier,
  type VerifyToken,
} from "../app-check";

const APPROVED_APP_ID = "1:1234567890:ios:security-test";
const suppliedToken = "app-check-token-that-must-not-leak";
const decodedClaims = "decoded-claims-that-must-not-leak";
const sdkMessage = "firebase-sdk-message-that-must-not-leak";
const require = createRequire(import.meta.url);

type CodedError = Error & { code?: string; cause?: unknown };

type FirebaseAppLike = { options: { projectId: string } };

type InternalTokenVerifier = {
  verifyToken(token: string): Promise<unknown>;
  signatureVerifier: { verify(token: string): Promise<void> };
};

type InternalReplayProtectionClient = {
  verifyReplayProtection(token: string): Promise<boolean>;
  httpClient: { send(): Promise<{ data: { alreadyConsumed: unknown } }> };
};

function codedError(code?: string, cause?: unknown): CodedError {
  return Object.assign(new Error(sdkMessage), { code, cause });
}

async function captureRejection(attempt: () => Promise<unknown>): Promise<unknown> {
  try {
    await attempt();
  } catch (error) {
    return error;
  }

  throw new Error("Expected Firebase Admin to reject");
}

function firebaseApp(): FirebaseAppLike {
  return { options: { projectId: "security-test" } };
}

function sdkVerificationToken(): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return [
    encode({ alg: "RS256", kid: "test-kid" }),
    encode({
      aud: ["projects/security-test"],
      iss: "https://firebaseappcheck.googleapis.com/security-test",
      sub: APPROVED_APP_ID,
    }),
    "unsigned-signature",
  ].join(".");
}

async function createFirebaseAdminTokenVerifier(): Promise<InternalTokenVerifier> {
  const firebaseAdmin = require(
    path.resolve(
      process.cwd(),
      "node_modules/firebase-admin/lib/app-check/token-verifier.js",
    ),
  ) as {
    AppCheckTokenVerifier: new (app: FirebaseAppLike) => InternalTokenVerifier;
  };

  return new firebaseAdmin.AppCheckTokenVerifier(firebaseApp());
}

async function createFirebaseAdminReplayClient(): Promise<InternalReplayProtectionClient> {
  const firebaseAdmin = require(
    path.resolve(
      process.cwd(),
      "node_modules/firebase-admin/lib/app-check/app-check-api-client-internal.js",
    ),
  ) as {
    AppCheckApiClient: new (app: FirebaseAppLike) => InternalReplayProtectionClient;
  };

  return new firebaseAdmin.AppCheckApiClient(firebaseApp());
}

async function expectRequestError(
  attempt: () => Promise<unknown>,
  status: 401 | 403 | 503,
  code:
    | "APP_CHECK_REQUIRED"
    | "APP_CHECK_INVALID"
    | "APP_CHECK_REPLAYED"
    | "APP_ID_FORBIDDEN"
    | "SECURITY_SERVICE_UNAVAILABLE",
): Promise<AppCheckRequestError> {
  try {
    await attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(AppCheckRequestError);
    const requestError = error as AppCheckRequestError;
    expect(requestError.status).toBe(status);
    expect(requestError.code).toBe(code);
    expect(requestError.message).toBe(code);
    return requestError;
  }

  throw new Error("Expected ConsumedAppCheckVerifier to reject");
}

describe("ConsumedAppCheckVerifier", () => {
  function createVerifier(verifyToken: VerifyToken) {
    return new ConsumedAppCheckVerifier(verifyToken, APPROVED_APP_ID);
  }

  it.each([undefined, "", " \n\t "])(
    "rejects a missing or blank token before invoking Firebase: %j",
    async (token) => {
      const verifyToken = vi.fn<VerifyToken>();
      const verifier = createVerifier(verifyToken);

      await expectRequestError(
        () => verifier.verify(token),
        401,
        "APP_CHECK_REQUIRED",
      );

      expect(verifyToken).not.toHaveBeenCalled();
    },
  );

  it("consumes an approved token and returns only the app identity", async () => {
    const verifyToken = vi.fn<VerifyToken>().mockResolvedValue({
      appId: APPROVED_APP_ID,
      alreadyConsumed: false,
    });
    const verifier = createVerifier(verifyToken);

    await expect(verifier.verify(` ${suppliedToken} `)).resolves.toEqual({
      appId: APPROVED_APP_ID,
    });
    expect(verifyToken).toHaveBeenCalledExactlyOnceWith(
      ` ${suppliedToken} `,
      { consume: true },
    );
  });

  it("accepts a successful Firebase response when alreadyConsumed is omitted", async () => {
    const verifyToken = vi.fn<VerifyToken>().mockResolvedValue({
      appId: APPROVED_APP_ID,
    });

    await expect(createVerifier(verifyToken).verify(suppliedToken)).resolves.toEqual({
      appId: APPROVED_APP_ID,
    });
  });

  it("rejects a consumed token", async () => {
    const verifyToken = vi.fn<VerifyToken>().mockResolvedValue({
      appId: APPROVED_APP_ID,
      alreadyConsumed: true,
    });

    await expectRequestError(
      () => createVerifier(verifyToken).verify(suppliedToken),
      401,
      "APP_CHECK_REPLAYED",
    );
  });

  it("rejects an identity that was not issued for the approved app", async () => {
    const verifyToken = vi.fn<VerifyToken>().mockResolvedValue({
      appId: "1:0987654321:ios:other-app",
      alreadyConsumed: true,
    });

    await expectRequestError(
      () => createVerifier(verifyToken).verify(suppliedToken),
      403,
      "APP_ID_FORBIDDEN",
    );
  });

  it.each([
    "app-check/invalid-argument",
    "app-check/app-check-token-expired",
  ])("maps invalid Firebase App Check code %s to an unauthorized response", async (code) => {
    const verifyToken = vi.fn<VerifyToken>().mockRejectedValue(codedError(code));

    await expectRequestError(
      () => createVerifier(verifyToken).verify(suppliedToken),
      401,
      "APP_CHECK_INVALID",
    );
  });

  it.each(["ECONNRESET", "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT"])(
    "maps top-level network code %s to service unavailable",
    async (code) => {
      const verifyToken = vi.fn<VerifyToken>().mockRejectedValue(codedError(code));

      await expectRequestError(
        () => createVerifier(verifyToken).verify(suppliedToken),
        503,
        "SECURITY_SERVICE_UNAVAILABLE",
      );
    },
  );

  it.each(["ECONNRESET", "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT"])(
    "maps nested network code %s to service unavailable",
    async (code) => {
      const verifyToken = vi
        .fn<VerifyToken>()
        .mockRejectedValue(codedError("WRAPPER", codedError("WRAPPER", codedError(code))));

      await expectRequestError(
        () => createVerifier(verifyToken).verify(suppliedToken),
        503,
        "SECURITY_SERVICE_UNAVAILABLE",
      );
    },
  );

  it("prioritizes a nested network cause over an invalid-token wrapper", async () => {
    const verifyToken = vi
      .fn<VerifyToken>()
      .mockRejectedValue(codedError("app-check/invalid-argument", codedError("ENETUNREACH")));

    await expectRequestError(
      () => createVerifier(verifyToken).verify(suppliedToken),
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );
  });

  it.each(["permission-denied", "failed-precondition", undefined])(
    "fails closed for Firebase permission, configuration, or unknown errors: %s",
    async (code) => {
      const verifyToken = vi.fn<VerifyToken>().mockRejectedValue(codedError(code));

      await expectRequestError(
        () => createVerifier(verifyToken).verify(suppliedToken),
        503,
        "SECURITY_SERVICE_UNAVAILABLE",
      );
    },
  );

  it("does not leak the supplied token, decoded claims, or Firebase error message", async () => {
    const verifyToken = vi.fn<VerifyToken>().mockRejectedValue(
      Object.assign(codedError("app-check/invalid-argument"), {
        decodedClaims,
      }),
    );

    const error = await expectRequestError(
      () => createVerifier(verifyToken).verify(suppliedToken),
      401,
      "APP_CHECK_INVALID",
    );
    const exposedText = [error.message, error.stack, JSON.stringify(error)].join(" ");

    expect(exposedText).not.toContain(suppliedToken);
    expect(exposedText).not.toContain(decodedClaims);
    expect(exposedText).not.toContain(sdkMessage);
  });

  it("treats firebase-admin 13.10 JWKS fetch failures as unavailable despite its invalid-argument alias", async () => {
    const firebaseVerifier = await createFirebaseAdminTokenVerifier();
    const jwksNetworkFailure = Object.assign(
      new Error(`Error fetching Json Web Keys: getaddrinfo ENETUNREACH ${sdkMessage}`),
      { code: "key-fetch-error" },
    );
    firebaseVerifier.signatureVerifier.verify = vi
      .fn()
      .mockRejectedValue(jwksNetworkFailure);
    const dependencyError = await captureRejection(() =>
      firebaseVerifier.verifyToken(sdkVerificationToken()),
    );

    expect(dependencyError).toMatchObject({ code: "app-check/invalid-argument" });
    expect((dependencyError as Error).message).toContain("Error fetching Json Web Keys:");

    const verifyToken = vi.fn<VerifyToken>().mockRejectedValue(dependencyError);
    const error = await expectRequestError(
      () => createVerifier(verifyToken).verify(suppliedToken),
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );

    expect([error.message, error.stack, JSON.stringify(error)].join(" ")).not.toContain(
      sdkMessage,
    );
  });

  it("treats firebase-admin 13.10 malformed replay-protection responses as unavailable", async () => {
    const replayClient = await createFirebaseAdminReplayClient();
    replayClient.httpClient = {
      send: vi.fn().mockResolvedValue({ data: { alreadyConsumed: "malformed" } }),
    };
    const dependencyError = await captureRejection(() =>
      replayClient.verifyReplayProtection(suppliedToken),
    );

    expect(dependencyError).toMatchObject({ code: "app-check/invalid-argument" });
    expect((dependencyError as Error).message).toBe(
      "`alreadyConsumed` must be a boolean value.",
    );

    await expectRequestError(
      () =>
        createVerifier(vi.fn<VerifyToken>().mockRejectedValue(dependencyError)).verify(
          suppliedToken,
        ),
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );
  });

  it("keeps firebase-admin's ordinary malformed token response unauthorized", async () => {
    const firebaseVerifier = await createFirebaseAdminTokenVerifier();
    const dependencyError = await captureRejection(() =>
      firebaseVerifier.verifyToken("not-a-jwt"),
    );

    expect(dependencyError).toMatchObject({ code: "app-check/invalid-argument" });

    await expectRequestError(
      () =>
        createVerifier(vi.fn<VerifyToken>().mockRejectedValue(dependencyError)).verify(
          suppliedToken,
        ),
      401,
      "APP_CHECK_INVALID",
    );
  });

  it("sanitizes a dependency-thrown AppCheckRequestError instead of preserving it", async () => {
    const dependencyError = new AppCheckRequestError(401, "APP_CHECK_REQUIRED");
    Object.assign(dependencyError, {
      code: "dependency-secret-code",
      message: sdkMessage,
    });

    const error = await expectRequestError(
      () =>
        createVerifier(vi.fn<VerifyToken>().mockRejectedValue(dependencyError)).verify(
          suppliedToken,
        ),
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );
    expect([error.message, error.stack, JSON.stringify(error)].join(" ")).not.toContain(
      sdkMessage,
    );
  });

  it.each([
    ["a revoked proxy", () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      return proxy;
    }],
    ["a proxy with a hostile getPrototypeOf", () => new Proxy({}, {
      getPrototypeOf() {
        throw new Error(sdkMessage);
      },
    })],
  ])("sanitizes dependency rejection from %s without logging", async (_description, createError) => {
    const log = vi.spyOn(console, "log");
    const info = vi.spyOn(console, "info");
    const warn = vi.spyOn(console, "warn");
    const errorLog = vi.spyOn(console, "error");

    try {
      const error = await expectRequestError(
        () =>
          createVerifier(vi.fn<VerifyToken>().mockRejectedValue(createError())).verify(
            suppliedToken,
          ),
        503,
        "SECURITY_SERVICE_UNAVAILABLE",
      );

      expect([error.message, error.stack, JSON.stringify(error)].join(" ")).not.toContain(
        sdkMessage,
      );
      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      info.mockRestore();
      warn.mockRestore();
      errorLog.mockRestore();
    }
  });

  it("bounds cause traversal, including cycles and a sixth nested cause", async () => {
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    await expectRequestError(
      () => createVerifier(vi.fn<VerifyToken>().mockRejectedValue(cycle)).verify(suppliedToken),
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );

    let sixthCause: unknown = codedError("ENOTFOUND");
    for (let index = 0; index < 6; index += 1) {
      sixthCause = codedError("WRAPPER", sixthCause);
    }
    await expectRequestError(
      () => createVerifier(vi.fn<VerifyToken>().mockRejectedValue(sixthCause)).verify(suppliedToken),
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );

    let seventhCause: unknown = codedError("ENOTFOUND");
    for (let index = 0; index < 7; index += 1) {
      seventhCause = codedError("WRAPPER", seventhCause);
    }
    await expectRequestError(
      () =>
        createVerifier(
          vi
            .fn<VerifyToken>()
            .mockRejectedValue(codedError("app-check/invalid-argument", seventhCause)),
        ).verify(suppliedToken),
      401,
      "APP_CHECK_INVALID",
    );
  });

  it("fails closed when a dependency error throws while its cause is inspected", async () => {
    const throwingCause = {};
    Object.defineProperty(throwingCause, "cause", {
      get() {
        throw new Error(sdkMessage);
      },
    });

    const error = await expectRequestError(
      () =>
        createVerifier(vi.fn<VerifyToken>().mockRejectedValue(throwingCause)).verify(
          suppliedToken,
        ),
      503,
      "SECURITY_SERVICE_UNAVAILABLE",
    );
    expect([error.message, error.stack, JSON.stringify(error)].join(" ")).not.toContain(
      sdkMessage,
    );
  });
});
