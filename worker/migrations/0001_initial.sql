PRAGMA foreign_keys = ON;

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_targets (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE medications (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE medication_schedules (
  id TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL UNIQUE REFERENCES medications(id) ON DELETE CASCADE,
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  start_date TEXT NOT NULL,
  end_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  materialized_through TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE medication_times (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES medication_schedules(id) ON DELETE CASCADE,
  local_time TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (schedule_id, local_time)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  event_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE event_reminders (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  remind_at TEXT NOT NULL,
  UNIQUE (event_id, remind_at)
);

CREATE TABLE medical_notes (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'archived')),
  answer TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_jobs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES notification_targets(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  scheduled_at TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  group_name TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'timeSensitive',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'sent', 'failed', 'canceled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  claim_token TEXT,
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  http_status INTEGER,
  provider_code INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE scheduler_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  materialized_count INTEGER NOT NULL DEFAULT 0,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  error_code TEXT
);

CREATE INDEX idx_medications_profile ON medications(profile_id, enabled);
CREATE INDEX idx_medication_times_schedule ON medication_times(schedule_id, local_time);
CREATE INDEX idx_events_profile_time ON events(profile_id, event_at);
CREATE INDEX idx_event_reminders_event ON event_reminders(event_id, remind_at);
CREATE INDEX idx_notes_profile_time ON medical_notes(profile_id, recorded_at DESC);
CREATE INDEX idx_questions_profile_status ON questions(profile_id, status, sort_order);
CREATE INDEX idx_jobs_due ON notification_jobs(status, scheduled_at, next_attempt_at);
CREATE INDEX idx_jobs_source ON notification_jobs(source_type, source_id, source_version);
CREATE INDEX idx_deliveries_job_time ON notification_deliveries(job_id, attempted_at DESC);
CREATE INDEX idx_scheduler_runs_started ON scheduler_runs(started_at DESC);

INSERT INTO profiles (id, display_name, timezone, created_at, updated_at)
VALUES ('default', '家人', 'Asia/Shanghai', datetime('now'), datetime('now'));

INSERT INTO notification_targets (id, profile_id, channel_type, label, enabled, created_at, updated_at)
VALUES ('default-bark', 'default', 'bark', 'iPhone Bark', 1, datetime('now'), datetime('now'));
