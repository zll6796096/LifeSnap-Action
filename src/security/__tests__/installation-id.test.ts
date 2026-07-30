import { describe, expect, it } from "vitest";
import {
  canonicalizeInstallationId,
  hashInstallationId,
} from "../installation-id";

describe("installation identifier", () => {
  const id = "E8B18B25-64A6-4AF9-B31F-9B0B6D3C3D4E";
  const keyOne = "1".repeat(32);
  const keyTwo = "2".repeat(32);
  const knownDigest =
    "d9e7e17e1fcdf386b09d5ed363de2ef6fa71f9658b5d8ec87f2a1b783713ab67";

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

  it("matches the known HMAC vector after canonicalization", () => {
    expect(hashInstallationId(id.toLowerCase(), keyOne)).toBe(knownDigest);
    expect(hashInstallationId(`  ${id}  `, keyOne)).toBe(knownDigest);
  });

  it.each([
    "123e4567-e89b-12d3-8456-426614174000",
    "123e4567-e89b-12d3-b456-426614174000",
    "123e4567-e89b-22d3-8456-426614174000",
    "123e4567-e89b-22d3-b456-426614174000",
    "123e4567-e89b-32d3-8456-426614174000",
    "123e4567-e89b-32d3-b456-426614174000",
    "123e4567-e89b-42d3-8456-426614174000",
    "123e4567-e89b-42d3-b456-426614174000",
    "123e4567-e89b-52d3-8456-426614174000",
    "123e4567-e89b-52d3-b456-426614174000",
  ])("accepts RFC UUID versions 1 through 5: %s", (uuid) => {
    expect(canonicalizeInstallationId(uuid)).toBe(uuid);
  });

  it.each([
    "123e4567-e89b-02d3-8456-426614174000",
    "123e4567-e89b-62d3-8456-426614174000",
    "123e4567-e89b-42d3-7456-426614174000",
  ])("rejects an unsupported UUID version or variant: %s", (uuid) => {
    expect(() => canonicalizeInstallationId(uuid)).toThrow(
      "INSTALLATION_ID_INVALID",
    );
  });

  it("rejects a short HMAC key", () => {
    expect(() => hashInstallationId(id, "too-short")).toThrow(
      "INSTALLATION_HMAC_KEY must contain at least 32 characters",
    );
  });
});
