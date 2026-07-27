PRAGMA foreign_keys = ON;

CREATE TABLE injection_records (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES injection_plans(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'skipped', 'rescheduled')),
  completed_at TEXT,
  actual_side TEXT CHECK (actual_side IN ('left', 'right')),
  rescheduled_to TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, scheduled_date),
  CHECK (status != 'completed' OR (completed_at IS NOT NULL AND actual_side IS NOT NULL)),
  CHECK (status != 'rescheduled' OR rescheduled_to IS NOT NULL)
);

CREATE INDEX idx_injection_records_plan_date
ON injection_records(plan_id, scheduled_date DESC);
