import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { DEFAULT_PROFILE_ID, DEFAULT_TARGET_ID, type Env } from "../src/core/types";

const headers = {
  Authorization: "Bearer test-admin-token-at-least-16",
  "Content-Type": "application/json",
};

describe("system health and recovery", () => {
  it("reports a recent successful scheduler run as healthy", async () => {
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO scheduler_runs (
           id, started_at, finished_at, outcome
         ) VALUES ('healthy-run', ?, ?, 'success')`,
      )
      .bind(now, now)
      .run();

    const response = await request("/api/v1/system/status");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        status: string;
        statusMessage: string;
        scheduler: { state: string; outcome: string };
        bark: { configured: boolean };
        jobs: { overdue: number };
      };
    };
    expect(body.data).toMatchObject({
      status: "healthy",
      statusMessage: "调度运行正常",
      scheduler: { state: "healthy", outcome: "success" },
      bark: { configured: true },
      jobs: { overdue: 0 },
    });
  });

  it("reports failed scheduler runs as unavailable", async () => {
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO scheduler_runs (
           id, started_at, finished_at, outcome, error_code
         ) VALUES ('failed-run', ?, ?, 'failed', 'BARK_ERROR')`,
      )
      .bind(now, now)
      .run();

    const response = await request("/api/v1/system/status");
    const body = await response.json() as {
      data: { status: string; statusMessage: string; scheduler: { state: string } };
    };
    expect(body.data).toMatchObject({
      status: "unavailable",
      statusMessage: "最近一次调度运行失败",
      scheduler: { state: "failed" },
    });
  });

  it("keeps a current scheduler run healthy while it is in progress", async () => {
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO scheduler_runs (
           id, started_at, outcome
         ) VALUES ('running-run', ?, 'running')`,
      )
      .bind(now)
      .run();

    const response = await request("/api/v1/system/status");
    const body = await response.json() as {
      data: { status: string; statusMessage: string; scheduler: { state: string } };
    };
    expect(body.data).toMatchObject({
      status: "healthy",
      statusMessage: "调度正在运行",
      scheduler: { state: "running" },
    });
  });

  it("requeues only failed notification jobs and preserves delivery history", async () => {
    const now = new Date().toISOString();
    await insertFailedJob("manual-retry-job", now);

    const deliveriesResponse = await request("/api/v1/deliveries");
    const deliveriesBody = await deliveriesResponse.json() as {
      data: Array<{ job_id: string; job_status: string; attempts: number }>;
    };
    expect(deliveriesBody.data[0]).toMatchObject({
      job_id: "manual-retry-job",
      job_status: "failed",
      attempts: 4,
    });

    const retryResponse = await request(
      "/api/v1/notification-jobs/manual-retry-job/retry",
      { method: "POST" },
    );
    expect(retryResponse.status).toBe(200);
    const job = await env.DB
      .prepare(
        `SELECT status, attempts, next_attempt_at, last_error
         FROM notification_jobs WHERE id = 'manual-retry-job'`,
      )
      .first<{
        status: string;
        attempts: number;
        next_attempt_at: string | null;
        last_error: string | null;
      }>();
    expect(job?.status).toBe("retry");
    expect(job?.attempts).toBe(0);
    expect(job?.next_attempt_at).toBeTruthy();
    expect(job?.last_error).toBeNull();

    const duplicateRetry = await request(
      "/api/v1/notification-jobs/manual-retry-job/retry",
      { method: "POST" },
    );
    expect(duplicateRetry.status).toBe(409);

    const deliveryCount = await env.DB
      .prepare(
        `SELECT COUNT(*) AS count
         FROM notification_deliveries WHERE job_id = 'manual-retry-job'`,
      )
      .first<{ count: number }>();
    expect(deliveryCount?.count).toBe(1);
  });
});

async function insertFailedJob(id: string, now: string): Promise<void> {
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO notification_jobs (
           id, profile_id, target_id, source_type, source_id, source_version,
           dedupe_key, scheduled_at, title, body, group_name, status,
           attempts, last_error, created_at, updated_at
         ) VALUES (?, ?, ?, 'event', ?, 1, ?, ?, '检查提醒', '测试正文',
                   'health-event', 'failed', 4, 'BARK_REJECTED_502', ?, ?)`,
      )
      .bind(
        id,
        DEFAULT_PROFILE_ID,
        DEFAULT_TARGET_ID,
        id,
        `test:${id}`,
        now,
        now,
        now,
      ),
    env.DB
      .prepare(
        `INSERT INTO notification_deliveries (
           id, job_id, attempted_at, success, http_status, provider_code,
           error_code, created_at
         ) VALUES (?, ?, ?, 0, 502, NULL, 'BARK_REJECTED_502', ?)`,
      )
      .bind(`${id}-delivery`, id, now, now),
  ]);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const requestHeaders = new Headers(headers);
  new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
  return app.request(
    `https://local.test${path}`,
    { ...init, headers: requestHeaders },
    env as Env,
  );
}
