import type { BarkMessage } from "../integrations/bark";
import {
  addLocalDays,
  compareDates,
  dateInTimeZone,
  differenceInLocalDays,
  localDateTimeToInstant,
} from "../core/time";

export type InjectionSide = "left" | "right";

export interface InjectionMessageInput {
  name: string;
  dose: string;
  site: string;
  instructions: string;
  startDate: string;
  endDate: string | null;
  localTime: string;
  intervalDays: number;
  firstSide: InjectionSide;
}

export function medicationMessage(input: {
  name: string;
  dose: string;
  instructions: string;
}): BarkMessage {
  const dose = input.dose ? ` ${input.dose}` : "";
  const instructions = input.instructions ? `\n${input.instructions}` : "";
  return {
    title: "服药提醒",
    body: `${input.name}${dose}${instructions}`,
    group: "health-medication",
    level: "timeSensitive",
  };
}

export function eventMessage(input: {
  type: string;
  title: string;
  location: string;
  notes: string;
}): BarkMessage {
  const labels: Record<string, string> = {
    registration: "挂号提醒",
    checkup: "检查提醒",
    follow_up: "复诊提醒",
    other: "事项提醒",
  };
  const groups: Record<string, string> = {
    registration: "health-event-registration",
    checkup: "health-event-checkup",
    follow_up: "health-event-follow_up",
    other: "health-event-other",
  };
  return {
    title: labels[input.type] || "事项提醒",
    body: [input.title, input.location, input.notes].filter(Boolean).join("\n"),
    group: groups[input.type] || "health-event-other",
    level: "timeSensitive",
  };
}

export function injectionMessage(
  input: Pick<InjectionMessageInput, "name" | "dose" | "site" | "instructions">,
  side: InjectionSide,
): BarkMessage {
  const dose = input.dose ? ` ${input.dose}` : "";
  const sideLabel = side === "left" ? "左侧" : "右侧";
  const site = input.site ? `${input.site}${sideLabel}` : sideLabel;
  const instructions = input.instructions ? `\n${input.instructions}` : "";
  return {
    title: "注射提醒",
    body: `${input.name}${dose}\n注射部位：${site}${instructions}`,
    group: "health-injection",
    level: "timeSensitive",
  };
}

export function nextInjectionOccurrence(
  input: InjectionMessageInput,
  now = new Date(),
  timeZone = "Asia/Shanghai",
): { date: string; side: InjectionSide } | null {
  const today = dateInTimeZone(now, timeZone);
  let date = compareDates(input.startDate, today) >= 0 ? input.startDate : today;
  const elapsed = differenceInLocalDays(input.startDate, date);
  const remainder = elapsed % input.intervalDays;
  if (remainder !== 0) date = addLocalDays(date, input.intervalDays - remainder);

  if (
    date === today &&
    localDateTimeToInstant(date, input.localTime, timeZone).getTime() < now.getTime()
  ) {
    date = addLocalDays(date, input.intervalDays);
  }
  if (input.endDate && compareDates(date, input.endDate) > 0) return null;

  const injectionNumber = differenceInLocalDays(input.startDate, date) / input.intervalDays;
  const side = injectionNumber % 2 === 0
    ? input.firstSide
    : input.firstSide === "left" ? "right" : "left";
  return { date, side };
}
