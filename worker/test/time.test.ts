import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  dateInTimeZone,
  differenceInLocalDays,
  isDateString,
  isTimeString,
  localDateTimeToInstant,
} from "../src/core/time";

describe("time utilities", () => {
  it("converts Shanghai local time to UTC", () => {
    expect(
      localDateTimeToInstant("2026-07-30", "08:15", "Asia/Shanghai").toISOString(),
    ).toBe("2026-07-30T00:15:00.000Z");
  });

  it("handles date arithmetic and formatting", () => {
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(differenceInLocalDays("2026-12-31", "2027-01-02")).toBe(2);
    expect(dateInTimeZone(new Date("2026-07-30T16:30:00.000Z"), "Asia/Shanghai")).toBe(
      "2026-07-31",
    );
  });

  it("rejects invalid calendar and clock values", () => {
    expect(isDateString("2026-02-29")).toBe(false);
    expect(isDateString("2028-02-29")).toBe(true);
    expect(isTimeString("24:00")).toBe(false);
    expect(isTimeString("23:59")).toBe(true);
  });
});
