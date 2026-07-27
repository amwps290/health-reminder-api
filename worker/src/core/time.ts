const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

export function isTimeString(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function isInstantString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

export function dateInTimeZone(instant: Date, timeZone: string): string {
  const parts = getParts(instant, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function addLocalDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${pad(result.getUTCFullYear(), 4)}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

export function differenceInLocalDays(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(toYear!, toMonth! - 1, toDay!) - Date.UTC(fromYear!, fromMonth! - 1, fromDay!)) /
      86_400_000,
  );
}

export function compareDates(left: string, right: string): number {
  return left.localeCompare(right);
}

export function laterDate(left: string, right: string): string {
  return compareDates(left, right) >= 0 ? left : right;
}

export function earlierDate(left: string, right: string): string {
  return compareDates(left, right) <= 0 ? left : right;
}

export function eachLocalDate(from: string, through: string): string[] {
  const dates: string[] = [];
  for (let current = from; compareDates(current, through) <= 0; current = addLocalDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

export function localDateTimeToInstant(
  date: string,
  localTime: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const desiredAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0, 0);
  let candidate = desiredAsUtc;

  // Two passes resolve the zone offset without assuming a fixed UTC offset.
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = getParts(new Date(candidate), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate += desiredAsUtc - actualAsUtc;
  }

  return new Date(candidate);
}

export function toIso(value: Date | string): string {
  return (typeof value === "string" ? new Date(value) : value).toISOString();
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getParts(instant: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as unknown as DateParts;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}
