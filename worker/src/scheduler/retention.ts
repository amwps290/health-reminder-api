import { dateInTimeZone } from "../core/time";
import type { AppConfig } from "../core/types";

const DAY_MS = 86_400_000;
const RETENTION_STATE_KEY = "last_retention_cleanup";

export interface RetentionSummary {
  ran: boolean;
  aggregatedDays: number;
  deletedSchedulerRuns: number;
  deletedJobs: number;
  deletedDeliveries: number;
}

export async function cleanupOldRecords(
  database: D1Database,
  now: Date,
  config: AppConfig,
): Promise<RetentionSummary> {
  const cleanupDate = dateInTimeZone(now, config.timeZone);
  const state = await database
    .prepare("SELECT value FROM maintenance_state WHERE key = ?")
    .bind(RETENTION_STATE_KEY)
    .first<{ value: string }>();
  if (state?.value && state.value >= cleanupDate) return emptySummary(false);

  const schedulerCutoff = new Date(
    now.getTime() - config.schedulerRunRetentionDays * DAY_MS,
  ).toISOString();
  const notificationCutoff = new Date(
    now.getTime() - config.notificationHistoryRetentionDays * DAY_MS,
  ).toISOString();
  const terminalJobFilter = `
    status IN ('sent', 'canceled') AND scheduled_at < ?
  `;
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO scheduler_daily_stats (
           day, run_count, success_count, failed_count, materialized_count,
           claimed_count, sent_count, delivery_failed_count, created_at, updated_at
         )
         SELECT substr(started_at, 1, 10), COUNT(*),
                SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END),
                SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END),
                SUM(materialized_count), SUM(claimed_count), SUM(sent_count),
                SUM(failed_count), ?, ?
         FROM scheduler_runs
         WHERE started_at < ?
         GROUP BY substr(started_at, 1, 10)
         ON CONFLICT(day) DO UPDATE SET
           run_count = scheduler_daily_stats.run_count + excluded.run_count,
           success_count = scheduler_daily_stats.success_count + excluded.success_count,
           failed_count = scheduler_daily_stats.failed_count + excluded.failed_count,
           materialized_count = scheduler_daily_stats.materialized_count + excluded.materialized_count,
           claimed_count = scheduler_daily_stats.claimed_count + excluded.claimed_count,
           sent_count = scheduler_daily_stats.sent_count + excluded.sent_count,
           delivery_failed_count = scheduler_daily_stats.delivery_failed_count + excluded.delivery_failed_count,
           updated_at = excluded.updated_at`,
      )
      .bind(now.toISOString(), now.toISOString(), schedulerCutoff),
    database
      .prepare(
        `DELETE FROM notification_deliveries
         WHERE job_id IN (
           SELECT id FROM notification_jobs WHERE ${terminalJobFilter}
         )`,
      )
      .bind(notificationCutoff),
    database
      .prepare(`DELETE FROM notification_jobs WHERE ${terminalJobFilter}`)
      .bind(notificationCutoff),
    database
      .prepare(
        `DELETE FROM scheduler_runs
         WHERE started_at < ?`,
      )
      .bind(schedulerCutoff),
  ]);

  await database
    .prepare(
      `INSERT INTO maintenance_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .bind(RETENTION_STATE_KEY, cleanupDate, now.toISOString())
    .run();

  return {
    ran: true,
    aggregatedDays: results[0]?.meta.changes || 0,
    deletedDeliveries: results[1]?.meta.changes || 0,
    deletedJobs: results[2]?.meta.changes || 0,
    deletedSchedulerRuns: results[3]?.meta.changes || 0,
  };
}

function emptySummary(ran: boolean): RetentionSummary {
  return {
    ran,
    aggregatedDays: 0,
    deletedSchedulerRuns: 0,
    deletedJobs: 0,
    deletedDeliveries: 0,
  };
}
