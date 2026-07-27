import { Hono } from "hono";
import { z } from "zod";
import { AppError, notFound } from "../core/errors";
import { parseJson } from "../core/http";
import { isDateString, isTimeString } from "../core/time";
import { DEFAULT_PROFILE_ID, getConfig, type AppContext } from "../core/types";
import { sendBarkTest } from "../integrations/bark";
import { regenerateInjectionJobs } from "../scheduler/materialize";
import { injectionMessage, nextInjectionOccurrence } from "../scheduler/messages";

const injectionInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    dose: z.string().trim().max(120).default(""),
    site: z.string().trim().max(120).default(""),
    instructions: z.string().trim().max(1000).default(""),
    startDate: z.string().refine(isDateString, "必须是 YYYY-MM-DD 日期"),
    endDate: z.string().refine(isDateString, "必须是 YYYY-MM-DD 日期").nullable().default(null),
    localTime: z.string().refine(isTimeString, "必须是 HH:mm 时间"),
    intervalDays: z.number().int().min(1).max(365),
    firstSide: z.enum(["left", "right"]),
    enabled: z.boolean().default(true),
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    message: "结束日期不能早于开始日期",
    path: ["endDate"],
  });

type InjectionInput = z.infer<typeof injectionInput>;

export interface InjectionRow {
  id: string;
  name: string;
  dose: string;
  site: string;
  instructions: string;
  start_date: string;
  end_date: string | null;
  local_time: string;
  timezone: string;
  interval_days: number;
  first_side: "left" | "right";
  enabled: number;
  version: number;
  materialized_through: string | null;
  created_at: string;
  updated_at: string;
}

export const injectionRoutes = new Hono<AppContext>();

injectionRoutes.post("/test-notification", async (context) => {
  const input = await parseJson(context, injectionInput);
  const occurrence = nextInjectionOccurrence(input);
  if (!occurrence) {
    throw new AppError(400, "NO_FUTURE_INJECTION", "计划范围内没有下一次注射");
  }
  const message = injectionMessage(input, occurrence.side);
  const result = await sendBarkTest(context.env, message);
  return context.json({
    data: {
      accepted: true,
      title: message.title,
      body: message.body,
      scheduledDate: occurrence.date,
      side: occurrence.side,
      ...result,
    },
  });
});

injectionRoutes.get("/", async (context) => {
  const { results } = await context.env.DB
    .prepare(
      `SELECT id, name, dose, site, instructions, start_date, end_date, local_time,
              timezone, interval_days, first_side, enabled, version,
              materialized_through, created_at, updated_at
       FROM injection_plans
       WHERE profile_id = ?
       ORDER BY enabled DESC, name`,
    )
    .bind(DEFAULT_PROFILE_ID)
    .all<InjectionRow>();
  return context.json({ data: results.map(serializeInjection) });
});

injectionRoutes.get("/:id", async (context) => {
  return context.json({ data: serializeInjection(await getInjection(context.env.DB, context.req.param("id"))) });
});

injectionRoutes.post("/", async (context) => {
  const input = await parseJson(context, injectionInput);
  const id = crypto.randomUUID();
  const now = new Date();
  const timestamp = now.toISOString();
  await context.env.DB
    .prepare(
      `INSERT INTO injection_plans (
         id, profile_id, name, dose, site, instructions, start_date, end_date,
         local_time, timezone, interval_days, first_side, enabled, version,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_PROFILE_ID,
      input.name,
      input.dose,
      input.site,
      input.instructions,
      input.startDate,
      input.endDate,
      input.localTime,
      "Asia/Shanghai",
      input.intervalDays,
      input.firstSide,
      input.enabled ? 1 : 0,
      timestamp,
      timestamp,
    )
    .run();
  await regenerateInjectionJobs(context.env.DB, id, now, getConfig(context.env));
  return context.json({ data: serializeInjection(await getInjection(context.env.DB, id)) }, 201);
});

injectionRoutes.put("/:id", async (context) => {
  const id = context.req.param("id");
  const input = await parseJson(context, injectionInput);
  await getInjection(context.env.DB, id);
  const now = new Date();
  const timestamp = now.toISOString();
  await context.env.DB
    .prepare(
      `UPDATE injection_plans
       SET name = ?, dose = ?, site = ?, instructions = ?, start_date = ?, end_date = ?,
           local_time = ?, interval_days = ?, first_side = ?, enabled = ?,
           version = version + 1, materialized_through = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    )
    .bind(
      input.name,
      input.dose,
      input.site,
      input.instructions,
      input.startDate,
      input.endDate,
      input.localTime,
      input.intervalDays,
      input.firstSide,
      input.enabled ? 1 : 0,
      timestamp,
      id,
      DEFAULT_PROFILE_ID,
    )
    .run();
  await regenerateInjectionJobs(context.env.DB, id, now, getConfig(context.env));
  return context.json({ data: serializeInjection(await getInjection(context.env.DB, id)) });
});

injectionRoutes.delete("/:id", async (context) => {
  const id = context.req.param("id");
  await getInjection(context.env.DB, id);
  const timestamp = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `UPDATE notification_jobs SET status = 'canceled', updated_at = ?
         WHERE source_type = 'injection' AND source_id = ?
           AND status IN ('pending', 'processing', 'retry')`,
      )
      .bind(timestamp, id),
    context.env.DB.prepare("DELETE FROM injection_plans WHERE id = ?").bind(id),
  ]);
  return context.body(null, 204);
});

async function getInjection(database: D1Database, id: string): Promise<InjectionRow> {
  const row = await database
    .prepare(
      `SELECT id, name, dose, site, instructions, start_date, end_date, local_time,
              timezone, interval_days, first_side, enabled, version,
              materialized_through, created_at, updated_at
       FROM injection_plans WHERE id = ? AND profile_id = ?`,
    )
    .bind(id, DEFAULT_PROFILE_ID)
    .first<InjectionRow>();
  if (!row) throw notFound("注射计划");
  return row;
}

function serializeInjection(row: InjectionRow) {
  return {
    id: row.id,
    name: row.name,
    dose: row.dose,
    site: row.site,
    instructions: row.instructions,
    startDate: row.start_date,
    endDate: row.end_date,
    localTime: row.local_time,
    timezone: row.timezone,
    intervalDays: row.interval_days,
    firstSide: row.first_side,
    enabled: row.enabled === 1,
    version: row.version,
    materializedThrough: row.materialized_through,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
