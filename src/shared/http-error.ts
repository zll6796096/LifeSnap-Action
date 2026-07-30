const PUBLIC_HTTP_ERROR_BRAND = Symbol("PublicHttpError");

export class PublicHttpError extends Error {
  readonly [PUBLIC_HTTP_ERROR_BRAND] = true;

  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "PublicHttpError";
  }
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

export function isPublicHttpError(
  error: unknown,
): error is PublicHttpError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const record = error as Record<PropertyKey, unknown>;
  return (
    readProperty(record, PUBLIC_HTTP_ERROR_BRAND) === true &&
    typeof readProperty(record, "statusCode") === "number" &&
    typeof readProperty(record, "code") === "string" &&
    typeof readProperty(record, "publicMessage") === "string"
  );
}
