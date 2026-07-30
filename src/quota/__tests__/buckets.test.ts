import { describe, expect, it } from "vitest";
import {
  buildQuotaBuckets,
  secondsUntilNextMinute,
  secondsUntilNextTokyoDay,
} from "../buckets";

describe("quota buckets", () => {
  it("uses Asia/Tokyo for the daily key", () => {
    const beforeMidnight = new Date("2026-07-31T14:59:59.000Z");
    const afterMidnight = new Date("2026-07-31T15:00:00.000Z");

    expect(buildQuotaBuckets(beforeMidnight).tokyoDay).toBe("2026-07-31");
    expect(buildQuotaBuckets(afterMidnight).tokyoDay).toBe("2026-08-01");
  });

  it("uses UTC epoch minutes for exact minute windows", () => {
    const result = buildQuotaBuckets(new Date("2026-07-31T01:02:59.999Z"));

    expect(result.epochMinute).toBe(
      Math.floor(Date.parse("2026-07-31T01:02:00Z") / 60_000),
    );
  });

  it("aligns minuteStart to the exact UTC minute boundary", () => {
    expect(
      buildQuotaBuckets(new Date("2026-07-31T01:02:59.999Z"))
        .minuteStart.toISOString(),
    ).toBe("2026-07-31T01:02:00.000Z");
    expect(
      buildQuotaBuckets(new Date("2026-07-31T01:03:00.000Z"))
        .minuteStart.toISOString(),
    ).toBe("2026-07-31T01:03:00.000Z");
  });

  it("returns Retry-After to the next UTC minute", () => {
    expect(secondsUntilNextMinute(new Date("2026-07-31T01:02:59.999Z"))).toBe(1);
    expect(secondsUntilNextMinute(new Date("2026-07-31T01:03:00.000Z"))).toBe(60);
  });

  it("aligns Tokyo day starts and Retry-After at midnight", () => {
    const beforeMidnight = new Date("2026-07-31T14:59:59.000Z");
    const atMidnight = new Date("2026-07-31T15:00:00.000Z");

    expect(buildQuotaBuckets(beforeMidnight).tokyoDayStart.toISOString()).toBe(
      "2026-07-30T15:00:00.000Z",
    );
    expect(secondsUntilNextTokyoDay(beforeMidnight)).toBe(1);
    expect(buildQuotaBuckets(atMidnight).tokyoDayStart.toISOString()).toBe(
      "2026-07-31T15:00:00.000Z",
    );
    expect(secondsUntilNextTokyoDay(atMidnight)).toBe(86_400);
  });
});
