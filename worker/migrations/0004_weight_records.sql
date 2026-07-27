PRAGMA foreign_keys = ON;

CREATE TABLE weight_records (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  measured_on TEXT NOT NULL,
  weight_kg REAL NOT NULL CHECK (weight_kg >= 20 AND weight_kg <= 350),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, measured_on)
);

CREATE INDEX idx_weight_records_profile_date
ON weight_records(profile_id, measured_on);
