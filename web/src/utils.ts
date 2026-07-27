export const BUSINESS_TIME_ZONE = "Asia/Shanghai";

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

export function toDateInput(value: string): string {
  return partsInBusinessTimeZone(new Date(value)).slice(0, 3).join("-");
}

export function toDateTimeInput(value: string): string {
  const [year, month, day, hour, minute] = partsInBusinessTimeZone(new Date(value));
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function fromDateTimeInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("日期时间格式无效");
  }
  return new Date(`${value}:00+08:00`).toISOString();
}

export function todayInBusinessTimeZone(now = new Date()): string {
  return partsInBusinessTimeZone(now).slice(0, 3).join("-");
}

export function addDateDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

function partsInBusinessTimeZone(value: Date): string[] {
  const values = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value).map((part) => [part.type, part.value]),
  );
  return ["year", "month", "day", "hour", "minute"].map((part) => values.get(part) || "");
}
