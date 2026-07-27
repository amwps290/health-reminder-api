import { Hono } from "hono";
import { z } from "zod";
import { notFound } from "../core/errors";
import { parseJson } from "../core/http";
import { isInstantString } from "../core/time";
import { DEFAULT_PROFILE_ID, type AppContext } from "../core/types";

const noteInput = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(10_000),
  source: z.string().trim().max(300).default(""),
  recordedAt: z.string().refine(isInstantString, "必须是包含时区的 RFC3339 时间"),
});

interface NoteRow {
  id: string;
  title: string;
  content: string;
  source: string;
  recorded_at: string;
  created_at: string;
  updated_at: string;
}

export const medicalNoteRoutes = new Hono<AppContext>();

medicalNoteRoutes.get("/", async (context) => {
  const { results } = await context.env.DB
    .prepare("SELECT * FROM medical_notes WHERE profile_id = ? ORDER BY recorded_at DESC")
    .bind(DEFAULT_PROFILE_ID)
    .all<NoteRow>();
  return context.json({ data: results.map(serializeNote) });
});

medicalNoteRoutes.get("/:id", async (context) => {
  return context.json({ data: serializeNote(await getNote(context.env.DB, context.req.param("id"))) });
});

medicalNoteRoutes.post("/", async (context) => {
  const input = await parseJson(context, noteInput);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await context.env.DB
    .prepare(
      `INSERT INTO medical_notes (
         id, profile_id, title, content, source, recorded_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_PROFILE_ID,
      input.title,
      input.content,
      input.source,
      new Date(input.recordedAt).toISOString(),
      now,
      now,
    )
    .run();
  return context.json({ data: serializeNote(await getNote(context.env.DB, id)) }, 201);
});

medicalNoteRoutes.put("/:id", async (context) => {
  const id = context.req.param("id");
  await getNote(context.env.DB, id);
  const input = await parseJson(context, noteInput);
  await context.env.DB
    .prepare(
      `UPDATE medical_notes
       SET title = ?, content = ?, source = ?, recorded_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.title,
      input.content,
      input.source,
      new Date(input.recordedAt).toISOString(),
      new Date().toISOString(),
      id,
    )
    .run();
  return context.json({ data: serializeNote(await getNote(context.env.DB, id)) });
});

medicalNoteRoutes.delete("/:id", async (context) => {
  const id = context.req.param("id");
  await getNote(context.env.DB, id);
  await context.env.DB.prepare("DELETE FROM medical_notes WHERE id = ?").bind(id).run();
  return context.body(null, 204);
});

async function getNote(database: D1Database, id: string): Promise<NoteRow> {
  const row = await database
    .prepare("SELECT * FROM medical_notes WHERE id = ? AND profile_id = ?")
    .bind(id, DEFAULT_PROFILE_ID)
    .first<NoteRow>();
  if (!row) throw notFound("医嘱");
  return row;
}

function serializeNote(row: NoteRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    source: row.source,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
