import { describe, expect, it } from "vitest";
import {
  buildQuotaBuckets,
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

  it("returns Retry-After to the next Tokyo day", () => {
    expect(secondsUntilNextTokyoDay(new Date("2026-07-31T14:59:59Z"))).toBe(1);
  });
});
