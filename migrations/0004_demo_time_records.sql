-- Registros de demonstração separados do livro de marcações destinado a eventual REP-P.
-- Não gera NSR oficial, AFD, AEJ ou comprovante legal.
CREATE TABLE IF NOT EXISTS demo_time_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('entry', 'break_start', 'break_end', 'exit')),
  recorded_at_utc TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_demo_time_records_org_employee_time
  ON demo_time_records (organization_id, employee_id, recorded_at_utc);

CREATE INDEX IF NOT EXISTS idx_demo_time_records_org_time
  ON demo_time_records (organization_id, recorded_at_utc);
