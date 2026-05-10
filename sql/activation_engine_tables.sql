CREATE TABLE IF NOT EXISTS student (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  status ENUM('paid_training', 'onboarding', 'step1', 'active', 'inactive', 'blocked', 'at_risk') NOT NULL DEFAULT 'paid_training',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_action_at DATETIME NULL,
  INDEX idx_student_status (status),
  INDEX idx_student_last_action_at (last_action_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_action (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  type ENUM('onboarding', 'step1', 'activation', 'support', 'message') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student_action_student_id (student_id),
  INDEX idx_student_action_type (type),
  INDEX idx_student_action_created_at (created_at),
  CONSTRAINT fk_student_action_student
    FOREIGN KEY (student_id) REFERENCES student(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tracking_event (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  event_type ENUM('click', 'visit', 'conversion') NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'whatsapp',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tracking_event_student_id (student_id),
  INDEX idx_tracking_event_type (event_type),
  INDEX idx_tracking_event_source (source),
  INDEX idx_tracking_event_created_at (created_at),
  CONSTRAINT fk_tracking_event_student
    FOREIGN KEY (student_id) REFERENCES student(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB;
