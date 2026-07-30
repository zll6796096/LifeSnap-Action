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

type CodedError = Error & { code?: string; cause?: unknown };

function codedError(code?: string, cause?: unknown): CodedError {
  return Object.assign(new Error(sdkMessage), { code, cause });
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
});
