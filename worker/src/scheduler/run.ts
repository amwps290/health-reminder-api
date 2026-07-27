import { getConfig, type Env } from "../core/types";
import { BarkChannel } from "../integrations/bark";
import { dispatchDueJobs } from "./dispatch";
import { topUpInjectionJobs, topUpMedicationJobs } from "./materialize";
import { cleanupOldRecords, type RetentionSummary } from "./retention";

export interface SchedulerSummary {
  materialized: number;
  claimed: number;
  sent: number;
  failed: number;
}

export async function runScheduler(env: Env, now = new Date()): Promise<SchedulerSummary> {
  const runId = crypto.randomUUID();
  const startedAt = now.toISOString();
  await env.DB
    .prepare(
      `INSERT INTO scheduler_runs (id, started_at, outcome)
       VALUES (?, ?, 'running')`,
    )
    .bind(runId, startedAt)
    .run();

  try {
    const config = getConfig(env);
    const medicationJobs = await topUpMedicationJobs(env.DB, now, config);
    const injectionJobs = await topUpInjectionJobs(env.DB, now, config);
    const materialized = medicationJobs + injectionJobs;
    const dispatched = await dispatchDueJobs(
      env.DB,
      new BarkChannel(env),
      now,
      config.maxDeliveryAttempts,
    );
    let retention: RetentionSummary | null = null;
    try {
      retention = await cleanupOldRecords(env.DB, now, config);
    } catch (error) {
      console.error(JSON.stringify({
        event: "retention_cleanup_failed",
        runId,
        errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      }));
    }
    const finishedAt = new Date().toISOString();
    await env.DB
      .prepare(
        `UPDATE scheduler_runs
         SET finished_at = ?, materialized_count = ?, claimed_count = ?,
             sent_count = ?, failed_count = ?, outcome = 'success'
         WHERE id = ?`,
      )
      .bind(
        finishedAt,
        materialized,
        dispatched.claimed,
        dispatched.sent,
        dispatched.failed,
        runId,
      )
      .run();

    console.log(JSON.stringify({
      event: "scheduler_complete",
      runId,
      materialized,
      retention,
      ...dispatched,
    }));
    return { materialized, ...dispatched };
  } catch (error) {
    const errorCode = error instanceof Error ? error.name : "UNKNOWN_ERROR";
    await env.DB
      .prepare(
        `UPDATE scheduler_runs
         SET finished_at = ?, outcome = 'failed', error_code = ?
         WHERE id = ?`,
      )
      .bind(new Date().toISOString(), errorCode, runId)
      .run();
    console.error(JSON.stringify({ event: "scheduler_failed", runId, errorCode }));
    throw error;
  }
}
