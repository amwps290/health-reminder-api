import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { DEFAULT_PROFILE_ID, type Env } from "../src/core/types";

const headers = {
  Authorization: "Bearer test-admin-token-at-least-16",
};

describe("backup export", () => {
  it("exports user data and history without runtime secrets", async () => {
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO medical_notes (
           id, profile_id, title, content, source, recorded_at, created_at, updated_at
         ) VALUES ('backup-note', ?, '复诊医嘱', '按医嘱记录', '门诊', ?, ?, ?)`,
      )
      .bind(DEFAULT_PROFILE_ID, now, now, now)
      .run();

    const response = await request("/api/v1/backup/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="health-reminder-backup-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const text = await response.text();
    expect(text).not.toContain("test-admin-token-at-least-16");
    expect(text).not.toContain("test-session-secret-at-least-32-characters");
    expect(text).not.toContain("test-device-key");

    const backup = JSON.parse(text) as {
      format: string;
      version: number;
      excluded: string[];
      recordCounts: Record<string, number>;
      data: {
        profiles: Array<{ id: string }>;
        medicalNotes: Array<{ id: string; content: string }>;
      };
    };
    expect(backup).toMatchObject({
      format: "health-reminder-backup",
      version: 3,
      excluded: ["scheduler_runs", "maintenance_state", "worker_secrets"],
    });
    expect(backup.recordCounts.medicationRecords).toBe(0);
    expect(backup.recordCounts.medicalNotes).toBe(1);
    expect(backup.data.profiles).toContainEqual(expect.objectContaining({ id: DEFAULT_PROFILE_ID }));
    expect(backup.data.medicalNotes).toContainEqual({
      id: "backup-note",
      profile_id: DEFAULT_PROFILE_ID,
      title: "复诊医嘱",
      content: "按医嘱记录",
      source: "门诊",
      recorded_at: now,
      created_at: now,
      updated_at: now,
    });
  });

  it("exports all tables as CSV rows", async () => {
    const response = await request("/api/v1/backup/export?format=csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toMatch(/\.csv"$/);
    const csv = await response.text();
    expect(csv).toContain('"profiles"');
    expect(csv).toContain('"notificationTargets"');
    expect(csv).not.toContain("test-device-key");
  });

  it("accepts version 2 backups without medication records", async () => {
    const exported = await request("/api/v1/backup/export");
    const backup = await exported.json() as {
      version: number;
      recordCounts: Record<string, number>;
      data: Record<string, unknown>;
    };
    backup.version = 2;
    delete backup.recordCounts.medicationRecords;
    delete backup.data.medicationRecords;

    const response = await request("/api/v1/backup/validate", {
      method: "POST",
      body: JSON.stringify(backup),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { valid: true, version: 2, incoming: { medicationRecords: 0 } },
    });
  });

  it("validates and restores a JSON backup after preview", async () => {
    const exported = await request("/api/v1/backup/export");
    const backup = await exported.json() as Record<string, unknown>;
    const previewResponse = await request("/api/v1/backup/validate", {
      method: "POST",
      body: JSON.stringify(backup),
      headers: { "Content-Type": "application/json" },
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as {
      data: { valid: boolean; incoming: Record<string, number>; existing: Record<string, number> };
    };
    expect(preview.data.valid).toBe(true);
    expect(preview.data.incoming.profiles).toBe(1);

    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO medical_notes (
           id, profile_id, title, content, source, recorded_at, created_at, updated_at
         ) VALUES ('created-after-backup', ?, '临时记录', '将被恢复替换', '', ?, ?, ?)`
      )
      .bind(DEFAULT_PROFILE_ID, now, now, now)
      .run();
    const restoreResponse = await request("/api/v1/backup/restore", {
      method: "POST",
      body: JSON.stringify({ backup, confirm: "RESTORE" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(restoreResponse.status).toBe(200);
    const temporary = await env.DB
      .prepare("SELECT id FROM medical_notes WHERE id = 'created-after-backup'")
      .first();
    expect(temporary).toBeNull();
  });
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(
    `https://local.test${path}`,
    { ...init, headers: { ...headers, ...Object.fromEntries(new Headers(init.headers)) } },
    env as Env,
  );
}
