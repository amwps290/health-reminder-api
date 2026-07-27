import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../core/errors";
import { parseJson } from "../core/http";
import { addLocalDays, dateInTimeZone, isDateString } from "../core/time";
import { DEFAULT_PROFILE_ID, getConfig, type AppContext } from "../core/types";

const PREGNANCY_DUE_DAYS = 280;

const pregnancyInput = z
  .object({
    calibratedOn: z.string().refine(isDateString, "必须是 YYYY-MM-DD 日期"),
    weeks: z.number().int().min(0).max(45),
    days: z.number().int().min(0).max(6),
  })
  .refine((value) => toGestationalDays(value.weeks, value.days) <= 315, {
    message: "孕周不能超过 45 周",
    path: ["weeks"],
  });

interface PregnancyRow {
  profile_id: string;
  calibrated_on: string;
  gestational_days: number;
  created_at: string;
  updated_at: string;
}

export const pregnancyRoutes = new Hono<AppContext>();

pregnancyRoutes.get("/", async (context) => {
  const row = await getPregnancyRow(context.env.DB);
  const today = dateInTimeZone(new Date(), getConfig(context.env).timeZone);
  return context.json({ data: serializePregnancy(row, today) });
});

pregnancyRoutes.put("/", async (context) => {
  const input = await parseJson(context, pregnancyInput);
  const today = dateInTimeZone(new Date(), getConfig(context.env).timeZone);
  if (input.calibratedOn > today) {
    throw new AppError(400, "INVALID_PREGNANCY_CALIBRATION_DATE", "校准日期不能晚于今天");
  }
  const now = new Date().toISOString();
  const gestationalDays = toGestationalDays(input.weeks, input.days);

  await context.env.DB
    .prepare(
      `INSERT INTO pregnancy_settings (
         profile_id, calibrated_on, gestational_days, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         calibrated_on = excluded.calibrated_on,
         gestational_days = excluded.gestational_days,
         updated_at = excluded.updated_at`,
    )
    .bind(DEFAULT_PROFILE_ID, input.calibratedOn, gestationalDays, now, now)
    .run();

  return context.json({ data: serializePregnancy(await getPregnancyRow(context.env.DB), today) });
});

pregnancyRoutes.delete("/", async (context) => {
  await context.env.DB
    .prepare("DELETE FROM pregnancy_settings WHERE profile_id = ?")
    .bind(DEFAULT_PROFILE_ID)
    .run();
  return context.body(null, 204);
});

async function getPregnancyRow(database: D1Database): Promise<PregnancyRow | null> {
  return await database
    .prepare("SELECT * FROM pregnancy_settings WHERE profile_id = ?")
    .bind(DEFAULT_PROFILE_ID)
    .first<PregnancyRow>();
}

function serializePregnancy(row: PregnancyRow | null, today: string) {
  if (!row) {
    return { configured: false, today };
  }

  const currentTotalDays = row.gestational_days + diffLocalDays(row.calibrated_on, today);
  if (currentTotalDays < 0) {
    throw new AppError(409, "PREGNANCY_CALIBRATION_IN_FUTURE", "孕周校准日期晚于今天");
  }

  const dueDate = addLocalDays(row.calibrated_on, PREGNANCY_DUE_DAYS - row.gestational_days);
  return {
    configured: true,
    today,
    calibratedOn: row.calibrated_on,
    calibrationWeeks: Math.floor(row.gestational_days / 7),
    calibrationDays: row.gestational_days % 7,
    currentWeeks: Math.floor(currentTotalDays / 7),
    currentDays: currentTotalDays % 7,
    currentTotalDays,
    dueDate,
    daysUntilDue: diffLocalDays(today, dueDate),
    updatedAt: row.updated_at,
  };
}

function toGestationalDays(weeks: number, days: number): number {
  return weeks * 7 + days;
}

function diffLocalDays(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const fromTime = Date.UTC(fromYear!, fromMonth! - 1, fromDay);
  const toTime = Date.UTC(toYear!, toMonth! - 1, toDay);
  return Math.round((toTime - fromTime) / 86_400_000);
}
