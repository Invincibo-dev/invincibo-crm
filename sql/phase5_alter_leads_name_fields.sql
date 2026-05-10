USE crm_db;

ALTER TABLE leads
  MODIFY COLUMN name VARCHAR(255) NULL,
  ADD COLUMN first_name VARCHAR(100) NULL AFTER name,
  ADD COLUMN last_name VARCHAR(100) NULL AFTER first_name,
  ADD COLUMN gender ENUM('male', 'female', 'unknown') NOT NULL DEFAULT 'unknown' AFTER last_name;
