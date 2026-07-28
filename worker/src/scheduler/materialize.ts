import {
  addLocalDays,
  compareDates,
  dateInTimeZone,
  differenceInLocalDays,
  eachLocalDate,
  earlierDate,
  laterDate,
  localDateTimeToInstant,
} from "../core/time";
import { DEFAULT_PROFILE_ID, DEFAULT_TARGET_ID, type AppConfig } from "../core/types";
import { eventMessage, injectionMessage, medicationMessage } from "./messages";

interface MedicationScheduleRow {
  schedule_id: string;
  medication_id: string;
  name: string;
  dose: string;
  instructions: string;
  schedule_type: "daily" | "interval_days" | "weekly" | "cycle";
  timezone: string;
  start_date: string;
  end_date: string | null;
  interval_days: number;
  weekdays: number;
  active_days: number;
  rest_days: number;
  version: number;
  materialized_through: string | null;
}

interface MedicationTimeRow {
  local_time: string;
  dose: string;
}

interface EventRow {
  id: string;
  event_type: string;
  title: string;
  event_at: string;
  location: string;
  notes: string;
  version: number;
}

interface EventReminderRow {
  remind_at: string;
}

interface InjectionPlanRow {
  id: string;
  name: string;
  dose: string;
  site: string;
  instructions: string;
  start_date: string;
  end_date: string | null;
  local_time: string;
  timezone: string;
  interval_days: number;
  first_side: "left" | "right";
  enabled: number;
  version: number;
  materialized_through: string | null;
}

interface InjectionRecordRow {
  scheduled_date: string;
  status: "completed" | "skipped" | "rescheduled";
  completed_at: string | null;
  actual_side: "left" | "right" | null;
  rescheduled_to: string | null;
}

interface JobDraft {
  id: string;
  sourceType: "medication" | "event" | "injection";
  sourceId: string;
  sourceVersion: number;
  dedupeKey: string;
  scheduledAt: string;
  title: string;
  body: string;
  groupName: string;
}

export async function regenerateMedicationJobs(
  database: D1Database,
  medicationId: string,
  now: Date,
  config: AppConfig,
): Promise<number> {
  const schedule = await getMedicationSchedule(database, medicationId);
  if (!schedule) return 0;

  await database.batch([
    database
      .prepare(
        `UPDATE notification_jobs
         SET status = 'canceled', updated_at = ?
         WHERE source_type = 'medication' AND source_id = ?
           AND status IN ('pending', 'processing', 'retry')`,
      )
      .bind(now.toISOString(), schedule.schedule_id),
    database
      .prepare("UPDATE medication_schedules SET materialized_through = NULL WHERE id = ?")
      .bind(schedule.schedule_id),
  ]);

  schedule.materialized_through = null;
  return materializeMedicationSchedule(database, schedule, now, config);
}

export async function topUpMedicationJobs(
  database: D1Database,
  now: Date,
  config: AppConfig,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT s.id AS schedule_id, s.medication_id, m.name, m.dose, m.instructions,
              s.schedule_type, s.timezone, s.start_date, s.end_date,
              s.interval_days, s.weekdays, s.active_days, s.rest_days,
              s.version, s.materialized_through
       FROM medication_schedules s
       JOIN medications m ON m.id = s.medication_id
       WHERE m.enabled = 1`,
    )
    .all<MedicationScheduleRow>();

  let count = 0;
  for (const schedule of results) {
    count += await materializeMedicationSchedule(database, schedule, now, config);
  }
  return count;
}

export async function regenerateEventJobs(
  database: D1Database,
  eventId: string,
  now: Date,
): Promise<number> {
  const event = await database
    .prepare(
      `SELECT id, event_type, title, event_at, location, notes, version
       FROM events WHERE id = ? AND enabled = 1`,
    )
    .bind(eventId)
    .first<EventRow>();
  if (!event) return 0;

  await database
    .prepare(
      `UPDATE notification_jobs SET status = 'canceled', updated_at = ?
       WHERE source_type = 'event' AND source_id = ?
         AND status IN ('pending', 'processing', 'retry')`,
    )
    .bind(now.toISOString(), event.id)
    .run();

  const { results: reminders } = await database
    .prepare("SELECT remind_at FROM event_reminders WHERE event_id = ? ORDER BY remind_at")
    .bind(event.id)
    .all<EventReminderRow>();
  const jobs = reminders
    .filter((reminder) => Date.parse(reminder.remind_at) >= now.getTime())
    .map((reminder) => createEventJob(event, reminder.remind_at));
  return insertJobs(database, jobs, now);
}

export async function regenerateInjectionJobs(
  database: D1Database,
  injectionId: string,
  now: Date,
  config: AppConfig,
): Promise<number> {
  const plan = await getInjectionPlan(database, injectionId);
  if (!plan) return 0;

  await database.batch([
    database
      .prepare(
        `UPDATE notification_jobs
         SET status = 'canceled', updated_at = ?
         WHERE source_type = 'injection' AND source_id = ?
           AND status IN ('pending', 'processing', 'retry')`,
      )
      .bind(now.toISOString(), plan.id),
    database
      .prepare("UPDATE injection_plans SET materialized_through = NULL WHERE id = ?")
      .bind(plan.id),
  ]);

  plan.materialized_through = null;
  if (plan.enabled !== 1) return 0;

  try {
    return await materializeInjectionPlan(database, plan, now, config);
  } catch (error) {
    console.error(JSON.stringify({
      event: "injection_regenerate_failed",
      injectionId,
      errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      errorMessage: error instanceof Error ? error.message : "",
    }));
    // Set materialized_through to today so the next topUp can recover
    const today = dateInTimeZone(now, plan.timezone);
    await database
      .prepare("UPDATE injection_plans SET materialized_through = ?, updated_at = ? WHERE id = ?")
      .bind(today, now.toISOString(), plan.id)
      .run();
    throw error;
  }
}

export async function topUpInjectionJobs(
  database: D1Database,
  now: Date,
  config: AppConfig,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT id, name, dose, site, instructions, start_date, end_date, local_time,
              timezone, interval_days, first_side, enabled, version, materialized_through
       FROM injection_plans WHERE enabled = 1`,
    )
    .all<InjectionPlanRow>();

  let count = 0;
  for (const plan of results) {
    count += await materializeInjectionPlan(database, plan, now, config);
  }
  return count;
}

async function materializeMedicationSchedule(
  database: D1Database,
  schedule: MedicationScheduleRow,
  now: Date,
  config: AppConfig,
): Promise<number> {
  const today = dateInTimeZone(now, schedule.timezone);
  const horizon = addLocalDays(today, config.horizonDays);
  const from = laterDate(
    schedule.start_date,
    schedule.materialized_through ? addLocalDays(schedule.materialized_through, 1) : today,
  );
  const through = schedule.end_date ? earlierDate(horizon, schedule.end_date) : horizon;

  if (compareDates(from, through) > 0) {
    const marker = schedule.end_date && compareDates(schedule.end_date, horizon) < 0
      ? schedule.end_date
      : horizon;
    await updateMaterializedThrough(database, schedule.schedule_id, marker, now);
    return 0;
  }

  const { results: times } = await database
    .prepare("SELECT local_time, dose FROM medication_times WHERE schedule_id = ? ORDER BY sort_order, local_time")
    .bind(schedule.schedule_id)
    .all<MedicationTimeRow>();

  const jobs: JobDraft[] = [];
  for (const date of eachLocalDate(from, through)) {
    if (!isMedicationDate(schedule, date)) continue;
    for (const time of times) {
      const scheduledAt = localDateTimeToInstant(date, time.local_time, schedule.timezone);
      jobs.push(createMedicationJob(schedule, time, scheduledAt));
    }
  }

  const inserted = await insertJobs(database, jobs, now);
  await updateMaterializedThrough(database, schedule.schedule_id, through, now);
  return inserted;
}

async function materializeInjectionPlan(
  database: D1Database,
  plan: InjectionPlanRow,
  now: Date,
  config: AppConfig,
): Promise<number> {
  const today = dateInTimeZone(now, plan.timezone);
  const horizon = addLocalDays(today, config.horizonDays);
  const from = laterDate(
    plan.start_date,
    plan.materialized_through ? addLocalDays(plan.materialized_through, 1) : today,
  );
  const through = plan.end_date ? earlierDate(horizon, plan.end_date) : horizon;

  if (compareDates(from, through) > 0) {
    const marker = plan.end_date && compareDates(plan.end_date, horizon) < 0
      ? plan.end_date
      : horizon;
    await updateInjectionMaterializedThrough(database, plan.id, marker, now);
    return 0;
  }

  const { results: records } = await database
    .prepare(
      `SELECT scheduled_date, status, completed_at, actual_side, rescheduled_to
       FROM injection_records WHERE plan_id = ? ORDER BY scheduled_date`,
    )
    .bind(plan.id)
    .all<InjectionRecordRow>();
  const recordsByDate = new Map(records.map((record) => [record.scheduled_date, record]));
  const lastCompleted = records
    .filter((record) => record.status === "completed" && record.actual_side && record.completed_at
      && Date.parse(record.completed_at) <= now.getTime())
    .sort((left, right) => Date.parse(right.completed_at!) - Date.parse(left.completed_at!))[0];
  const nextSide: "left" | "right" = lastCompleted?.actual_side
    ? oppositeSide(lastCompleted.actual_side)
    : plan.first_side;
  const occurrences: Array<{ scheduledDate: string; effectiveDate: string }> = [];
  for (const date of eachLocalDate(from, through)) {
    const elapsedDays = differenceInLocalDays(plan.start_date, date);
    if (elapsedDays < 0 || elapsedDays % plan.interval_days !== 0) continue;
    const record = recordsByDate.get(date);
    if (record?.status === "completed" || record?.status === "skipped") continue;
    occurrences.push({
      scheduledDate: date,
      effectiveDate: record?.status === "rescheduled" && record.rescheduled_to
        ? record.rescheduled_to
        : date,
    });
  }
  for (const record of records) {
    if (record.status !== "rescheduled" || !record.rescheduled_to) continue;
    if (compareDates(record.scheduled_date, from) >= 0) continue;
    if (compareDates(record.rescheduled_to, today) < 0 || compareDates(record.rescheduled_to, horizon) > 0) continue;
    occurrences.push({ scheduledDate: record.scheduled_date, effectiveDate: record.rescheduled_to });
  }
  occurrences.sort((left, right) => compareDates(left.effectiveDate, right.effectiveDate));

  const jobs: JobDraft[] = [];
  for (const [index, occurrence] of occurrences.entries()) {
    const scheduledAt = localDateTimeToInstant(occurrence.effectiveDate, plan.local_time, plan.timezone);
    // Sides alternate across upcoming occurrences once a real completion anchors
    // the sequence; skipped dates are excluded so they do not consume a side.
    const side = lastCompleted && index % 2 === 1 ? oppositeSide(nextSide) : nextSide;
    jobs.push(createInjectionJob(plan, scheduledAt, side));
  }

  const inserted = await insertJobs(database, jobs, now);
  await updateInjectionMaterializedThrough(database, plan.id, through, now);
  return inserted;
}

async function getInjectionPlan(
  database: D1Database,
  injectionId: string,
): Promise<InjectionPlanRow | null> {
  return database
    .prepare(
      `SELECT id, name, dose, site, instructions, start_date, end_date, local_time,
              timezone, interval_days, first_side, enabled, version, materialized_through
       FROM injection_plans WHERE id = ?`,
    )
    .bind(injectionId)
    .first<InjectionPlanRow>();
}

async function getMedicationSchedule(
  database: D1Database,
  medicationId: string,
): Promise<MedicationScheduleRow | null> {
  return database
    .prepare(
      `SELECT s.id AS schedule_id, s.medication_id, m.name, m.dose, m.instructions,
              s.schedule_type, s.timezone, s.start_date, s.end_date,
              s.interval_days, s.weekdays, s.active_days, s.rest_days,
              s.version, s.materialized_through
       FROM medication_schedules s
       JOIN medications m ON m.id = s.medication_id
       WHERE m.id = ? AND m.enabled = 1`,
    )
    .bind(medicationId)
    .first<MedicationScheduleRow>();
}

function createMedicationJob(
  schedule: MedicationScheduleRow,
  time: MedicationTimeRow,
  scheduledAt: Date,
): JobDraft {
  const iso = scheduledAt.toISOString();
  const message = medicationMessage({
    ...schedule,
    dose: time.dose || schedule.dose,
  });
  return {
    id: crypto.randomUUID(),
    sourceType: "medication",
    sourceId: schedule.schedule_id,
    sourceVersion: schedule.version,
    dedupeKey: `medication:${schedule.schedule_id}:${schedule.version}:${iso}`,
    scheduledAt: iso,
    title: message.title,
    body: message.body,
    groupName: message.group,
  };
}

function isMedicationDate(schedule: MedicationScheduleRow, date: string): boolean {
  const elapsedDays = differenceInLocalDays(schedule.start_date, date);
  if (elapsedDays < 0) return false;
  if (schedule.schedule_type === "interval_days") {
    return elapsedDays % schedule.interval_days === 0;
  }
  if (schedule.schedule_type === "weekly") {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return (schedule.weekdays & (1 << weekday)) !== 0;
  }
  if (schedule.schedule_type === "cycle") {
    return elapsedDays % (schedule.active_days + schedule.rest_days) < schedule.active_days;
  }
  return true;
}

function createEventJob(event: EventRow, remindAt: string): JobDraft {
  const scheduledAt = new Date(remindAt).toISOString();
  const message = eventMessage({ type: event.event_type, ...event });
  return {
    id: crypto.randomUUID(),
    sourceType: "event",
    sourceId: event.id,
    sourceVersion: event.version,
    dedupeKey: `event:${event.id}:${event.version}:${scheduledAt}`,
    scheduledAt,
    title: message.title,
    body: message.body,
    groupName: message.group,
  };
}

function oppositeSide(side: "left" | "right"): "left" | "right" {
  return side === "left" ? "right" : "left";
}

function createInjectionJob(
  plan: InjectionPlanRow,
  scheduledAt: Date,
  side: "left" | "right",
): JobDraft {
  const iso = scheduledAt.toISOString();
  const message = injectionMessage(plan, side);
  return {
    id: crypto.randomUUID(),
    sourceType: "injection",
    sourceId: plan.id,
    sourceVersion: plan.version,
    dedupeKey: `injection:${plan.id}:${plan.version}:${iso}`,
    scheduledAt: iso,
    title: message.title,
    body: message.body,
    groupName: message.group,
  };
}

async function insertJobs(database: D1Database, jobs: JobDraft[], now: Date): Promise<number> {
  if (jobs.length === 0) return 0;
  let inserted = 0;
  const timestamp = now.toISOString();
  for (let offset = 0; offset < jobs.length; offset += 75) {
    const chunk = jobs.slice(offset, offset + 75);
    const results = await database.batch(
      chunk.map((job) =>
        database
          .prepare(
            `INSERT INTO notification_jobs (
               id, profile_id, target_id, source_type, source_id, source_version,
               dedupe_key, scheduled_at, title, body, group_name, urgency,
               status, attempts, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'timeSensitive', 'pending', 0, ?, ?)
             ON CONFLICT(dedupe_key) DO NOTHING`,
          )
          .bind(
            job.id,
            DEFAULT_PROFILE_ID,
            DEFAULT_TARGET_ID,
            job.sourceType,
            job.sourceId,
            job.sourceVersion,
            job.dedupeKey,
            job.scheduledAt,
            job.title,
            job.body,
            job.groupName,
            timestamp,
            timestamp,
          ),
      ),
    );
    inserted += results.reduce((total, result) => total + (result.meta.changes || 0), 0);
  }
  return inserted;
}

async function updateMaterializedThrough(
  database: D1Database,
  scheduleId: string,
  through: string,
  now: Date,
): Promise<void> {
  await database
    .prepare("UPDATE medication_schedules SET materialized_through = ?, updated_at = ? WHERE id = ?")
    .bind(through, now.toISOString(), scheduleId)
    .run();
}

async function updateInjectionMaterializedThrough(
  database: D1Database,
  injectionId: string,
  through: string,
  now: Date,
): Promise<void> {
  await database
    .prepare("UPDATE injection_plans SET materialized_through = ?, updated_at = ? WHERE id = ?")
    .bind(through, now.toISOString(), injectionId)
    .run();
}
