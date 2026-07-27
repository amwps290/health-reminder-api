PRAGMA foreign_keys = ON;

ALTER TABLE medication_schedules
ADD COLUMN interval_days INTEGER NOT NULL DEFAULT 1
CHECK (interval_days >= 1 AND interval_days <= 365);

ALTER TABLE medication_schedules
ADD COLUMN weekdays INTEGER NOT NULL DEFAULT 127
CHECK (weekdays >= 1 AND weekdays <= 127);

ALTER TABLE medication_schedules
ADD COLUMN active_days INTEGER NOT NULL DEFAULT 1
CHECK (active_days >= 1 AND active_days <= 365);

ALTER TABLE medication_schedules
ADD COLUMN rest_days INTEGER NOT NULL DEFAULT 0
CHECK (rest_days >= 0 AND rest_days <= 365);

ALTER TABLE medication_times
ADD COLUMN dose TEXT NOT NULL DEFAULT '';
