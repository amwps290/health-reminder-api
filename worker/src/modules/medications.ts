import { Hono } from "hono";
import { z } from "zod";
import { AppError, conflict, notFound } from "../core/errors";
import { parseJson } from "../core/http";
import { isDateString, isInstantString, isTimeString } from "../core/time";
import { sendBarkTest } from "../integrations/bark";
import {
  DEFAULT_PROFILE_ID,
  getConfig,
  type AppContext,
} from "../core/types";
import { regenerateMedicationJobs } from "../scheduler/materialize";
import { medicationMessage } from "../scheduler/messages";

const medicationSlotInput = z.object({
  time: z.string().refine(isTimeString, "必须是 HH:mm 时间"),
  dose: z.string().trim().max(120).default(""),
});

const medicationInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    dose: z.string().trim().max(120).default(""),
    instructions: z.string().trim().max(1000).default(""),
    startDate: z.string().refine(isDateString, "必须是 YYYY-MM-DD 日期"),
    endDate: z.string().refine(isDateString, "必须是 YYYY-MM-DD 日期").nullable().default(null),
    scheduleType: z.enum(["daily", "interval_days", "weekly", "cycle"]).default("daily"),
    intervalDays: z.number().int().min(1).max(365).default(2),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
    activeDays: z.number().int().min(1).max(365).default(21),
    restDays: z.number().int().min(0).max(365).default(7),
    slots: z.array(medicationSlotInput).min(1).max(12).optional(),
    times: z.array(z.string().refine(isTimeString, "必须是 HH:mm 时间")).min(1).max(12).optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.endDate && value.endDate < value.startDate) {
      context.addIssue({ code: "custom", message: "结束日期不能早于开始日期", path: ["endDate"] });
    }
    const slots = value.slots ?? value.times?.map((time) => ({ time, dose: "" })) ?? [];
    if (slots.length === 0) {
      context.addIssue({ code: "custom", message: "至少需要一个服用时间", path: ["slots"] });
    }
    if (new Set(slots.map((slot) => slot.time)).size !== slots.length) {
      context.addIssue({ code: "custom", message: "服用时间不能重复", path: ["slots"] });
    }
    if (value.scheduleType === "weekly" && value.weekdays.length === 0) {
      context.addIssue({ code: "custom", message: "每周计划至少选择一天", path: ["weekdays"] });
    }
    if (value.scheduleType === "cycle" && value.restDays < 1) {
      context.addIssue({ code: "custom", message: "停药天数至少为 1 天", path: ["restDays"] });
    }
  })
  .transform(({ slots, times, ...value }) => {
    return {
      ...value,
      slots: slots ?? times!.map((time) => ({ time, dose: "" })),
    };
  });

type MedicationInput = z.infer<typeof medicationInput>;

const medicationRecordInput = z
  .object({
    scheduledAt: z.string().refine(isInstantString, "计划时间必须是 RFC3339 时间"),
    status: z.enum(["taken", "skipped"]),
    takenAt: z.string().refine(isInstantString, "实际服用时间必须是 RFC3339 时间").nullable().default(null),
    notes: z.string().trim().max(1000).default(""),
  })
  .superRefine((value, context) => {
    if (value.status === "taken" && !value.takenAt) {
      context.addIssue({ code: "custom", message: "已服用记录必须填写实际服用时间" });
    }
  });

interface MedicationRow {
  id: string;
  name: string;
  dose: string;
  instructions: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  schedule_id: string;
  schedule_type: "daily" | "interval_days" | "weekly" | "cycle";
  timezone: string;
  start_date: string;
  end_date: string | null;
  interval_days: number;
  weekdays: number;
  active_days: number;
  rest_days: number;
  version: number;
  materialized_through: string | null;
}

interface TimeRow {
  local_time: string;
  dose: string;
}

interface MedicationRecordRow {
  id: string;
  medication_id: string;
  schedule_id: string;
  job_id: string | null;
  scheduled_at: string;
  status: "taken" | "skipped";
  taken_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export const medicationRoutes = new Hono<AppContext>();

medicationRoutes.post("/test-notification", async (context) => {
  const input = await parseJson(context, medicationInput);
  const message = medicationMessage({ ...input, dose: input.slots[0]?.dose || input.dose });
  const result = await sendBarkTest(context.env, message);
  return context.json({ data: { accepted: true, title: message.title, body: message.body, ...result } });
});

medicationRoutes.get("/", async (context) => {
  const { results } = await context.env.DB
    .prepare(
      `SELECT m.id, m.name, m.dose, m.instructions, m.enabled, m.created_at, m.updated_at,
              s.id AS schedule_id, s.schedule_type, s.timezone, s.start_date, s.end_date,
              s.interval_days, s.weekdays, s.active_days, s.rest_days,
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

medicationRoutes.get("/:id/records", async (context) => {
  const medication = await getMedicationRow(context.env.DB, context.req.param("id"));
  const { results } = await context.env.DB
    .prepare(
      `SELECT id, medication_id, schedule_id, job_id, scheduled_at, status,
              taken_at, notes, created_at, updated_at
       FROM medication_records
       WHERE medication_id = ?
       ORDER BY scheduled_at DESC
       LIMIT 365`,
    )
    .bind(medication.id)
    .all<MedicationRecordRow>();
  return context.json({ data: results.map(serializeMedicationRecord) });
});

medicationRoutes.post("/:id/records", async (context) => {
  const medication = await getMedicationRow(context.env.DB, context.req.param("id"));
  const input = await parseJson(context, medicationRecordInput);
  const now = new Date();
  if (input.status === "taken" && Date.parse(input.takenAt!) > now.getTime() + 5 * 60_000) {
    throw new AppError(400, "FUTURE_TAKEN_TIME", "实际服用时间不能晚于当前时间");
  }
  const scheduledAt = new Date(input.scheduledAt).toISOString();
  const takenAt = input.status === "taken" ? new Date(input.takenAt!).toISOString() : null;
  const job = await context.env.DB
    .prepare(
      `SELECT id FROM notification_jobs
       WHERE source_type = 'medication' AND source_id = ? AND scheduled_at = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(medication.schedule_id, scheduledAt)
    .first<{ id: string }>();
  const timestamp = now.toISOString();
  await context.env.DB
    .prepare(
      `INSERT INTO medication_records (
         id, medication_id, schedule_id, job_id, scheduled_at, status,
         taken_at, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(schedule_id, scheduled_at) DO UPDATE SET
         job_id = excluded.job_id,
         status = excluded.status,
         taken_at = excluded.taken_at,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      medication.id,
      medication.schedule_id,
      job?.id || null,
      scheduledAt,
      input.status,
      takenAt,
      input.notes,
      timestamp,
      timestamp,
    )
    .run();
  const record = await context.env.DB
    .prepare(
      `SELECT id, medication_id, schedule_id, job_id, scheduled_at, status,
              taken_at, notes, created_at, updated_at
       FROM medication_records WHERE schedule_id = ? AND scheduled_at = ?`,
    )
    .bind(medication.schedule_id, scheduledAt)
    .first<MedicationRecordRow>();
  return context.json({ data: serializeMedicationRecord(record!) }, 201);
});

medicationRoutes.delete("/:id/records/:recordId", async (context) => {
  const medication = await getMedicationRow(context.env.DB, context.req.param("id"));
  const result = await context.env.DB
    .prepare("DELETE FROM medication_records WHERE id = ? AND medication_id = ?")
    .bind(context.req.param("recordId"), medication.id)
    .run();
  if (!result.meta.changes) throw notFound("服药记录");
  return context.body(null, 204);
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
  const slots = [...input.slots].sort((left, right) => left.time.localeCompare(right.time));
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
         SET schedule_type = ?, start_date = ?, end_date = ?, interval_days = ?,
             weekdays = ?, active_days = ?, rest_days = ?, version = version + 1,
             materialized_through = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.scheduleType,
        input.startDate,
        input.endDate,
        input.intervalDays,
        weekdaysToMask(input.weekdays),
        input.activeDays,
        input.restDays,
        timestamp,
        existing.schedule_id,
      ),
    context.env.DB
      .prepare("DELETE FROM medication_times WHERE schedule_id = ?")
      .bind(existing.schedule_id),
    ...slots.map((slot, index) =>
      context.env.DB
        .prepare(
          "INSERT INTO medication_times (id, schedule_id, local_time, dose, sort_order) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), existing.schedule_id, slot.time, slot.dose, index),
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
           interval_days, weekdays, active_days, rest_days, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        scheduleId,
        medicationId,
        input.scheduleType,
        "Asia/Shanghai",
        input.startDate,
        input.endDate,
        input.intervalDays,
        weekdaysToMask(input.weekdays),
        input.activeDays,
        input.restDays,
        timestamp,
        timestamp,
      ),
    ...[...input.slots].sort((left, right) => left.time.localeCompare(right.time)).map((slot, index) =>
      database
        .prepare(
          "INSERT INTO medication_times (id, schedule_id, local_time, dose, sort_order) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), scheduleId, slot.time, slot.dose, index),
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
              s.interval_days, s.weekdays, s.active_days, s.rest_days,
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
    .prepare("SELECT local_time, dose FROM medication_times WHERE schedule_id = ? ORDER BY sort_order, local_time")
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
      intervalDays: row.interval_days,
      weekdays: maskToWeekdays(row.weekdays),
      activeDays: row.active_days,
      restDays: row.rest_days,
      times: results.map((item) => item.local_time),
      slots: results.map((item) => ({ time: item.local_time, dose: item.dose })),
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

function weekdaysToMask(weekdays: number[]): number {
  return weekdays.reduce((mask, weekday) => mask | (1 << weekday), 0);
}

function maskToWeekdays(mask: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((weekday) => (mask & (1 << weekday)) !== 0);
}

function serializeMedicationRecord(row: MedicationRecordRow) {
  return {
    id: row.id,
    medicationId: row.medication_id,
    scheduleId: row.schedule_id,
    jobId: row.job_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    takenAt: row.taken_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
