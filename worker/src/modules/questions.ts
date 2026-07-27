import { Hono } from "hono";
import { z } from "zod";
import { AppError, notFound } from "../core/errors";
import { parseJson } from "../core/http";
import { DEFAULT_PROFILE_ID, type AppContext } from "../core/types";

const questionInput = z.object({
  eventId: z.string().uuid().nullable().default(null),
  content: z.string().trim().min(1).max(2000),
  status: z.enum(["open", "answered", "archived"]).default("open"),
  answer: z.string().trim().max(5000).default(""),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
});

interface QuestionRow {
  id: string;
  event_id: string | null;
  content: string;
  status: "open" | "answered" | "archived";
  answer: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const questionRoutes = new Hono<AppContext>();

questionRoutes.get("/", async (context) => {
  const status = context.req.query("status");
  const statement = status
    ? context.env.DB
        .prepare(
          `SELECT * FROM questions WHERE profile_id = ? AND status = ?
           ORDER BY sort_order, created_at`,
        )
        .bind(DEFAULT_PROFILE_ID, status)
    : context.env.DB
        .prepare(
          `SELECT * FROM questions WHERE profile_id = ?
           ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END,
                    sort_order, created_at`,
        )
        .bind(DEFAULT_PROFILE_ID);
  const { results } = await statement.all<QuestionRow>();
  return context.json({ data: results.map(serializeQuestion) });
});

questionRoutes.get("/:id", async (context) => {
  return context.json({ data: serializeQuestion(await getQuestion(context.env.DB, context.req.param("id"))) });
});

questionRoutes.post("/", async (context) => {
  const input = await parseJson(context, questionInput);
  await ensureEvent(context.env.DB, input.eventId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await context.env.DB
    .prepare(
      `INSERT INTO questions (
         id, profile_id, event_id, content, status, answer, sort_order, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_PROFILE_ID,
      input.eventId,
      input.content,
      input.status,
      input.answer,
      input.sortOrder,
      now,
      now,
    )
    .run();
  return context.json({ data: serializeQuestion(await getQuestion(context.env.DB, id)) }, 201);
});

questionRoutes.put("/:id", async (context) => {
  const id = context.req.param("id");
  await getQuestion(context.env.DB, id);
  const input = await parseJson(context, questionInput);
  await ensureEvent(context.env.DB, input.eventId);
  await context.env.DB
    .prepare(
      `UPDATE questions
       SET event_id = ?, content = ?, status = ?, answer = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.eventId,
      input.content,
      input.status,
      input.answer,
      input.sortOrder,
      new Date().toISOString(),
      id,
    )
    .run();
  return context.json({ data: serializeQuestion(await getQuestion(context.env.DB, id)) });
});

questionRoutes.delete("/:id", async (context) => {
  const id = context.req.param("id");
  await getQuestion(context.env.DB, id);
  await context.env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
  return context.body(null, 204);
});

async function getQuestion(database: D1Database, id: string): Promise<QuestionRow> {
  const row = await database
    .prepare("SELECT * FROM questions WHERE id = ? AND profile_id = ?")
    .bind(id, DEFAULT_PROFILE_ID)
    .first<QuestionRow>();
  if (!row) throw notFound("就诊问题");
  return row;
}

async function ensureEvent(database: D1Database, eventId: string | null): Promise<void> {
  if (!eventId) return;
  const event = await database
    .prepare("SELECT id FROM events WHERE id = ? AND profile_id = ?")
    .bind(eventId, DEFAULT_PROFILE_ID)
    .first();
  if (!event) throw new AppError(400, "INVALID_EVENT", "关联的事项不存在");
}

function serializeQuestion(row: QuestionRow) {
  return {
    id: row.id,
    eventId: row.event_id,
    content: row.content,
    status: row.status,
    answer: row.answer,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
