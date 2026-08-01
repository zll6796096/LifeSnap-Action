const TOKYO_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;
const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function tokyoDateParts(now: Date) {
  const parts = TOKYO_DATE_FORMATTER.formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return { year: value("year"), month: value("month"), day: value("day") };
}

export function buildQuotaBuckets(now: Date) {
  const { year, month, day } = tokyoDateParts(now);
  const minuteStart = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000,
  );
  const tokyoDayStart = new Date(
    Date.UTC(year, month - 1, day) - TOKYO_OFFSET_MILLISECONDS,
  );

  return {
    epochMinute: Math.floor(now.getTime() / 60_000),
    tokyoDay: [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0"),
    ].join("-"),
    minuteStart,
    tokyoDayStart,
  };
}

export function secondsUntilNextMinute(now: Date): number {
  return 60 - (Math.floor(now.getTime() / 1000) % 60);
}

export function secondsUntilNextTokyoDay(now: Date): number {
  const { year, month, day } = tokyoDateParts(now);
  const nextMidnightUtc =
    Date.UTC(year, month - 1, day + 1) - TOKYO_OFFSET_MILLISECONDS;

  return Math.max(1, Math.ceil((nextMidnightUtc - now.getTime()) / 1000));
}
