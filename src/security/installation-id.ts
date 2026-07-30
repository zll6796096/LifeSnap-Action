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
