import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_ID, DEFAULT_TARGET_ID } from "../src/core/types";
import type { NotificationChannel } from "../src/integrations/bark";
import { dispatchDueJobs } from "../src/scheduler/dispatch";

describe("notification dispatch", () => {
  it("claims and records a successful delivery", async () => {
    const now = new Date();
    await insertDueJob("success-job", now);
    const channel: NotificationChannel = {
      send: async () => ({ success: true, httpStatus: 200, providerCode: 200, providerMessage: "success", errorCode: null }),
    };

    const summary = await dispatchDueJobs(env.DB, channel, now, 4);
    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0 });
    const job = await env.DB
      .prepare("SELECT status, attempts FROM notification_jobs WHERE id = 'success-job'")
      .first<{ status: string; attempts: number }>();
    expect(job).toEqual({ status: "sent", attempts: 1 });
  });

  it("schedules retry after a rejected delivery", async () => {
    const now = new Date();
    await insertDueJob("retry-job", now);
    const channel: NotificationChannel = {
      send: async () => ({
        success: false,
        httpStatus: 502,
        providerCode: null,
        providerMessage: "upstream failed",
        errorCode: "BARK_REJECTED_502",
      }),
    };

    const summary = await dispatchDueJobs(env.DB, channel, now, 4);
    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 1 });
    const job = await env.DB
      .prepare("SELECT status, attempts, next_attempt_at FROM notification_jobs WHERE id = 'retry-job'")
      .first<{ status: string; attempts: number; next_attempt_at: string }>();
    expect(job?.status).toBe("retry");
    expect(job?.attempts).toBe(1);
    expect(job?.next_attempt_at).toBe(new Date(now.getTime() + 60_000).toISOString());
  });
});

async function insertDueJob(id: string, now: Date): Promise<void> {
  const scheduledAt = new Date(now.getTime() - 60_000).toISOString();
  await env.DB
    .prepare(
      `INSERT INTO notification_jobs (
         id, profile_id, target_id, source_type, source_id, source_version,
         dedupe_key, scheduled_at, title, body, group_name, status,
         attempts, created_at, updated_at
       ) VALUES (?, ?, ?, 'event', ?, 1, ?, ?, '测试', '测试正文', 'health-test',
                 'pending', 0, ?, ?)`,
    )
    .bind(
      id,
      DEFAULT_PROFILE_ID,
      DEFAULT_TARGET_ID,
      id,
      `test:${id}`,
      scheduledAt,
      now.toISOString(),
      now.toISOString(),
    )
    .run();
}
