-- Esquema inicial para revisão. Não aplicar em produção sem revisão técnica.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  tax_id_ciphertext TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Maceio',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  UNIQUE (organization_id, email_normalized)
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT,
  employee_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  cpf_ciphertext TEXT,
  job_title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  hired_on TEXT,
  terminated_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (organization_id, employee_code)
);

CREATE TABLE IF NOT EXISTS work_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  break_start TEXT,
  break_end TEXT,
  end_time TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- A estrutura sugere append-only, mas não implementa ainda as garantias legais de REP-P.
CREATE TABLE IF NOT EXISTS time_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  nsr INTEGER NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('entry', 'break_start', 'break_end', 'exit')),
  recorded_at_utc TEXT NOT NULL,
  timezone TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('online', 'offline')),
  collector_id TEXT,
  record_hash TEXT,
  previous_record_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE (organization_id, nsr)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT,
  occurred_at_utc TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_employees_org_status
  ON employees (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_time_records_employee_time
  ON time_records (employee_id, recorded_at_utc);
CREATE INDEX IF NOT EXISTS idx_time_records_org_nsr
  ON time_records (organization_id, nsr);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_time
  ON audit_events (organization_id, occurred_at_utc);
