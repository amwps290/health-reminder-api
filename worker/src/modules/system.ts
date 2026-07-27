import { Hono } from "hono";
import { z } from "zod";
import { AppError, conflict, notFound } from "../core/errors";
import { getPaginationLimit, parseJson } from "../core/http";
import { isInstantString } from "../core/time";
import { DEFAULT_PROFILE_ID, type AppContext, getConfig } from "../core/types";
import { sendBarkTest } from "../integrations/bark";

const testNotificationInput = z.object({
  title: z.string().trim().min(1).max(120).default("健康提醒测试"),
  body: z.string().trim().min(1).max(1000).default("Bark 推送配置正常"),
});

export const systemRoutes = new Hono<AppContext>();

const SCHEDULER_STALE_AFTER_MS = 3 * 60_000;
const BARK_STALE_AFTER_MS = 7 * 86_400_000;

interface SchedulerRunRow {
  started_at: string;
  finished_at: string | null;
  materialized_count: number;
  claimed_count: number;
  sent_count: number;
  failed_count: number;
  outcome: string;
  error_code: string | null;
}

systemRoutes.get("/system/status", async (context) => {
  const now = new Date();
  const nowIso = now.toISOString();
  const lastRun = await context.env.DB
    .prepare(
      `SELECT started_at, finished_at, materialized_count, claimed_count,
              sent_count, failed_count, outcome, error_code
       FROM scheduler_runs ORDER BY started_at DESC LIMIT 1`,
    )
    .first<SchedulerRunRow>();
  const counts = await context.env.DB
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'retry' THEN 1 ELSE 0 END) AS retrying,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE
           WHEN status = 'pending' AND scheduled_at < ? THEN 1
           WHEN status = 'retry' AND next_attempt_at < ? THEN 1
           ELSE 0
         END) AS overdue
       FROM notification_jobs`,
    )
    .bind(nowIso, nowIso)
    .first<{
      pending: number | null;
      retrying: number | null;
      failed: number | null;
      overdue: number | null;
    }>();
  const [lastSuccessfulDelivery, lastSuccessfulTest] = await Promise.all([
    context.env.DB
      .prepare(
        `SELECT attempted_at
         FROM notification_deliveries
         WHERE success = 1
         ORDER BY attempted_at DESC
         LIMIT 1`,
      )
      .first<{ attempted_at: string }>(),
    context.env.DB
      .prepare("SELECT value FROM maintenance_state WHERE key = 'last_bark_test_success_at'")
      .first<{ value: string }>(),
  ]);

  const jobs = {
    pending: counts?.pending || 0,
    retrying: counts?.retrying || 0,
    failed: counts?.failed || 0,
    overdue: counts?.overdue || 0,
  };
  const scheduler = getSchedulerHealth(lastRun, now);
  const barkConfigured = Boolean(context.env.BARK_DEVICE_KEY);
  const bark = getBarkHealth(
    barkConfigured,
    lastSuccessfulDelivery?.attempted_at || null,
    lastSuccessfulTest?.value || null,
    now,
  );
  const health = getOverallHealth(scheduler.state, bark.state, jobs);

  return context.json({
    data: {
      status: health.status,
      statusMessage: health.message,
      timezone: getConfig(context.env).timeZone,
      currentTime: nowIso,
      jobs,
      scheduler: {
        state: scheduler.state,
        lastRunAt: lastRun?.finished_at || lastRun?.started_at || null,
        outcome: lastRun?.outcome || null,
        errorCode: lastRun?.error_code || null,
      },
      bark,
      lastSchedulerRun: lastRun,
    },
  });
});

systemRoutes.post("/notification-jobs/:id/retry", async (context) => {
  const id = context.req.param("id");
  const job = await context.env.DB
    .prepare(
      `SELECT id, status
       FROM notification_jobs
       WHERE id = ? AND profile_id = ?`,
    )
    .bind(id, DEFAULT_PROFILE_ID)
    .first<{ id: string; status: string }>();
  if (!job) throw notFound("通知任务");
  if (job.status !== "failed") {
    throw conflict("只有失败的通知任务可以重新发送");
  }

  const retryAt = new Date().toISOString();
  const result = await context.env.DB
    .prepare(
      `UPDATE notification_jobs
       SET status = 'retry', attempts = 0, next_attempt_at = ?,
           claim_token = NULL, claimed_at = NULL, last_error = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND status = 'failed'`,
    )
    .bind(retryAt, retryAt, id, DEFAULT_PROFILE_ID)
    .run();
  if (!result.meta.changes) {
    throw conflict("通知任务状态已改变，请刷新后重试");
  }

  return context.json({
    data: { id, status: "retry", nextAttemptAt: retryAt },
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
      `SELECT j.id, j.source_type, j.source_id, j.scheduled_at, j.title, j.body,
              j.group_name, j.status, j.attempts, j.sent_at, j.last_error,
              CASE WHEN j.source_type = 'medication' THEN s.medication_id ELSE NULL END AS owner_id,
              r.id AS record_id, r.status AS adherence_status, r.taken_at
       FROM notification_jobs j
       LEFT JOIN medication_schedules s
         ON j.source_type = 'medication' AND s.id = j.source_id
       LEFT JOIN medication_records r
         ON r.schedule_id = j.source_id AND r.scheduled_at = j.scheduled_at
       WHERE j.scheduled_at BETWEEN ? AND ?
       ORDER BY j.scheduled_at
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
              d.provider_code, d.error_code, j.source_type, j.scheduled_at, j.title,
              j.status AS job_status, j.attempts
       FROM notification_deliveries d
       JOIN notification_jobs j ON j.id = d.job_id
       ORDER BY d.attempted_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return context.json({ data: results });
});

type SchedulerState = "healthy" | "running" | "missing" | "stale" | "failed";
type BarkState = "healthy" | "not_configured" | "unverified" | "stale";

function getSchedulerHealth(
  lastRun: SchedulerRunRow | null,
  now: Date,
): { state: SchedulerState } {
  if (!lastRun) return { state: "missing" };
  const lastRunAt = Date.parse(lastRun.finished_at || lastRun.started_at);
  if (!Number.isFinite(lastRunAt) || now.getTime() - lastRunAt > SCHEDULER_STALE_AFTER_MS) {
    return { state: "stale" };
  }
  if (lastRun.outcome === "running") return { state: "running" };
  if (lastRun.outcome !== "success") return { state: "failed" };
  return { state: "healthy" };
}

function getOverallHealth(
  schedulerState: SchedulerState,
  barkState: BarkState,
  jobs: { failed: number; overdue: number },
): { status: "healthy" | "attention" | "unavailable"; message: string } {
  if (barkState === "not_configured") {
    return { status: "unavailable", message: "Bark 设备尚未配置" };
  }
  if (schedulerState === "failed") {
    return { status: "unavailable", message: "最近一次调度运行失败" };
  }
  if (schedulerState === "stale") {
    return { status: "unavailable", message: "调度已超过 3 分钟未成功运行" };
  }
  if (schedulerState === "missing") {
    return { status: "attention", message: "调度尚未运行" };
  }
  if (schedulerState === "running") {
    return { status: "attention", message: "调度正在运行，等待本次结果" };
  }
  if (jobs.overdue > 0) {
    return { status: "attention", message: `有 ${jobs.overdue} 个任务已到期但尚未处理` };
  }
  if (jobs.failed > 0) {
    return { status: "attention", message: `有 ${jobs.failed} 个失败任务需要处理` };
  }
  if (barkState === "unverified") {
    return { status: "attention", message: "Bark 尚无成功测试或投递记录" };
  }
  if (barkState === "stale") {
    return { status: "attention", message: "Bark 最近 7 天没有成功测试或投递" };
  }
  return { status: "healthy", message: "调度与 Bark 最近验证正常" };
}

function getBarkHealth(
  configured: boolean,
  deliveryAt: string | null,
  testAt: string | null,
  now: Date,
): {
  configured: boolean;
  state: BarkState;
  lastSuccessfulAt: string | null;
  lastSuccessfulSource: "delivery" | "test" | null;
} {
  if (!configured) {
    return {
      configured,
      state: "not_configured",
      lastSuccessfulAt: null,
      lastSuccessfulSource: null,
    };
  }
  const candidates = [
    { value: deliveryAt, source: "delivery" as const },
    { value: testAt, source: "test" as const },
  ].filter((candidate) => candidate.value && Number.isFinite(Date.parse(candidate.value)));
  const latest = candidates.sort(
    (left, right) => Date.parse(right.value!) - Date.parse(left.value!),
  )[0];
  if (!latest) {
    return {
      configured,
      state: "unverified",
      lastSuccessfulAt: null,
      lastSuccessfulSource: null,
    };
  }
  const stale = now.getTime() - Date.parse(latest.value!) > BARK_STALE_AFTER_MS;
  return {
    configured,
    state: stale ? "stale" : "healthy",
    lastSuccessfulAt: latest.value!,
    lastSuccessfulSource: latest.source,
  };
}
