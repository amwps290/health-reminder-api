import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_TARGET_ID,
  type AppConfig,
} from "../src/core/types";
import { cleanupOldRecords } from "../src/scheduler/retention";

const DAY_MS = 86_400_000;
const config: AppConfig = {
  timeZone: "Asia/Shanghai",
  barkBaseUrl: "https://bark.example.com",
  horizonDays: 30,
  maxDeliveryAttempts: 4,
  schedulerRunRetentionDays: 30,
  notificationHistoryRetentionDays: 365,
};

describe("retention cleanup", () => {
  it("removes old terminal history but preserves actionable jobs", async () => {
    const now = new Date("2026-07-27T04:00:00.000Z");
    const oldSchedulerAt = dateBefore(now, 31);
    const recentSchedulerAt = dateBefore(now, 29);
    const oldNotificationAt = dateBefore(now, 366);
    const recentNotificationAt = dateBefore(now, 364);

    await env.DB.batch([
      schedulerRun("old-success-run", oldSchedulerAt, "success"),
      schedulerRun("old-running-run", oldSchedulerAt, "running"),
      schedulerRun("recent-run", recentSchedulerAt, "success"),
      notificationJob("old-sent-job", oldNotificationAt, "sent"),
      notificationJob("old-canceled-job", oldNotificationAt, "canceled"),
      notificationJob("old-failed-job", oldNotificationAt, "failed"),
      notificationJob("old-pending-job", oldNotificationAt, "pending"),
      notificationJob("recent-sent-job", recentNotificationAt, "sent"),
      env.DB
        .prepare(
          `INSERT INTO notification_deliveries (
             id, job_id, attempted_at, success, created_at
           ) VALUES ('old-delivery', 'old-sent-job', ?, 1, ?)`,
        )
        .bind(oldNotificationAt, oldNotificationAt),
    ]);

    const summary = await cleanupOldRecords(env.DB, now, config);
    expect(summary).toEqual({
      ran: true,
      aggregatedDays: 1,
      deletedSchedulerRuns: 2,
      deletedJobs: 2,
      deletedDeliveries: 1,
    });

    expect(await ids("scheduler_runs")).toEqual(["recent-run"]);
    const daily = await env.DB
      .prepare("SELECT run_count, success_count, failed_count FROM scheduler_daily_stats WHERE day = ?")
      .bind(oldSchedulerAt.slice(0, 10))
      .first<{ run_count: number; success_count: number; failed_count: number }>();
    expect(daily).toEqual({ run_count: 2, success_count: 1, failed_count: 0 });
    expect(await ids("notification_jobs")).toEqual([
      "old-failed-job",
      "old-pending-job",
      "recent-sent-job",
    ]);
    expect(await ids("notification_deliveries")).toEqual([]);

    const repeated = await cleanupOldRecords(env.DB, now, config);
    expect(repeated).toEqual({
      ran: false,
      aggregatedDays: 0,
      deletedSchedulerRuns: 0,
      deletedJobs: 0,
      deletedDeliveries: 0,
    });
  });
});

function schedulerRun(id: string, startedAt: string, outcome: string): D1PreparedStatement {
  return env.DB
    .prepare(
      `INSERT INTO scheduler_runs (id, started_at, finished_at, outcome)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, startedAt, outcome === "running" ? null : startedAt, outcome);
}

function notificationJob(
  id: string,
  scheduledAt: string,
  status: string,
): D1PreparedStatement {
  return env.DB
    .prepare(
      `INSERT INTO notification_jobs (
         id, profile_id, target_id, source_type, source_id, source_version,
         dedupe_key, scheduled_at, title, body, group_name, status,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'event', ?, 1, ?, ?, '测试提醒', '测试正文',
                 'health-test', ?, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_PROFILE_ID,
      DEFAULT_TARGET_ID,
      id,
      `retention:${id}`,
      scheduledAt,
      status,
      scheduledAt,
      scheduledAt,
    );
}

async function ids(table: string): Promise<string[]> {
  const allowedTables = new Set([
    "scheduler_runs",
    "notification_jobs",
    "notification_deliveries",
  ]);
  if (!allowedTables.has(table)) throw new Error("Unexpected table");
  const { results } = await env.DB
    .prepare(`SELECT id FROM ${table} ORDER BY id`)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

function dateBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}
