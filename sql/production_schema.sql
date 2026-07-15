CREATE DATABASE IF NOT EXISTS crm_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE crm_db;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(190) PRIMARY KEY,
  applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'agent') NOT NULL DEFAULT 'agent',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bootstrap_locks (
  `key` VARCHAR(80) PRIMARY KEY,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NULL,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  gender ENUM('male', 'female', 'unknown') NOT NULL DEFAULT 'unknown',
  phone VARCHAR(50) NOT NULL UNIQUE,
  whatsapp_phone_normalized VARCHAR(15) NULL,
  email VARCHAR(255) NULL,
  source VARCHAR(100) NULL,
  status ENUM('new', 'contacted', 'client', 'no_response') NOT NULL DEFAULT 'new',
  score INT NOT NULL DEFAULT 0,
  last_contact_date DATETIME NULL,
  follow_up_date DATETIME NULL,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_opt_in_at DATETIME NULL,
  whatsapp_opt_in_source VARCHAR(80) NULL,
  whatsapp_opt_out_at DATETIME NULL,
  whatsapp_opt_out_source VARCHAR(80) NULL,
  whatsapp_service_window_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_leads_created_at (created_at),
  INDEX idx_leads_status_created_at (status, created_at),
  INDEX idx_leads_score (score),
  INDEX idx_leads_whatsapp_phone (whatsapp_phone_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NULL,
  student_id INT NULL,
  followup_id INT NULL UNIQUE,
  message TEXT NOT NULL,
  type ENUM('initial', 'followup', 'group', 'activation', 'recovery', 'inbound') NOT NULL DEFAULT 'initial',
  direction ENUM('outbound', 'inbound') NOT NULL DEFAULT 'outbound',
  status ENUM('pending', 'received', 'skipped_opt_out', 'accepted', 'sent', 'delivered', 'read', 'failed') NOT NULL DEFAULT 'pending',
  template_name VARCHAR(255) NULL,
  template_language VARCHAR(20) NULL,
  template_parameters_json TEXT NULL,
  meta_message_id VARCHAR(255) NULL,
  delivery_evidence VARCHAR(40) NULL,
  source_phone VARCHAR(15) NULL,
  source VARCHAR(30) NULL,
  inbound_message_type VARCHAR(30) NULL,
  context_message_id VARCHAR(255) NULL,
  webhook_event_id INT NULL,
  meta_status ENUM('accepted', 'sent', 'delivered', 'read', 'failed') NULL,
  meta_error_code VARCHAR(80) NULL,
  meta_error_message TEXT NULL,
  accepted_at DATETIME NULL,
  sent_at DATETIME NULL,
  delivered_at DATETIME NULL,
  read_at DATETIME NULL,
  failed_at DATETIME NULL,
  received_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_messages_meta_message_id (meta_message_id),
  INDEX idx_messages_lead_id (lead_id),
  INDEX idx_messages_student_history (student_id, created_at),
  INDEX idx_messages_status_created_at (status, created_at),
  INDEX idx_messages_webhook_event (webhook_event_id),
  INDEX idx_messages_source_phone (source_phone, received_at),
  CONSTRAINT fk_messages_lead
    FOREIGN KEY (lead_id) REFERENCES leads(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS followups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  scheduled_date DATETIME NOT NULL,
  message TEXT NOT NULL,
  sequence_step INT NOT NULL DEFAULT 0,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('pending', 'processing', 'needs_review', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  processing_started_at DATETIME NULL,
  sent_at DATETIME NULL,
  provider_message_id VARCHAR(255) NULL,
  meta_status ENUM('accepted', 'sent', 'delivered', 'read', 'failed') NULL,
  meta_error_code VARCHAR(80) NULL,
  meta_error_message TEXT NULL,
  accepted_at DATETIME NULL,
  delivered_at DATETIME NULL,
  read_at DATETIME NULL,
  failed_at DATETIME NULL,
  review_reason TEXT NULL,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  review_note TEXT NULL,
  recovery_source VARCHAR(40) NULL,
  delivery_evidence VARCHAR(40) NULL,
  last_error TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_followups_lead_id (lead_id),
  INDEX idx_followups_status_date (status, scheduled_date),
  INDEX idx_followups_cancelled (cancelled),
  INDEX idx_followups_due (status, cancelled, scheduled_date),
  INDEX idx_followups_processing_review (status, processing_started_at),
  INDEX idx_followups_stuck_recovery (status, processing_started_at, updated_at),
  CONSTRAINT fk_followups_lead
    FOREIGN KEY (lead_id) REFERENCES leads(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_followups_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE messages
  ADD CONSTRAINT fk_messages_followup
  FOREIGN KEY (followup_id) REFERENCES followups(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  tag_id INT NOT NULL,
  UNIQUE KEY uq_lead_tag (lead_id, tag_id),
  INDEX idx_lead_tags_lead_id (lead_id),
  INDEX idx_lead_tags_tag_id (tag_id),
  CONSTRAINT fk_lead_tags_lead
    FOREIGN KEY (lead_id) REFERENCES leads(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_lead_tags_tag
    FOREIGN KEY (tag_id) REFERENCES tags(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(120) NOT NULL,
  entity VARCHAR(80) NOT NULL,
  entity_id INT NULL,
  ip VARCHAR(64) NULL,
  meta_json TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user_id (user_id),
  INDEX idx_audit_created_at (created_at),
  INDEX idx_audit_entity (entity),
  INDEX idx_audit_entity_history (entity, entity_id, created_at),
  CONSTRAINT fk_audit_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contact_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  category VARCHAR(100) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_contact_groups_created_by (created_by),
  INDEX idx_contact_groups_created_at (created_at),
  CONSTRAINT fk_contact_groups_user
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  whatsapp_phone_normalized VARCHAR(15) NULL,
  status ENUM('paid_training', 'onboarding', 'step1', 'active', 'inactive', 'blocked', 'at_risk') NOT NULL DEFAULT 'paid_training',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_action_at DATETIME NULL,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_opt_in_at DATETIME NULL,
  whatsapp_opt_in_source VARCHAR(80) NULL,
  whatsapp_opt_out_at DATETIME NULL,
  whatsapp_opt_out_source VARCHAR(80) NULL,
  whatsapp_service_window_expires_at DATETIME NULL,
  INDEX idx_student_status (status),
  INDEX idx_student_last_action_at (last_action_at),
  INDEX idx_student_status_created_at (status, created_at),
  INDEX idx_student_whatsapp_phone (whatsapp_phone_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE messages
  ADD CONSTRAINT fk_messages_student
  FOREIGN KEY (student_id) REFERENCES student(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(255) NOT NULL,
  event_type ENUM('status', 'message', 'mixed', 'unknown') NOT NULL,
  meta_message_id VARCHAR(255) NULL,
  payload_json LONGTEXT NOT NULL,
  state ENUM('received', 'processed', 'partially_processed', 'ignored', 'failed') NOT NULL DEFAULT 'received',
  signature_verified BOOLEAN NOT NULL DEFAULT TRUE,
  statuses_found INT NOT NULL DEFAULT 0,
  processed_count INT NOT NULL DEFAULT 0,
  ignored_count INT NOT NULL DEFAULT 0,
  unmatched_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  processed_status_keys_json TEXT NULL,
  processing_summary_json TEXT NULL,
  messages_found INT NOT NULL DEFAULT 0,
  messages_matched INT NOT NULL DEFAULT 0,
  messages_unmatched INT NOT NULL DEFAULT 0,
  messages_opt_out INT NOT NULL DEFAULT 0,
  messages_ignored INT NOT NULL DEFAULT 0,
  messages_failed INT NOT NULL DEFAULT 0,
  processed_message_keys_json TEXT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  processing_error TEXT NULL,
  UNIQUE KEY uq_whatsapp_webhook_event_key (event_key),
  INDEX idx_whatsapp_webhook_meta_message (meta_message_id),
  INDEX idx_whatsapp_webhook_type_received (event_type, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE messages
  ADD CONSTRAINT fk_messages_webhook_event
  FOREIGN KEY (webhook_event_id) REFERENCES whatsapp_webhook_events(id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS whatsapp_consent_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contact_type ENUM('lead', 'student') NOT NULL,
  contact_id INT NOT NULL,
  action ENUM('opt_in', 'opt_out') NOT NULL,
  source VARCHAR(80) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  normalized_text VARCHAR(255) NULL,
  meta_message_id VARCHAR(255) NULL,
  webhook_event_id INT NULL,
  created_by INT NULL,
  evidence_json TEXT NULL,
  event_at DATETIME NOT NULL,
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_whatsapp_consent_contact_history (contact_type, contact_id, created_at),
  INDEX idx_whatsapp_consent_meta_message (meta_message_id),
  UNIQUE KEY uq_whatsapp_consent_meta_action (meta_message_id, action),
  CONSTRAINT fk_whatsapp_consent_webhook
    FOREIGN KEY (webhook_event_id) REFERENCES whatsapp_webhook_events(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_whatsapp_consent_user
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contact_group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  contact_type ENUM('lead', 'student') NOT NULL,
  contact_id INT NOT NULL,
  problem_reason VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contact_group_member (group_id, contact_type, contact_id),
  INDEX idx_contact_group_members_group_id (group_id),
  INDEX idx_contact_group_members_contact (contact_type, contact_id),
  INDEX idx_group_members_created_at (group_id, created_at),
  CONSTRAINT fk_contact_group_members_group
    FOREIGN KEY (group_id) REFERENCES contact_groups(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  type ENUM('onboarding_issue', 'payment_issue', 'server_activation_issue', 'motivation_issue', 'technical_issue') NOT NULL,
  status ENUM('pending', 'in_progress', 'resolved') NOT NULL DEFAULT 'pending',
  priority ENUM('urgent', 'normal', 'low') NOT NULL DEFAULT 'normal',
  assigned_to INT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  INDEX idx_tasks_student_id (student_id),
  INDEX idx_tasks_type (type),
  INDEX idx_tasks_status (status),
  INDEX idx_tasks_priority (priority),
  INDEX idx_tasks_assigned_to (assigned_to),
  INDEX idx_tasks_open_queue (status, priority, created_at),
  CONSTRAINT fk_tasks_student
    FOREIGN KEY (student_id) REFERENCES student(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_assignee
    FOREIGN KEY (assigned_to) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_action (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  type ENUM('onboarding', 'step1', 'activation', 'support', 'message') NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_action_student_id (student_id),
  INDEX idx_student_action_type (type),
  INDEX idx_student_action_created_at (created_at),
  INDEX idx_student_action_history (student_id, created_at),
  CONSTRAINT fk_student_action_student
    FOREIGN KEY (student_id) REFERENCES student(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tracking_event (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  event_type ENUM('click', 'visit', 'conversion') NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'whatsapp',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tracking_event_student_id (student_id),
  INDEX idx_tracking_event_type (event_type),
  INDEX idx_tracking_event_source (source),
  INDEX idx_tracking_event_created_at (created_at),
  INDEX idx_tracking_student_history (student_id, created_at),
  CONSTRAINT fk_tracking_event_student
    FOREIGN KEY (student_id) REFERENCES student(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
