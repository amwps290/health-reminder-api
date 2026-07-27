PRAGMA foreign_keys = ON;

CREATE TABLE pregnancy_settings (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  calibrated_on TEXT NOT NULL,
  gestational_days INTEGER NOT NULL CHECK (gestational_days >= 0 AND gestational_days <= 315),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
