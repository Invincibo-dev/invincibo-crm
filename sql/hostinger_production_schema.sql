CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'agent') NOT NULL DEFAULT 'agent',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NULL,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  gender ENUM('male', 'female', 'unknown') NOT NULL DEFAULT 'unknown',
  phone VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NULL,
  source VARCHAR(100) NULL,
  status ENUM('new', 'contacted', 'client', 'no_response') NOT NULL DEFAULT 'new',
  score INT NOT NULL DEFAULT 0,
  last_contact_date DATETIME NULL,
  follow_up_date DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  message TEXT NOT NULL,
  type ENUM('initial', 'followup') NOT NULL DEFAULT 'initial',
  status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_messages_lead_id (lead_id),
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
  status ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
  INDEX idx_followups_lead_id (lead_id),
  INDEX idx_followups_status_date (status, scheduled_date),
  INDEX idx_followups_cancelled (cancelled),
  CONSTRAINT fk_followups_lead
    FOREIGN KEY (lead_id) REFERENCES leads(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  CONSTRAINT fk_contact_groups_user
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  status ENUM('paid_training', 'onboarding', 'step1', 'active', 'inactive', 'blocked', 'at_risk') NOT NULL DEFAULT 'paid_training',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_action_at DATETIME NULL,
  INDEX idx_student_status (status),
  INDEX idx_student_last_action_at (last_action_at)
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
  CONSTRAINT fk_tracking_event_student
    FOREIGN KEY (student_id) REFERENCES student(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
