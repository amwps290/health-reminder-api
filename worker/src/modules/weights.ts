import { Hono } from "hono";
import { z } from "zod";
import { AppError, conflict, notFound } from "../core/errors";
import { parseJson } from "../core/http";
import { dateInTimeZone, isDateString } from "../core/time";
import { DEFAULT_PROFILE_ID, getConfig, type AppContext } from "../core/types";

const weightInput = z.object({
  measuredOn: z.string().refine(isDateString, "必须是 YYYY-MM-DD 日期"),
  weightKg: z.number().finite().min(20).max(350),
  note: z.string().trim().max(500).default(""),
});

interface WeightRow {
  id: string;
  measured_on: string;
  weight_kg: number;
  note: string;
  created_at: string;
  updated_at: string;
}

export const weightRoutes = new Hono<AppContext>();

weightRoutes.get("/", async (context) => {
  const { results } = await context.env.DB
    .prepare(
      `SELECT id, measured_on, weight_kg, note, created_at, updated_at
       FROM weight_records
       WHERE profile_id = ?
       ORDER BY measured_on`,
    )
    .bind(DEFAULT_PROFILE_ID)
    .all<WeightRow>();
  return context.json({ data: results.map(serializeWeight) });
});

weightRoutes.post("/", async (context) => {
  const input = await parseJson(context, weightInput);
  validateMeasurementDate(input.measuredOn, context.env);
  await ensureDateAvailable(context.env.DB, input.measuredOn);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await context.env.DB
    .prepare(
      `INSERT INTO weight_records (
         id, profile_id, measured_on, weight_kg, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_PROFILE_ID,
      input.measuredOn,
      roundWeight(input.weightKg),
      input.note,
      now,
      now,
    )
    .run();

  return context.json({ data: serializeWeight(await getWeight(context.env.DB, id)) }, 201);
});

weightRoutes.put("/:id", async (context) => {
  const id = context.req.param("id");
  await getWeight(context.env.DB, id);
  const input = await parseJson(context, weightInput);
  validateMeasurementDate(input.measuredOn, context.env);
  await ensureDateAvailable(context.env.DB, input.measuredOn, id);

  await context.env.DB
    .prepare(
      `UPDATE weight_records
       SET measured_on = ?, weight_kg = ?, note = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    )
    .bind(
      input.measuredOn,
      roundWeight(input.weightKg),
      input.note,
      new Date().toISOString(),
      id,
      DEFAULT_PROFILE_ID,
    )
    .run();

  return context.json({ data: serializeWeight(await getWeight(context.env.DB, id)) });
});

weightRoutes.delete("/:id", async (context) => {
  const id = context.req.param("id");
  await getWeight(context.env.DB, id);
  await context.env.DB
    .prepare("DELETE FROM weight_records WHERE id = ? AND profile_id = ?")
    .bind(id, DEFAULT_PROFILE_ID)
    .run();
  return context.body(null, 204);
});

function validateMeasurementDate(measuredOn: string, env: AppContext["Bindings"]): void {
  const today = dateInTimeZone(new Date(), getConfig(env).timeZone);
  if (measuredOn > today) {
    throw new AppError(400, "WEIGHT_DATE_IN_FUTURE", "体重记录日期不能晚于今天");
  }
}

async function ensureDateAvailable(
  database: D1Database,
  measuredOn: string,
  currentId?: string,
): Promise<void> {
  const existing = await database
    .prepare(
      `SELECT id FROM weight_records
       WHERE profile_id = ? AND measured_on = ? AND id != ?`,
    )
    .bind(DEFAULT_PROFILE_ID, measuredOn, currentId || "")
    .first<{ id: string }>();
  if (existing) throw conflict("该日期已有体重记录，请编辑已有记录");
}

async function getWeight(database: D1Database, id: string): Promise<WeightRow> {
  const row = await database
    .prepare(
      `SELECT id, measured_on, weight_kg, note, created_at, updated_at
       FROM weight_records
       WHERE id = ? AND profile_id = ?`,
    )
    .bind(id, DEFAULT_PROFILE_ID)
    .first<WeightRow>();
  if (!row) throw notFound("体重记录");
  return row;
}

function roundWeight(value: number): number {
  return Math.round(value * 10) / 10;
}

function serializeWeight(row: WeightRow) {
  return {
    id: row.id,
    measuredOn: row.measured_on,
    weightKg: row.weight_kg,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
