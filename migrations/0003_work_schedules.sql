-- Índices para consulta eficiente e prevenção de duas escalas
-- com a mesma data inicial para o mesmo funcionário e dia.
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_schedules_employee_weekday_from
  ON work_schedules (organization_id, employee_id, weekday, effective_from);

CREATE INDEX IF NOT EXISTS idx_work_schedules_org_employee_weekday_dates
  ON work_schedules (organization_id, employee_id, weekday, effective_from, effective_until);
