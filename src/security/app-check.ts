export interface AppCheckClaims {
  appId: string;
  alreadyConsumed?: boolean;
}

export type VerifyToken = (
  token: string,
  options: { consume: true },
) => Promise<AppCheckClaims>;

export interface AppCheckIdentity {
  appId: string;
}

export type AppCheckRequestErrorCode =
  | "APP_CHECK_REQUIRED"
  | "APP_CHECK_INVALID"
  | "APP_CHECK_REPLAYED"
  | "APP_ID_FORBIDDEN"
  | "SECURITY_SERVICE_UNAVAILABLE";

export class AppCheckRequestError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code: AppCheckRequestErrorCode;

  constructor(status: 401 | 403 | 503, code: AppCheckRequestErrorCode) {
    super(code);
    this.name = "AppCheckRequestError";
    this.status = status;
    this.code = code;
  }
}

export const INVALID_CODES = new Set([
  "app-check/invalid-argument",
  "app-check/app-check-token-expired",
]);

export const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function readProperty(value: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  if (!isObject(error)) {
    return undefined;
  }

  const code = readProperty(error, "code");
  return typeof code === "string" ? code : undefined;
}

export function hasNetworkCause(error: unknown): boolean {
  let current = error;
  const visited = new Set<object>();

  for (let depth = 0; depth <= 6; depth += 1) {
    if (!isObject(current) || visited.has(current)) {
      return false;
    }
    visited.add(current);

    const code = errorCode(current);
    if (code !== undefined && NETWORK_CODES.has(code)) {
      return true;
    }

    if (depth === 6) {
      return false;
    }
    current = readProperty(current, "cause");
  }

  return false;
}

export class ConsumedAppCheckVerifier {
  constructor(
    private readonly verifyToken: VerifyToken,
    private readonly allowedAppId: string,
  ) {}

  async verify(token: string | undefined): Promise<AppCheckIdentity> {
    if (typeof token !== "string" || token.trim().length === 0) {
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
      if (error instanceof AppCheckRequestError) {
        throw error;
      }
      if (hasNetworkCause(error)) {
        throw new AppCheckRequestError(503, "SECURITY_SERVICE_UNAVAILABLE");
      }
      const code = errorCode(error);
      if (code !== undefined && INVALID_CODES.has(code)) {
        throw new AppCheckRequestError(401, "APP_CHECK_INVALID");
      }

      throw new AppCheckRequestError(503, "SECURITY_SERVICE_UNAVAILABLE");
    }
  }
}
