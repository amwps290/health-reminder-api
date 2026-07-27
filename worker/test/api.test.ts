import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { addLocalDays, dateInTimeZone } from "../src/core/time";
import type { Env } from "../src/core/types";

const headers = {
  Authorization: "Bearer test-admin-token-at-least-16",
  "Content-Type": "application/json",
};

describe("health reminder API", () => {
  it("creates, lists and updates a medication with materialized jobs", async () => {
    const tomorrow = addLocalDays(dateInTimeZone(new Date(), "Asia/Shanghai"), 1);
    const created = await request("/api/v1/medications", {
      method: "POST",
      body: JSON.stringify({
        name: "钙片",
        dose: "1 片",
        instructions: "饭后服用",
        startDate: tomorrow,
        endDate: addLocalDays(tomorrow, 2),
        times: ["08:00", "20:00"],
        enabled: true,
      }),
    });
    expect(created.status).toBe(201);
    const medication = (await created.json() as { data: { id: string; schedule: { version: number } } }).data;
    expect(medication.schedule.version).toBe(1);

    const jobs = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM notification_jobs WHERE source_type = 'medication'")
      .first<{ count: number }>();
    expect(jobs?.count).toBe(6);

    const updated = await request(`/api/v1/medications/${medication.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "钙片",
        dose: "1 片",
        instructions: "遵医嘱饭后服用",
        startDate: tomorrow,
        endDate: addLocalDays(tomorrow, 2),
        times: ["09:00"],
        enabled: true,
      }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json() as {
      data: { schedule: { version: number; times: string[] } };
    };
    expect(updatedBody.data.schedule.version).toBe(2);
    expect(updatedBody.data.schedule.times).toEqual(["09:00"]);

    const statuses = await env.DB
      .prepare("SELECT status, COUNT(*) AS count FROM notification_jobs GROUP BY status")
      .all<{ status: string; count: number }>();
    expect(statuses.results.find((row) => row.status === "canceled")?.count).toBe(6);
    expect(statuses.results.find((row) => row.status === "pending")?.count).toBe(3);
  });

  it("creates an event, note and linked question", async () => {
    const eventAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const remindAt = new Date(Date.now() + 86_400_000).toISOString();
    const eventResponse = await request("/api/v1/events", {
      method: "POST",
      body: JSON.stringify({
        type: "checkup",
        title: "产检",
        eventAt,
        location: "医院",
        notes: "携带检查资料",
        reminderTimes: [remindAt],
        enabled: true,
      }),
    });
    expect(eventResponse.status).toBe(201);
    const event = (await eventResponse.json() as { data: { id: string } }).data;

    const noteResponse = await request("/api/v1/medical-notes", {
      method: "POST",
      body: JSON.stringify({
        title: "本次医嘱",
        content: "按医生要求记录",
        source: "门诊",
        recordedAt: new Date().toISOString(),
      }),
    });
    expect(noteResponse.status).toBe(201);

    const questionResponse = await request("/api/v1/questions", {
      method: "POST",
      body: JSON.stringify({
        eventId: event.id,
        content: "下次检查需要空腹吗？",
        status: "open",
        answer: "",
        sortOrder: 0,
      }),
    });
    expect(questionResponse.status).toBe(201);

    const timeline = await request(
      `/api/v1/timeline?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(eventAt)}`,
    );
    expect(timeline.status).toBe(200);
    const timelineBody = await timeline.json() as { data: Array<{ source_type: string }> };
    expect(timelineBody.data.some((item) => item.source_type === "event")).toBe(true);
  });

  it("creates injection jobs and recalculates sides from actual completion records", async () => {
    const tomorrow = addLocalDays(dateInTimeZone(new Date(), "Asia/Shanghai"), 1);
    const created = await request("/api/v1/injections", {
      method: "POST",
      body: JSON.stringify({
        name: "低分子肝素",
        dose: "1 支",
        site: "腹部",
        instructions: "按医嘱注射",
        startDate: tomorrow,
        endDate: addLocalDays(tomorrow, 4),
        localTime: "20:00",
        intervalDays: 2,
        firstSide: "left",
        enabled: true,
      }),
    });
    expect(created.status).toBe(201);
    const injection = (await created.json() as { data: { id: string; version: number } }).data;
    expect(injection.version).toBe(1);

    const jobs = await env.DB
      .prepare(
        `SELECT body, scheduled_at FROM notification_jobs
         WHERE source_type = 'injection' AND status = 'pending'
         ORDER BY scheduled_at`,
      )
      .all<{ body: string; scheduled_at: string }>();
    expect(jobs.results).toHaveLength(3);
    expect(jobs.results.map((job) => job.body)).toEqual([
      expect.stringContaining("腹部左侧"),
      expect.stringContaining("腹部左侧"),
      expect.stringContaining("腹部左侧"),
    ]);

    const updated = await request(`/api/v1/injections/${injection.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "低分子肝素",
        dose: "1 支",
        site: "腹部",
        instructions: "按医嘱注射",
        startDate: tomorrow,
        endDate: addLocalDays(tomorrow, 2),
        localTime: "21:00",
        intervalDays: 1,
        firstSide: "right",
        enabled: true,
      }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json() as {
      data: { version: number; intervalDays: number; firstSide: string };
    };
    expect(updatedBody.data).toMatchObject({ version: 2, intervalDays: 1, firstSide: "right" });

    const statuses = await env.DB
      .prepare(
        `SELECT status, COUNT(*) AS count FROM notification_jobs
         WHERE source_type = 'injection' GROUP BY status`,
      )
      .all<{ status: string; count: number }>();
    expect(statuses.results.find((row) => row.status === "canceled")?.count).toBe(3);
    expect(statuses.results.find((row) => row.status === "pending")?.count).toBe(3);

    const completed = await request(`/api/v1/injections/${injection.id}/records`, {
      method: "POST",
      body: JSON.stringify({
        scheduledDate: tomorrow,
        status: "completed",
        completedAt: new Date().toISOString(),
        actualSide: "left",
        rescheduledTo: null,
        notes: "实际使用左侧",
      }),
    });
    expect(completed.status).toBe(201);
    const recalculated = await env.DB
      .prepare(
        `SELECT body FROM notification_jobs
         WHERE source_type = 'injection' AND source_version = 3 AND status = 'pending'
         ORDER BY scheduled_at`,
      )
      .all<{ body: string }>();
    expect(recalculated.results.map((job) => job.body)).toEqual([
      expect.stringContaining("腹部右侧"),
      expect.stringContaining("腹部左侧"),
    ]);

    const skippedDate = addLocalDays(tomorrow, 1);
    const skipped = await request(`/api/v1/injections/${injection.id}/records`, {
      method: "POST",
      body: JSON.stringify({
        scheduledDate: skippedDate,
        status: "skipped",
        completedAt: null,
        actualSide: null,
        rescheduledTo: null,
        notes: "遵医嘱跳过",
      }),
    });
    expect(skipped.status).toBe(201);
    const afterSkip = await env.DB
      .prepare(
        `SELECT body FROM notification_jobs
         WHERE source_type = 'injection' AND source_version = 4 AND status = 'pending'
         ORDER BY scheduled_at`,
      )
      .all<{ body: string }>();
    expect(afterSkip.results).toHaveLength(1);
    expect(afterSkip.results[0]?.body).toContain("腹部右侧");

    const records = await request(`/api/v1/injections/${injection.id}/records`);
    expect((await records.json() as { data: unknown[] }).data).toHaveLength(2);
  });

  it("calibrates and calculates pregnancy week", async () => {
    const today = dateInTimeZone(new Date(), "Asia/Shanghai");
    const yesterday = addLocalDays(today, -1);
    const updated = await request("/api/v1/pregnancy", {
      method: "PUT",
      body: JSON.stringify({
        calibratedOn: yesterday,
        weeks: 12,
        days: 3,
      }),
    });
    expect(updated.status).toBe(200);

    const response = await request("/api/v1/pregnancy");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        configured: boolean;
        currentWeeks: number;
        currentDays: number;
        dueDate: string;
      };
    };
    expect(body.data.configured).toBe(true);
    expect(body.data.currentWeeks).toBe(12);
    expect(body.data.currentDays).toBe(4);
    expect(body.data.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("creates, updates and removes pregnancy weight records", async () => {
    const today = dateInTimeZone(new Date(), "Asia/Shanghai");
    const yesterday = addLocalDays(today, -1);
    const created = await request("/api/v1/weights", {
      method: "POST",
      body: JSON.stringify({
        measuredOn: yesterday,
        weightKg: 62.34,
        note: "晨起空腹",
      }),
    });
    expect(created.status).toBe(201);
    const record = (await created.json() as {
      data: { id: string; measuredOn: string; weightKg: number; note: string };
    }).data;
    expect(record).toMatchObject({
      measuredOn: yesterday,
      weightKg: 62.3,
      note: "晨起空腹",
    });

    const duplicate = await request("/api/v1/weights", {
      method: "POST",
      body: JSON.stringify({ measuredOn: yesterday, weightKg: 63, note: "" }),
    });
    expect(duplicate.status).toBe(409);

    const second = await request("/api/v1/weights", {
      method: "POST",
      body: JSON.stringify({ measuredOn: today, weightKg: 62.8, note: "" }),
    });
    expect(second.status).toBe(201);

    const updated = await request(`/api/v1/weights/${record.id}`, {
      method: "PUT",
      body: JSON.stringify({ measuredOn: yesterday, weightKg: 62.5, note: "复测" }),
    });
    expect(updated.status).toBe(200);

    const listed = await request("/api/v1/weights");
    const records = (await listed.json() as {
      data: Array<{ id: string; measuredOn: string; weightKg: number; note: string }>;
    }).data;
    expect(records).toHaveLength(2);
    expect(records.map((item) => item.measuredOn)).toEqual([yesterday, today]);
    expect(records[0]).toMatchObject({ weightKg: 62.5, note: "复测" });

    const removed = await request(`/api/v1/weights/${record.id}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
  });
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const requestHeaders = new Headers(headers);
  new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
  return await app.request(
    `https://local.test${path}`,
    { ...init, headers: requestHeaders },
    env as Env,
  );
}
