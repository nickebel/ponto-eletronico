-- Acesso individual dos funcionários e registro de marcações pelo celular.
-- Esta estrutura é uma etapa de desenvolvimento; ainda não constitui REP-P homologado/conforme.

ALTER TABLE organizations ADD COLUMN employee_access_code TEXT;

UPDATE organizations
SET employee_access_code = upper(substr(hex(randomblob(8)), 1, 10))
WHERE employee_access_code IS NULL OR trim(employee_access_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_employee_access_code
  ON organizations (employee_access_code);

ALTER TABLE users
ADD COLUMN password_change_required INTEGER NOT NULL DEFAULT 0
CHECK (password_change_required IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user_id_unique
  ON employees (user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_time_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (
    record_type IN ('entry', 'break_start', 'break_end', 'exit')
  ),
  recorded_at_utc TEXT NOT NULL,
  timezone TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'offline')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_time_records_org_employee_time
  ON employee_time_records (organization_id, employee_id, recorded_at_utc);

CREATE INDEX IF NOT EXISTS idx_employee_time_records_org_time
  ON employee_time_records (organization_id, recorded_at_utc);
