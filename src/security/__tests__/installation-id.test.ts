import { describe, expect, it } from "vitest";
import {
  canonicalizeInstallationId,
  hashInstallationId,
} from "../installation-id";

describe("installation identifier", () => {
  const id = "E8B18B25-64A6-4AF9-B31F-9B0B6D3C3D4E";
  const keyOne = "1".repeat(32);
  const keyTwo = "2".repeat(32);

  it("canonicalizes a UUID without retaining the source in the digest", () => {
    expect(canonicalizeInstallationId(id)).toBe(id.toLowerCase());

    const digest = hashInstallationId(id, keyOne);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(id.toLowerCase());
  });

  it("rejects non-UUID identifiers", () => {
    expect(() => canonicalizeInstallationId("device-123")).toThrow(
      "INSTALLATION_ID_INVALID",
    );
  });

  it("uses a keyed digest", () => {
    expect(hashInstallationId(id, keyOne)).not.toBe(
      hashInstallationId(id, keyTwo),
    );
  });

  it("rejects a short HMAC key", () => {
    expect(() => hashInstallationId(id, "too-short")).toThrow(
      "INSTALLATION_HMAC_KEY must contain at least 32 characters",
    );
  });
});
