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
  timezone: string;
  start_date: string;
  end_date: string | null;
  version: number;
  materialized_through: string | null;
}

interface MedicationTimeRow {
  local_time: string;
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
              s.timezone, s.start_date, s.end_date, s.version, s.materialized_through
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
  return plan.enabled === 1 ? materializeInjectionPlan(database, plan, now, config) : 0;
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
    .prepare("SELECT local_time FROM medication_times WHERE schedule_id = ? ORDER BY sort_order, local_time")
    .bind(schedule.schedule_id)
    .all<MedicationTimeRow>();

  const jobs: JobDraft[] = [];
  for (const date of eachLocalDate(from, through)) {
    for (const time of times) {
      const scheduledAt = localDateTimeToInstant(date, time.local_time, schedule.timezone);
      if (scheduledAt.getTime() >= now.getTime()) {
        jobs.push(createMedicationJob(schedule, scheduledAt));
      }
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

  const jobs: JobDraft[] = [];
  for (const date of eachLocalDate(from, through)) {
    const elapsedDays = differenceInLocalDays(plan.start_date, date);
    if (elapsedDays < 0 || elapsedDays % plan.interval_days !== 0) continue;
    const injectionNumber = elapsedDays / plan.interval_days;
    const side = injectionNumber % 2 === 0
      ? plan.first_side
      : plan.first_side === "left" ? "right" : "left";
    const scheduledAt = localDateTimeToInstant(date, plan.local_time, plan.timezone);
    if (scheduledAt.getTime() >= now.getTime()) {
      jobs.push(createInjectionJob(plan, scheduledAt, side));
    }
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
              s.timezone, s.start_date, s.end_date, s.version, s.materialized_through
       FROM medication_schedules s
       JOIN medications m ON m.id = s.medication_id
       WHERE m.id = ? AND m.enabled = 1`,
    )
    .bind(medicationId)
    .first<MedicationScheduleRow>();
}

function createMedicationJob(schedule: MedicationScheduleRow, scheduledAt: Date): JobDraft {
  const iso = scheduledAt.toISOString();
  const message = medicationMessage(schedule);
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
