-- Apply once to an existing production database before deploying this release.

CREATE TABLE IF NOT EXISTS bootstrap_locks (
  `key` VARCHAR(80) PRIMARY KEY,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE followups
  MODIFY COLUMN status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  ADD COLUMN attempt_count INT NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN processing_started_at DATETIME NULL AFTER attempt_count,
  ADD COLUMN sent_at DATETIME NULL AFTER processing_started_at,
  ADD COLUMN provider_message_id VARCHAR(255) NULL AFTER sent_at,
  ADD COLUMN last_error TEXT NULL AFTER provider_message_id;

ALTER TABLE messages
  ADD COLUMN followup_id INT NULL AFTER lead_id,
  ADD UNIQUE KEY uq_messages_followup_id (followup_id),
  ADD CONSTRAINT fk_messages_followup
    FOREIGN KEY (followup_id) REFERENCES followups(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE;
