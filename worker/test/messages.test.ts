import { describe, expect, it } from "vitest";
import {
  eventMessage,
  injectionMessage,
  medicationMessage,
  nextInjectionOccurrence,
} from "../src/scheduler/messages";

describe("notification messages", () => {
  it("builds the same content used by scheduled jobs", () => {
    expect(medicationMessage({ name: "钙片", dose: "1 片", instructions: "饭后" })).toMatchObject({
      title: "服药提醒",
      body: "钙片 1 片\n饭后",
      group: "health-medication",
    });
    expect(eventMessage({ type: "checkup", title: "产检", location: "医院", notes: "带资料" })).toMatchObject({
      title: "检查提醒",
      body: "产检\n医院\n带资料",
      group: "health-event-checkup",
    });
    expect(injectionMessage({ name: "肝素", dose: "1 支", site: "腹部", instructions: "遵医嘱" }, "right")).toMatchObject({
      title: "注射提醒",
      body: "肝素 1 支\n注射部位：腹部右侧\n遵医嘱",
    });
  });

  it("uses a distinct Bark group for every event type", () => {
    const base = { title: "事项", location: "", notes: "" };
    expect(eventMessage({ ...base, type: "registration" }).group).toBe("health-event-registration");
    expect(eventMessage({ ...base, type: "checkup" }).group).toBe("health-event-checkup");
    expect(eventMessage({ ...base, type: "follow_up" }).group).toBe("health-event-follow_up");
    expect(eventMessage({ ...base, type: "other" }).group).toBe("health-event-other");
  });

  it("uses the next real injection occurrence to choose the test side", () => {
    const plan = {
      name: "肝素",
      dose: "1 支",
      site: "腹部",
      instructions: "",
      startDate: "2026-07-25",
      endDate: null,
      localTime: "20:00",
      intervalDays: 2,
      firstSide: "left" as const,
    };
    expect(nextInjectionOccurrence(plan, new Date("2026-07-27T10:00:00.000Z"))).toEqual({
      date: "2026-07-27",
      side: "right",
    });
    expect(nextInjectionOccurrence(plan, new Date("2026-07-27T13:00:00.000Z"))).toEqual({
      date: "2026-07-29",
      side: "left",
    });
    expect(nextInjectionOccurrence(
      { ...plan, endDate: "2026-07-27" },
      new Date("2026-07-27T13:00:00.000Z"),
    )).toBeNull();
  });
});
