USE crm_db;

ALTER TABLE followups
  ADD COLUMN sequence_step INT NOT NULL DEFAULT 0 AFTER message,
  ADD COLUMN cancelled BOOLEAN NOT NULL DEFAULT FALSE AFTER sequence_step;

CREATE INDEX idx_followups_cancelled ON followups(cancelled);
