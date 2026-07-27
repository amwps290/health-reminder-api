import { Hono } from "hono";
import { AppError } from "../core/errors";
import type { AppContext } from "../core/types";
import { getConfig } from "../core/types";

const BACKUP_FORMAT = "health-reminder-backup";
const BACKUP_VERSION = 2;
const MAX_BACKUP_BYTES = 5_000_000;

type DatabaseValue = string | number | null;
type BackupRow = Record<string, DatabaseValue>;
type BackupData = Record<string, BackupRow[]>;

interface BackupDocument {
  format: string;
  version: number;
  exportedAt: string;
  timezone: string;
  recordCounts: Record<string, number>;
  excluded: string[];
  data: BackupData;
}

interface TableDefinition {
  key: string;
  table: string;
  columns: readonly string[];
  primaryKey: string;
  optionalForVersions?: readonly number[];
}

const TABLES: readonly TableDefinition[] = [
  table("profiles", "profiles", ["id", "display_name", "timezone", "created_at", "updated_at"], "id"),
  table("notificationTargets", "notification_targets", ["id", "profile_id", "channel_type", "label", "enabled", "created_at", "updated_at"], "id"),
  table("medications", "medications", ["id", "profile_id", "name", "dose", "instructions", "enabled", "created_at", "updated_at"], "id"),
  table("medicationSchedules", "medication_schedules", ["id", "medication_id", "schedule_type", "timezone", "start_date", "end_date", "version", "materialized_through", "created_at", "updated_at"], "id"),
  table("medicationTimes", "medication_times", ["id", "schedule_id", "local_time", "sort_order"], "id"),
  table("injectionPlans", "injection_plans", ["id", "profile_id", "name", "dose", "site", "instructions", "start_date", "end_date", "local_time", "timezone", "interval_days", "first_side", "enabled", "version", "materialized_through", "created_at", "updated_at"], "id"),
  { ...table("injectionRecords", "injection_records", ["id", "plan_id", "scheduled_date", "status", "completed_at", "actual_side", "rescheduled_to", "notes", "created_at", "updated_at"], "id"), optionalForVersions: [1] },
  table("events", "events", ["id", "profile_id", "event_type", "title", "event_at", "timezone", "location", "notes", "enabled", "version", "created_at", "updated_at"], "id"),
  table("eventReminders", "event_reminders", ["id", "event_id", "remind_at"], "id"),
  table("medicalNotes", "medical_notes", ["id", "profile_id", "title", "content", "source", "recorded_at", "created_at", "updated_at"], "id"),
  table("questions", "questions", ["id", "profile_id", "event_id", "content", "status", "answer", "sort_order", "created_at", "updated_at"], "id"),
  table("pregnancySettings", "pregnancy_settings", ["profile_id", "calibrated_on", "gestational_days", "created_at", "updated_at"], "profile_id"),
  table("weightRecords", "weight_records", ["id", "profile_id", "measured_on", "weight_kg", "note", "created_at", "updated_at"], "id"),
  table("notificationJobs", "notification_jobs", ["id", "profile_id", "target_id", "source_type", "source_id", "source_version", "dedupe_key", "scheduled_at", "title", "body", "group_name", "urgency", "status", "attempts", "next_attempt_at", "claim_token", "claimed_at", "sent_at", "last_error", "created_at", "updated_at"], "id"),
  table("notificationDeliveries", "notification_deliveries", ["id", "job_id", "attempted_at", "success", "http_status", "provider_code", "error_code", "created_at"], "id"),
  { ...table("schedulerDailyStats", "scheduler_daily_stats", ["day", "run_count", "success_count", "failed_count", "materialized_count", "claimed_count", "sent_count", "delivery_failed_count", "created_at", "updated_at"], "day"), optionalForVersions: [1] },
];

export const backupRoutes = new Hono<AppContext>();

backupRoutes.get("/export", async (context) => {
  const exportedAt = new Date();
  const data = await readBackupData(context.env.DB);
  const document: BackupDocument = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    timezone: getConfig(context.env).timeZone,
    recordCounts: recordCounts(data),
    excluded: ["scheduler_runs", "maintenance_state", "worker_secrets"],
    data,
  };
  const requestedFormat = context.req.query("format")?.toLowerCase() || "json";
  if (!new Set(["json", "csv"]).has(requestedFormat)) {
    throw new AppError(400, "INVALID_BACKUP_FORMAT", "导出格式只能是 json 或 csv");
  }
  const fileDate = exportedAt.toISOString().slice(0, 10);
  const isCsv = requestedFormat === "csv";
  context.header("Content-Type", isCsv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
  context.header("Content-Disposition", `attachment; filename="health-reminder-backup-${fileDate}.${isCsv ? "csv" : "json"}"`);
  context.header("Cache-Control", "no-store");
  context.header("X-Content-Type-Options", "nosniff");
  return context.body(isCsv ? toCsv(data) : JSON.stringify(document, null, 2));
});

backupRoutes.post("/validate", async (context) => {
  const document = await readDocument(context);
  const preview = await validateBackup(context.env.DB, document);
  return context.json({ data: preview });
});

backupRoutes.post("/restore", async (context) => {
  const payload = await readJsonObject(context);
  if (payload.confirm !== "RESTORE") {
    throw new AppError(400, "RESTORE_CONFIRMATION_REQUIRED", "恢复操作需要明确确认");
  }
  const document = normalizeDocument(payload.backup);
  const preview = await validateBackup(context.env.DB, document);
  const statements: D1PreparedStatement[] = [];
  for (const definition of [...TABLES].reverse()) {
    statements.push(context.env.DB.prepare(`DELETE FROM ${definition.table}`));
  }
  for (const definition of TABLES) {
    for (const row of document.data[definition.key] || []) {
      const placeholders = definition.columns.map(() => "?").join(", ");
      statements.push(
        context.env.DB
          .prepare(`INSERT INTO ${definition.table} (${definition.columns.join(", ")}) VALUES (${placeholders})`)
          .bind(...definition.columns.map((column) => row[column] ?? null)),
      );
    }
  }
  await context.env.DB.batch(statements);
  return context.json({ data: { restoredAt: new Date().toISOString(), recordCounts: preview.incoming } });
});

async function readBackupData(database: D1Database): Promise<BackupData> {
  const entries = await Promise.all(TABLES.map(async (definition) => {
    const { results } = await database
      .prepare(`SELECT ${definition.columns.join(", ")} FROM ${definition.table} ORDER BY ${definition.primaryKey}`)
      .all<BackupRow>();
    return [definition.key, results] as const;
  }));
  return Object.fromEntries(entries);
}

async function validateBackup(database: D1Database, document: BackupDocument) {
  const errors: string[] = [];
  if (document.format !== BACKUP_FORMAT) errors.push("不是健康提醒备份文件");
  if (![1, BACKUP_VERSION].includes(document.version)) errors.push(`不支持备份版本 ${document.version}`);
  if (!Number.isFinite(Date.parse(document.exportedAt))) errors.push("导出时间无效");

  for (const definition of TABLES) {
    const rows = document.data[definition.key];
    const optional = definition.optionalForVersions?.includes(document.version);
    if (!Array.isArray(rows)) {
      if (!optional) errors.push(`缺少数据表 ${definition.key}`);
      document.data[definition.key] = [];
      continue;
    }
    const ids = new Set<DatabaseValue>();
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        errors.push(`${definition.key} 第 ${index + 1} 条不是有效记录`);
        return;
      }
      const keys = Object.keys(row);
      const unknown = keys.filter((key) => !definition.columns.includes(key));
      const missing = definition.columns.filter((column) => !(column in row));
      if (unknown.length) errors.push(`${definition.key} 包含未知字段：${unknown.join("、")}`);
      if (missing.length) errors.push(`${definition.key} 缺少字段：${missing.join("、")}`);
      if (Object.values(row).some((value) => value !== null && typeof value !== "string" && typeof value !== "number")) {
        errors.push(`${definition.key} 第 ${index + 1} 条包含无效字段值`);
      }
      const id = row[definition.primaryKey];
      if (id === null || id === undefined || id === "") {
        errors.push(`${definition.key} 第 ${index + 1} 条缺少主键`);
      } else {
        if (ids.has(id)) errors.push(`${definition.key} 存在重复主键 ${String(id)}`);
        ids.add(id);
      }
    });
    if (document.recordCounts[definition.key] !== undefined && document.recordCounts[definition.key] !== rows.length) {
      errors.push(`${definition.key} 的记录数与文件摘要不一致`);
    }
  }
  validateReferences(document.data, errors);
  if (errors.length) {
    throw new AppError(400, "INVALID_BACKUP", `备份校验失败：${errors.slice(0, 8).join("；")}`);
  }

  const existingEntries = await Promise.all(TABLES.map(async (definition) => {
    const row = await database.prepare(`SELECT COUNT(*) AS count FROM ${definition.table}`).first<{ count: number }>();
    return [definition.key, row?.count || 0] as const;
  }));
  return {
    valid: true,
    version: document.version,
    exportedAt: document.exportedAt,
    timezone: document.timezone,
    incoming: recordCounts(document.data),
    existing: Object.fromEntries(existingEntries),
    warnings: [
      "恢复会替换当前 D1 中的业务数据和通知历史",
      "Secrets、Bark device key 与 Worker 配置不包含在备份中",
    ],
  };
}

function validateReferences(data: BackupData, errors: string[]): void {
  const ids = (key: string, column = "id") => new Set<DatabaseValue>(
    (data[key] || [])
      .map((row) => row[column])
      .filter((value): value is DatabaseValue => value !== undefined),
  );
  const profiles = ids("profiles");
  const medications = ids("medications");
  const schedules = ids("medicationSchedules");
  const plans = ids("injectionPlans");
  const events = ids("events");
  const targets = ids("notificationTargets");
  const jobs = ids("notificationJobs");
  checkReferences(data.notificationTargets, "profile_id", profiles, "notificationTargets", errors);
  checkReferences(data.medications, "profile_id", profiles, "medications", errors);
  checkReferences(data.medicationSchedules, "medication_id", medications, "medicationSchedules", errors);
  checkReferences(data.medicationTimes, "schedule_id", schedules, "medicationTimes", errors);
  checkReferences(data.injectionPlans, "profile_id", profiles, "injectionPlans", errors);
  checkReferences(data.injectionRecords, "plan_id", plans, "injectionRecords", errors);
  checkReferences(data.events, "profile_id", profiles, "events", errors);
  checkReferences(data.eventReminders, "event_id", events, "eventReminders", errors);
  checkReferences(data.medicalNotes, "profile_id", profiles, "medicalNotes", errors);
  checkReferences(data.questions, "profile_id", profiles, "questions", errors);
  checkReferences(data.questions, "event_id", events, "questions", errors, true);
  checkReferences(data.pregnancySettings, "profile_id", profiles, "pregnancySettings", errors);
  checkReferences(data.weightRecords, "profile_id", profiles, "weightRecords", errors);
  checkReferences(data.notificationJobs, "profile_id", profiles, "notificationJobs", errors);
  checkReferences(data.notificationJobs, "target_id", targets, "notificationJobs", errors);
  checkReferences(data.notificationDeliveries, "job_id", jobs, "notificationDeliveries", errors);
}

function checkReferences(
  rows: BackupRow[] | undefined,
  column: string,
  targets: Set<DatabaseValue>,
  label: string,
  errors: string[],
  nullable = false,
): void {
  for (const row of rows || []) {
    const value = row[column];
    if (nullable && value === null) continue;
    if (value === undefined) {
      errors.push(`${label}.${column} 缺少引用值`);
      continue;
    }
    if (!targets.has(value)) errors.push(`${label}.${column} 引用了不存在的记录 ${String(value)}`);
  }
}

async function readDocument(context: Parameters<typeof readJsonObject>[0]): Promise<BackupDocument> {
  return normalizeDocument(await readJsonObject(context));
}

async function readJsonObject(context: { req: { text(): Promise<string> } }): Promise<Record<string, unknown>> {
  const raw = await context.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) {
    throw new AppError(413, "BACKUP_TOO_LARGE", "备份文件不能超过 5 MB");
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new AppError(400, "INVALID_JSON", "备份文件不是有效 JSON");
  }
}

function normalizeDocument(value: unknown): BackupDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_BACKUP", "备份文件结构无效");
  }
  const input = value as Record<string, unknown>;
  if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) {
    throw new AppError(400, "INVALID_BACKUP", "备份文件缺少 data");
  }
  return {
    format: String(input.format || ""),
    version: Number(input.version),
    exportedAt: String(input.exportedAt || ""),
    timezone: String(input.timezone || ""),
    recordCounts: input.recordCounts && typeof input.recordCounts === "object"
      ? input.recordCounts as Record<string, number>
      : {},
    excluded: Array.isArray(input.excluded) ? input.excluded.map(String) : [],
    data: input.data as BackupData,
  };
}

function recordCounts(data: BackupData): Record<string, number> {
  return Object.fromEntries(TABLES.map((definition) => [definition.key, data[definition.key]?.length || 0]));
}

function toCsv(data: BackupData): string {
  const lines = ["table,row_json"];
  for (const definition of TABLES) {
    for (const row of data[definition.key] || []) {
      lines.push(`${csvCell(definition.key)},${csvCell(JSON.stringify(row))}`);
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function table(
  key: string,
  name: string,
  columns: readonly string[],
  primaryKey: string,
): TableDefinition {
  return { key, table: name, columns, primaryKey };
}
