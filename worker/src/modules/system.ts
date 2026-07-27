import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../core/errors";
import { getPaginationLimit, parseJson } from "../core/http";
import { isInstantString } from "../core/time";
import { type AppContext, getConfig } from "../core/types";
import { sendBarkTest } from "../integrations/bark";

const testNotificationInput = z.object({
  title: z.string().trim().min(1).max(120).default("健康提醒测试"),
  body: z.string().trim().min(1).max(1000).default("Bark 推送配置正常"),
});

export const systemRoutes = new Hono<AppContext>();

systemRoutes.get("/system/status", async (context) => {
  const lastRun = await context.env.DB
    .prepare(
      `SELECT started_at, finished_at, materialized_count, claimed_count,
              sent_count, failed_count, outcome, error_code
       FROM scheduler_runs ORDER BY started_at DESC LIMIT 1`,
    )
    .first();
  const counts = await context.env.DB
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'retry' THEN 1 ELSE 0 END) AS retrying,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM notification_jobs`,
    )
    .first<{ pending: number | null; retrying: number | null; failed: number | null }>();
  return context.json({
    data: {
      status: "ok",
      timezone: getConfig(context.env).timeZone,
      currentTime: new Date().toISOString(),
      jobs: {
        pending: counts?.pending || 0,
        retrying: counts?.retrying || 0,
        failed: counts?.failed || 0,
      },
      lastSchedulerRun: lastRun,
    },
  });
});

systemRoutes.post("/notifications/test", async (context) => {
  const input = await parseJson(context, testNotificationInput);
  const message = {
    title: input.title,
    body: input.body,
    group: "health-test",
    level: "active" as const,
  };
  const result = await sendBarkTest(context.env, message);
  return context.json({ data: { accepted: true, ...result } });
});

systemRoutes.get("/timeline", async (context) => {
  const now = new Date();
  const fromRaw = context.req.query("from") || now.toISOString();
  const toRaw = context.req.query("to") || new Date(now.getTime() + 7 * 86_400_000).toISOString();
  if (!isInstantString(fromRaw) || !isInstantString(toRaw)) {
    throw new AppError(400, "INVALID_TIME_RANGE", "from 和 to 必须是 RFC3339 时间");
  }
  const from = new Date(fromRaw).toISOString();
  const to = new Date(toRaw).toISOString();
  if (from > to) throw new AppError(400, "INVALID_TIME_RANGE", "from 不能晚于 to");

  const { results } = await context.env.DB
    .prepare(
      `SELECT id, source_type, source_id, scheduled_at, title, body, group_name,
              status, attempts, sent_at, last_error
       FROM notification_jobs
       WHERE scheduled_at BETWEEN ? AND ?
       ORDER BY scheduled_at
       LIMIT 500`,
    )
    .bind(from, to)
    .all();
  return context.json({ data: results, meta: { from, to } });
});

systemRoutes.get("/deliveries", async (context) => {
  const limit = getPaginationLimit(context.req.query("limit"));
  const { results } = await context.env.DB
    .prepare(
      `SELECT d.id, d.job_id, d.attempted_at, d.success, d.http_status,
              d.provider_code, d.error_code, j.source_type, j.scheduled_at, j.title
       FROM notification_deliveries d
       JOIN notification_jobs j ON j.id = d.job_id
       ORDER BY d.attempted_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return context.json({ data: results });
});
