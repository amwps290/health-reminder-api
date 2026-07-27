import type { NotificationChannel } from "../integrations/bark";

interface DueJobRow {
  id: string;
  title: string;
  body: string;
  group_name: string;
  urgency: "active" | "timeSensitive" | "passive";
  attempts: number;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
}

export async function dispatchDueJobs(
  database: D1Database,
  channel: NotificationChannel,
  now: Date,
  maxAttempts: number,
): Promise<DispatchSummary> {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
  await database
    .prepare(
      `UPDATE notification_jobs
       SET status = 'retry', next_attempt_at = ?, claim_token = NULL, claimed_at = NULL, updated_at = ?
       WHERE status = 'processing' AND claimed_at <= ?`,
    )
    .bind(nowIso, nowIso, staleBefore)
    .run();

  const { results: candidates } = await database
    .prepare(
      `SELECT id
       FROM notification_jobs
       WHERE (status = 'pending' AND scheduled_at <= ?)
          OR (status = 'retry' AND next_attempt_at <= ?)
       ORDER BY scheduled_at
       LIMIT 50`,
    )
    .bind(nowIso, nowIso)
    .all<{ id: string }>();

  if (candidates.length === 0) return { claimed: 0, sent: 0, failed: 0 };

  const claimToken = crypto.randomUUID();
  await database.batch(
    candidates.map((candidate) =>
      database
        .prepare(
          `UPDATE notification_jobs
           SET status = 'processing', attempts = attempts + 1,
               claim_token = ?, claimed_at = ?, updated_at = ?
           WHERE id = ? AND (
             (status = 'pending' AND scheduled_at <= ?)
             OR (status = 'retry' AND next_attempt_at <= ?)
           )`,
        )
        .bind(claimToken, nowIso, nowIso, candidate.id, nowIso, nowIso),
    ),
  );

  const { results: jobs } = await database
    .prepare(
      `SELECT id, title, body, group_name, urgency, attempts
       FROM notification_jobs WHERE claim_token = ? AND status = 'processing'
       ORDER BY scheduled_at`,
    )
    .bind(claimToken)
    .all<DueJobRow>();

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    let result;
    try {
      result = await channel.send({
        title: job.title,
        body: job.body,
        group: job.group_name,
        level: job.urgency,
      });
    } catch (error) {
      result = {
        success: false,
        httpStatus: null,
        providerCode: null,
        providerMessage: null,
        errorCode: error instanceof Error ? error.name : "CHANNEL_ERROR",
      };
    }

    const finishedAt = new Date().toISOString();
    const deliveryId = crypto.randomUUID();
    if (result.success) {
      sent += 1;
      await database.batch([
        database
          .prepare(
            `UPDATE notification_jobs
             SET status = 'sent', sent_at = ?, next_attempt_at = NULL,
                 claim_token = NULL, claimed_at = NULL, last_error = NULL, updated_at = ?
             WHERE id = ? AND claim_token = ?`,
          )
          .bind(finishedAt, finishedAt, job.id, claimToken),
        deliveryStatement(database, deliveryId, job.id, finishedAt, true, result),
      ]);
      continue;
    }

    failed += 1;
    const terminal = job.attempts >= maxAttempts;
    const nextAttemptAt = terminal
      ? null
      : new Date(now.getTime() + retryDelayMinutes(job.attempts) * 60_000).toISOString();
    await database.batch([
      database
        .prepare(
          `UPDATE notification_jobs
           SET status = ?, next_attempt_at = ?, claim_token = NULL, claimed_at = NULL,
               last_error = ?, updated_at = ?
           WHERE id = ? AND claim_token = ?`,
        )
        .bind(
          terminal ? "failed" : "retry",
          nextAttemptAt,
          result.errorCode || "BARK_UNKNOWN_ERROR",
          finishedAt,
          job.id,
          claimToken,
        ),
      deliveryStatement(database, deliveryId, job.id, finishedAt, false, result),
    ]);
  }

  return { claimed: jobs.length, sent, failed };
}

function deliveryStatement(
  database: D1Database,
  id: string,
  jobId: string,
  attemptedAt: string,
  success: boolean,
  result: {
    httpStatus: number | null;
    providerCode: number | null;
    errorCode: string | null;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO notification_deliveries (
         id, job_id, attempted_at, success, http_status, provider_code, error_code, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      jobId,
      attemptedAt,
      success ? 1 : 0,
      result.httpStatus,
      result.providerCode,
      result.errorCode,
      attemptedAt,
    );
}

function retryDelayMinutes(attempt: number): number {
  return [1, 3, 10][Math.min(Math.max(attempt - 1, 0), 2)]!;
}
