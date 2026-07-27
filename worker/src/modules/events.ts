import { Hono } from "hono";
import { z } from "zod";
import { notFound } from "../core/errors";
import { parseJson } from "../core/http";
import { isInstantString } from "../core/time";
import { sendBarkTest } from "../integrations/bark";
import { DEFAULT_PROFILE_ID, type AppContext } from "../core/types";
import { regenerateEventJobs } from "../scheduler/materialize";
import { eventMessage } from "../scheduler/messages";

const eventInput = z
  .object({
    type: z.enum(["registration", "checkup", "follow_up", "other"]),
    title: z.string().trim().min(1).max(160),
    eventAt: z.string().refine(isInstantString, "必须是包含时区的 RFC3339 时间"),
    location: z.string().trim().max(300).default(""),
    notes: z.string().trim().max(2000).default(""),
    reminderTimes: z
      .array(z.string().refine(isInstantString, "必须是包含时区的 RFC3339 时间"))
      .min(1)
      .max(12)
      .refine((values) => new Set(values.map((value) => new Date(value).toISOString())).size === values.length, "提醒时间不能重复"),
    enabled: z.boolean().default(true),
  })
  .refine(
    (value) => value.reminderTimes.every((time) => Date.parse(time) <= Date.parse(value.eventAt)),
    { message: "提醒时间不能晚于事项时间", path: ["reminderTimes"] },
  );

type EventInput = z.infer<typeof eventInput>;

interface EventRow {
  id: string;
  event_type: string;
  title: string;
  event_at: string;
  timezone: string;
  location: string;
  notes: string;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export const eventRoutes = new Hono<AppContext>();

eventRoutes.post("/test-notification", async (context) => {
  const input = await parseJson(context, eventInput);
  const message = eventMessage(input);
  const result = await sendBarkTest(context.env, message);
  return context.json({ data: { accepted: true, title: message.title, body: message.body, ...result } });
});

eventRoutes.get("/", async (context) => {
  const { results } = await context.env.DB
    .prepare(
      `SELECT * FROM events WHERE profile_id = ?
       ORDER BY event_at, created_at`,
    )
    .bind(DEFAULT_PROFILE_ID)
    .all<EventRow>();
  const items = await Promise.all(results.map((row) => serializeEvent(context.env.DB, row)));
  return context.json({ data: items });
});

eventRoutes.get("/:id", async (context) => {
  return context.json({ data: await getEvent(context.env.DB, context.req.param("id")) });
});

eventRoutes.post("/", async (context) => {
  const input = await parseJson(context, eventInput);
  const id = crypto.randomUUID();
  const now = new Date();
  await insertEvent(context.env.DB, id, input, now);
  if (input.enabled) await regenerateEventJobs(context.env.DB, id, now);
  return context.json({ data: await getEvent(context.env.DB, id) }, 201);
});

eventRoutes.put("/:id", async (context) => {
  const id = context.req.param("id");
  const input = await parseJson(context, eventInput);
  const existing = await getEventRow(context.env.DB, id);
  const now = new Date();
  const timestamp = now.toISOString();
  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `UPDATE events SET event_type = ?, title = ?, event_at = ?, location = ?, notes = ?,
                           enabled = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.type,
        input.title,
        new Date(input.eventAt).toISOString(),
        input.location,
        input.notes,
        input.enabled ? 1 : 0,
        timestamp,
        id,
      ),
    context.env.DB.prepare("DELETE FROM event_reminders WHERE event_id = ?").bind(id),
    ...normalizeTimes(input.reminderTimes).map((time) =>
      context.env.DB
        .prepare("INSERT INTO event_reminders (id, event_id, remind_at) VALUES (?, ?, ?)")
        .bind(crypto.randomUUID(), id, time),
    ),
  ]);
  await cancelEventJobs(context.env.DB, id, timestamp);
  if (input.enabled) await regenerateEventJobs(context.env.DB, id, now);
  return context.json({ data: await getEvent(context.env.DB, existing.id) });
});

eventRoutes.delete("/:id", async (context) => {
  const id = context.req.param("id");
  await getEventRow(context.env.DB, id);
  const timestamp = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `UPDATE notification_jobs SET status = 'canceled', updated_at = ?
         WHERE source_type = 'event' AND source_id = ?
           AND status IN ('pending', 'processing', 'retry')`,
      )
      .bind(timestamp, id),
    context.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id),
  ]);
  return context.body(null, 204);
});

async function insertEvent(
  database: D1Database,
  id: string,
  input: EventInput,
  now: Date,
): Promise<void> {
  const timestamp = now.toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO events (
           id, profile_id, event_type, title, event_at, timezone,
           location, notes, enabled, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'Asia/Shanghai', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id,
        DEFAULT_PROFILE_ID,
        input.type,
        input.title,
        new Date(input.eventAt).toISOString(),
        input.location,
        input.notes,
        input.enabled ? 1 : 0,
        timestamp,
        timestamp,
      ),
    ...normalizeTimes(input.reminderTimes).map((time) =>
      database
        .prepare("INSERT INTO event_reminders (id, event_id, remind_at) VALUES (?, ?, ?)")
        .bind(crypto.randomUUID(), id, time),
    ),
  ]);
}

async function getEvent(database: D1Database, id: string) {
  return serializeEvent(database, await getEventRow(database, id));
}

async function getEventRow(database: D1Database, id: string): Promise<EventRow> {
  const row = await database
    .prepare("SELECT * FROM events WHERE id = ? AND profile_id = ?")
    .bind(id, DEFAULT_PROFILE_ID)
    .first<EventRow>();
  if (!row) throw notFound("事项");
  return row;
}

async function serializeEvent(database: D1Database, row: EventRow) {
  const { results } = await database
    .prepare("SELECT remind_at FROM event_reminders WHERE event_id = ? ORDER BY remind_at")
    .bind(row.id)
    .all<{ remind_at: string }>();
  return {
    id: row.id,
    type: row.event_type,
    title: row.title,
    eventAt: row.event_at,
    timezone: row.timezone,
    location: row.location,
    notes: row.notes,
    enabled: row.enabled === 1,
    version: row.version,
    reminderTimes: results.map((item) => item.remind_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function cancelEventJobs(database: D1Database, id: string, timestamp: string): Promise<void> {
  await database
    .prepare(
      `UPDATE notification_jobs SET status = 'canceled', updated_at = ?
       WHERE source_type = 'event' AND source_id = ?
         AND status IN ('pending', 'processing', 'retry')`,
    )
    .bind(timestamp, id)
    .run();
}

function normalizeTimes(values: string[]): string[] {
  return values.map((value) => new Date(value).toISOString()).sort();
}
