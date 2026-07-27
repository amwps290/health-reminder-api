import { Hono } from "hono";
import { z } from "zod";
import { conflict, notFound } from "../core/errors";
import { parseJson } from "../core/http";
import { isDateString, isTimeString } from "../core/time";
import { sendBarkTest } from "../integrations/bark";
import {
  DEFAULT_PROFILE_ID,
  getConfig,
  type AppContext,
} from "../core/types";
import { regenerateMedicationJobs } from "../scheduler/materialize";
import { medicationMessage } from "../scheduler/messages";

const medicationInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    dose: z.string().trim().max(120).default(""),
    instructions: z.string().trim().max(1000).default(""),
    startDate: z.string().refine(isDateString, "必须是 YYYY-MM-DD 日期"),
    endDate: z.string().refine(isDateString, "必须是 YYYY-MM-DD 日期").nullable().default(null),
    times: z
      .array(z.string().refine(isTimeString, "必须是 HH:mm 时间"))
      .min(1)
      .max(12)
      .refine((values) => new Set(values).size === values.length, "服用时间不能重复"),
    enabled: z.boolean().default(true),
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    message: "结束日期不能早于开始日期",
    path: ["endDate"],
  });

type MedicationInput = z.infer<typeof medicationInput>;

interface MedicationRow {
  id: string;
  name: string;
  dose: string;
  instructions: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  schedule_id: string;
  schedule_type: string;
  timezone: string;
  start_date: string;
  end_date: string | null;
  version: number;
  materialized_through: string | null;
}

interface TimeRow {
  local_time: string;
}

export const medicationRoutes = new Hono<AppContext>();

medicationRoutes.post("/test-notification", async (context) => {
  const input = await parseJson(context, medicationInput);
  const message = medicationMessage(input);
  const result = await sendBarkTest(context.env, message);
  return context.json({ data: { accepted: true, title: message.title, body: message.body, ...result } });
});

medicationRoutes.get("/", async (context) => {
  const { results } = await context.env.DB
    .prepare(
      `SELECT m.id, m.name, m.dose, m.instructions, m.enabled, m.created_at, m.updated_at,
              s.id AS schedule_id, s.schedule_type, s.timezone, s.start_date, s.end_date,
              s.version, s.materialized_through
       FROM medications m
       JOIN medication_schedules s ON s.medication_id = m.id
       WHERE m.profile_id = ?
       ORDER BY m.enabled DESC, m.name`,
    )
    .bind(DEFAULT_PROFILE_ID)
    .all<MedicationRow>();
  const items = await Promise.all(results.map((row) => serializeMedication(context.env.DB, row)));
  return context.json({ data: items });
});

medicationRoutes.get("/:id", async (context) => {
  return context.json({ data: await getMedication(context.env.DB, context.req.param("id")) });
});

medicationRoutes.post("/", async (context) => {
  const input = await parseJson(context, medicationInput);
  const medicationId = crypto.randomUUID();
  const scheduleId = crypto.randomUUID();
  const now = new Date();
  await insertMedication(context.env.DB, medicationId, scheduleId, input, now);
  await regenerateMedicationJobs(context.env.DB, medicationId, now, getConfig(context.env));
  return context.json({ data: await getMedication(context.env.DB, medicationId) }, 201);
});

medicationRoutes.put("/:id", async (context) => {
  const id = context.req.param("id");
  const input = await parseJson(context, medicationInput);
  const existing = await getMedicationRow(context.env.DB, id);
  const now = new Date();
  const timestamp = now.toISOString();
  const times = [...input.times].sort();
  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `UPDATE medications
         SET name = ?, dose = ?, instructions = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.name, input.dose, input.instructions, input.enabled ? 1 : 0, timestamp, id),
    context.env.DB
      .prepare(
        `UPDATE medication_schedules
         SET start_date = ?, end_date = ?, version = version + 1,
             materialized_through = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.startDate, input.endDate, timestamp, existing.schedule_id),
    context.env.DB
      .prepare("DELETE FROM medication_times WHERE schedule_id = ?")
      .bind(existing.schedule_id),
    ...times.map((time, index) =>
      context.env.DB
        .prepare(
          "INSERT INTO medication_times (id, schedule_id, local_time, sort_order) VALUES (?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), existing.schedule_id, time, index),
    ),
  ]);
  await regenerateMedicationJobs(context.env.DB, id, now, getConfig(context.env));
  if (!input.enabled) await cancelMedicationJobs(context.env.DB, existing.schedule_id, timestamp);
  return context.json({ data: await getMedication(context.env.DB, id) });
});

medicationRoutes.delete("/:id", async (context) => {
  const id = context.req.param("id");
  const existing = await getMedicationRow(context.env.DB, id);
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `UPDATE notification_jobs SET status = 'canceled', updated_at = ?
         WHERE source_type = 'medication' AND source_id = ?
           AND status IN ('pending', 'processing', 'retry')`,
      )
      .bind(now, existing.schedule_id),
    context.env.DB.prepare("DELETE FROM medications WHERE id = ?").bind(id),
  ]);
  return context.body(null, 204);
});

async function insertMedication(
  database: D1Database,
  medicationId: string,
  scheduleId: string,
  input: MedicationInput,
  now: Date,
): Promise<void> {
  const timestamp = now.toISOString();
  const statements = [
    database
      .prepare(
        `INSERT INTO medications (
           id, profile_id, name, dose, instructions, enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        medicationId,
        DEFAULT_PROFILE_ID,
        input.name,
        input.dose,
        input.instructions,
        input.enabled ? 1 : 0,
        timestamp,
        timestamp,
      ),
    database
      .prepare(
        `INSERT INTO medication_schedules (
           id, medication_id, schedule_type, timezone, start_date, end_date,
           version, created_at, updated_at
         ) VALUES (?, ?, 'daily', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        scheduleId,
        medicationId,
        "Asia/Shanghai",
        input.startDate,
        input.endDate,
        timestamp,
        timestamp,
      ),
    ...[...input.times].sort().map((time, index) =>
      database
        .prepare(
          "INSERT INTO medication_times (id, schedule_id, local_time, sort_order) VALUES (?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), scheduleId, time, index),
    ),
  ];
  try {
    await database.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw conflict("服药计划包含重复数据");
    }
    throw error;
  }
}

async function getMedication(database: D1Database, id: string) {
  return serializeMedication(database, await getMedicationRow(database, id));
}

async function getMedicationRow(database: D1Database, id: string): Promise<MedicationRow> {
  const row = await database
    .prepare(
      `SELECT m.id, m.name, m.dose, m.instructions, m.enabled, m.created_at, m.updated_at,
              s.id AS schedule_id, s.schedule_type, s.timezone, s.start_date, s.end_date,
              s.version, s.materialized_through
       FROM medications m
       JOIN medication_schedules s ON s.medication_id = m.id
       WHERE m.id = ? AND m.profile_id = ?`,
    )
    .bind(id, DEFAULT_PROFILE_ID)
    .first<MedicationRow>();
  if (!row) throw notFound("服药计划");
  return row;
}

async function serializeMedication(database: D1Database, row: MedicationRow) {
  const { results } = await database
    .prepare("SELECT local_time FROM medication_times WHERE schedule_id = ? ORDER BY sort_order, local_time")
    .bind(row.schedule_id)
    .all<TimeRow>();
  return {
    id: row.id,
    name: row.name,
    dose: row.dose,
    instructions: row.instructions,
    enabled: row.enabled === 1,
    schedule: {
      id: row.schedule_id,
      type: row.schedule_type,
      timezone: row.timezone,
      startDate: row.start_date,
      endDate: row.end_date,
      times: results.map((item) => item.local_time),
      version: row.version,
      materializedThrough: row.materialized_through,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function cancelMedicationJobs(
  database: D1Database,
  scheduleId: string,
  timestamp: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE notification_jobs SET status = 'canceled', updated_at = ?
       WHERE source_type = 'medication' AND source_id = ?
         AND status IN ('pending', 'processing', 'retry')`,
    )
    .bind(timestamp, scheduleId)
    .run();
}
