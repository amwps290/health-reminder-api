PRAGMA foreign_keys = ON;

CREATE TABLE injection_plans (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT,
  local_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  interval_days INTEGER NOT NULL DEFAULT 1 CHECK (interval_days >= 1 AND interval_days <= 365),
  first_side TEXT NOT NULL DEFAULT 'left' CHECK (first_side IN ('left', 'right')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  materialized_through TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_injection_plans_profile ON injection_plans(profile_id, enabled);
