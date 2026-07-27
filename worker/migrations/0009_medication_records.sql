PRAGMA foreign_keys = ON;

CREATE TABLE medication_records (
  id TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES medication_schedules(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES notification_jobs(id) ON DELETE SET NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
  taken_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(schedule_id, scheduled_at),
  CHECK (status != 'taken' OR taken_at IS NOT NULL)
);

CREATE INDEX idx_medication_records_medication_time
ON medication_records(medication_id, scheduled_at DESC);
