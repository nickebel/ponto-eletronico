const ALLOWED_ORIGINS = new Set([
  "https://nickebel.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
]);
const ITERATIONS = 100000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const DUMMY_HASH = "pbkdf2-sha256-hmac-pepper-v1$100000$glzadZ3CQvdh0zSDT++29A==$kVhdPnRU/zj3gczSvI49nSIqn5TnUkLO2xcL/EkwgiU=";

function headers(origin) {
  const h = {
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Bootstrap-Key";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function reply(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers(origin), "Content-Type": "application/json; charset=utf-8" }
  });
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function toHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function digest(value) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a.length || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function bodyJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 16000) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16000) throw new Error("REQUEST_TOO_LARGE");
  return JSON.parse(text);
}
async function pepperPassword(password, pepper) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(password)));
}
async function makePasswordHash(password, pepper) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordMaterial = await pepperPassword(password, pepper);
  const material = await crypto.subtle.importKey("raw", passwordMaterial, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, material, 256
  );
  return "pbkdf2-sha256-hmac-pepper-v1$" + ITERATIONS + "$" + toBase64(salt) + "$" + toBase64(new Uint8Array(bits));
}
async function checkPassword(password, stored, pepper) {
  try {
    const [algorithm, rawIterations, saltText, hashText] = stored.split("$");
    const iterations = Number(rawIterations);
    if (algorithm !== "pbkdf2-sha256-hmac-pepper-v1" || iterations !== ITERATIONS) return false;
    const passwordMaterial = await pepperPassword(password, pepper);
    const material = await crypto.subtle.importKey("raw", passwordMaterial, "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: fromBase64(saltText), iterations, hash: "SHA-256" }, material, 256
    ));
    const expected = fromBase64(hashText);
    if (bits.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}
async function createSession(db, userId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await digest(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MS).toISOString();
  await db.prepare(
    "INSERT INTO auth_sessions (id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), userId, tokenHash, now.toISOString(), expiresAt, now.toISOString()).run();
  return { token, expiresAt };
}
async function getSession(request, db) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer ([a-f0-9]{64})$/i);
  if (!match) return null;
  const tokenHash = await digest(match[1]);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT s.id AS session_id, u.id AS user_id, u.full_name, u.email_normalized, u.role,
           u.password_change_required, o.id AS organization_id, o.legal_name, o.timezone,
           e.id AS employee_id, e.employee_code, e.full_name AS employee_name,
           e.job_title AS employee_job_title, e.status AS employee_status
    FROM auth_sessions s
    JOIN users u ON u.id=s.user_id
    JOIN organizations o ON o.id=u.organization_id
    LEFT JOIN employees e ON e.user_id=u.id AND e.organization_id=u.organization_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'
      AND (u.role<>'employee' OR (e.id IS NOT NULL AND e.status='active'))
    LIMIT 1
  `).bind(tokenHash, now).first();
  if (!row) return null;
  await db.prepare("UPDATE auth_sessions SET last_seen_at=? WHERE id=?").bind(now, row.session_id).run();
  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id, name: row.full_name, email: row.email_normalized,
      role: row.role, passwordChangeRequired: Boolean(row.password_change_required)
    },
    employee: row.employee_id ? {
      id: row.employee_id, code: row.employee_code, name: row.employee_name,
      jobTitle: row.employee_job_title, status: row.employee_status
    } : null,
    organization: { id: row.organization_id, name: row.legal_name, timezone: row.timezone || "America/Maceio" }
  };
}
async function handleSetupStatus(db, origin) {
  try {
    const row = await db.prepare("SELECT value FROM app_settings WHERE key=?").bind("setup_complete").first();
    return reply({ setupRequired: !row }, 200, origin);
  } catch (error) {
    console.error("Setup schema is not ready:", error);
    return reply({ error: "O banco ainda precisa receber a migração de autenticação.", code: "SCHEMA_NOT_READY" }, 503, origin);
  }
}
async function handleSetup(request, env, origin) {
  if (!env.BOOTSTRAP_SECRET || env.BOOTSTRAP_SECRET.length < 32) {
    return reply({ error: "A chave BOOTSTRAP_SECRET ainda não foi configurada no Worker." }, 503, origin);
  }
  if (!safeEqual(request.headers.get("X-Bootstrap-Key") || "", env.BOOTSTRAP_SECRET)) {
    return reply({ error: "Chave temporária inválida." }, 403, origin);
  }
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 32) {
    return reply({ error: "O segredo PASSWORD_PEPPER ainda não foi configurado no Worker." }, 503, origin);
  }

  let data;
  try { data = await bodyJson(request); }
  catch (error) {
    return reply({ error: error.message === "REQUEST_TOO_LARGE" ? "Requisição muito grande." : "JSON inválido." }, 400, origin);
  }

  const companyName = String(data.companyName || "").trim();
  const adminName = String(data.adminName || "").trim();
  const email = String(data.email || "").trim().toLowerCase();
  const password = String(data.password || "");

  if (companyName.length < 2 || companyName.length > 120) return reply({ error: "Informe o nome ou razão social da empresa (2 a 120 caracteres)." }, 400, origin);
  if (adminName.length < 2 || adminName.length > 120) return reply({ error: "Informe o nome completo do administrador." }, 400, origin);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Informe um e-mail válido." }, 400, origin);
  if (password.length < 12 || password.length > 128) return reply({ error: "A senha precisa ter entre 12 e 128 caracteres." }, 400, origin);

  let setupStage = "checking_existing_setup";
  try {
    const alreadyDone = await env.DB.prepare("SELECT value FROM app_settings WHERE key=?").bind("setup_complete").first();
    if (alreadyDone) return reply({ error: "A configuração inicial já foi concluída. Entre com seu login." }, 409, origin);

    setupStage = "hashing_admin_password";
    const passwordHash = await makePasswordHash(password, env.PASSWORD_PEPPER);
    const now = new Date().toISOString();
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    // O lote D1 é transacional: a trava, a empresa e o administrador entram juntos.
    setupStage = "saving_company_and_admin";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?)").bind("setup_complete", "1", now),
      env.DB.prepare("INSERT INTO organizations (id,legal_name,timezone,created_at) VALUES (?,?,?,?)").bind(organizationId, companyName, "America/Maceio", now),
      env.DB.prepare("INSERT INTO users (id,organization_id,full_name,email_normalized,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,'admin','active',?,?)")
        .bind(userId, organizationId, adminName, email, passwordHash, now, now)
    ]);

    setupStage = "creating_admin_session";
    const session = await createSession(env.DB, userId);
    return reply({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: userId, name: adminName, email, role: "admin" },
      organization: { id: organizationId, name: companyName }
    }, 201, origin);
  } catch (error) {
    console.error("Initial setup failed:", {
      stage: setupStage,
      message: String(error?.message || error || "unknown error")
    });
    if (String(error).includes("UNIQUE constraint failed")) {
      return reply({ error: "A configuração inicial já foi concluída. Atualize a página e tente entrar." }, 409, origin);
    }
    return reply({
      error: "Não foi possível criar o ambiente. Confira a migração e tente novamente.",
      code: "SETUP_FAILED",
      stage: setupStage
    }, 500, origin);
  }
}

function validDateOnly(value) {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function employeeInput(data) {
  const employeeCode = String(data.employeeCode || "").trim();
  const fullName = String(data.fullName || "").trim();
  const jobTitle = String(data.jobTitle || "").trim();
  const hiredOn = String(data.hiredOn || "").trim() || null;
  const terminatedOn = String(data.terminatedOn || "").trim() || null;
  const status = data.status === "inactive" ? "inactive" : "active";
  if (!employeeCode || employeeCode.length > 30) return { error: "Informe uma matrícula com até 30 caracteres." };
  if (fullName.length < 2 || fullName.length > 120) return { error: "Informe o nome completo (2 a 120 caracteres)." };
  if (jobTitle.length > 120) return { error: "O cargo deve ter até 120 caracteres." };
  if (!validDateOnly(hiredOn) || !validDateOnly(terminatedOn)) return { error: "Informe datas válidas." };
  return { value: { employeeCode, fullName, jobTitle: jobTitle || null, hiredOn, status, terminatedOn: status === "inactive" ? terminatedOn : null } };
}

function canManageEmployees(session) {
  return session && ["admin", "manager"].includes(session.user.role);
}

async function handleEmployees(request, env, origin, session, employeeId = null) {
  if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
  if (!canManageEmployees(session)) return reply({ error: "Você não tem permissão para gerenciar funcionários." }, 403, origin);

  const organizationId = session.organization.id;
  const actorId = session.user.id;

  if (request.method === "GET" && !employeeId) {
    try {
      const status = new URL(request.url).searchParams.get("status") || "active";
      if (!["active", "inactive", "all"].includes(status)) return reply({ error: "Filtro de situação inválido." }, 400, origin);
      const base = "SELECT e.id,e.employee_code,e.full_name,e.job_title,e.status,e.hired_on,e.terminated_on,e.created_at,e.updated_at,CASE WHEN u.id IS NOT NULL AND u.status='active' THEN 1 ELSE 0 END AS has_access FROM employees e LEFT JOIN users u ON u.id=e.user_id AND u.organization_id=e.organization_id";
      const sql = status === "all"
        ? base + " WHERE e.organization_id=? ORDER BY CASE e.status WHEN 'active' THEN 0 ELSE 1 END,e.full_name COLLATE NOCASE"
        : base + " WHERE e.organization_id=? AND e.status=? ORDER BY e.full_name COLLATE NOCASE";
      const rows = status === "all"
        ? await env.DB.prepare(sql).bind(organizationId).all()
        : await env.DB.prepare(sql).bind(organizationId, status).all();
      const org = await env.DB.prepare("SELECT employee_access_code FROM organizations WHERE id=?").bind(organizationId).first();
      return reply({ employees: rows.results || [], employeeAccessCode: org?.employee_access_code || null }, 200, origin);
    } catch (error) {
      console.error("List employees failed:", error);
      return reply({ error: "Não foi possível carregar os funcionários." }, 500, origin);
    }
  }

  if (request.method !== "POST" && request.method !== "PUT") return reply({ error: "Método não permitido." }, 405, origin);
  if ((request.method === "POST" && employeeId) || (request.method === "PUT" && !employeeId)) return reply({ error: "Rota não encontrada." }, 404, origin);

  let data;
  try { data = await bodyJson(request); }
  catch (error) { return reply({ error: error.message === "REQUEST_TOO_LARGE" ? "Requisição muito grande." : "JSON inválido." }, 400, origin); }

  const parsed = employeeInput(data);
  if (parsed.error) return reply({ error: parsed.error }, 400, origin);
  const employee = parsed.value;
  const now = new Date().toISOString();

  try {
    if (request.method === "POST") {
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO employees (id,organization_id,employee_code,full_name,job_title,status,hired_on,terminated_on,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,NULL,?,?)").bind(id, organizationId, employee.employeeCode, employee.fullName, employee.jobTitle, employee.hiredOn, now, now),
        env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), organizationId, actorId, "employee", id, "employee.created", JSON.stringify({ employee_code: employee.employeeCode }), now)
      ]);
      const created = await env.DB.prepare("SELECT id, employee_code, full_name, job_title, status, hired_on, terminated_on, created_at, updated_at FROM employees WHERE id=? AND organization_id=?").bind(id, organizationId).first();
      return reply({ success: true, employee: created }, 201, origin);
    }

    const existing = await env.DB.prepare("SELECT id FROM employees WHERE id=? AND organization_id=?").bind(employeeId, organizationId).first();
    if (!existing) return reply({ error: "Funcionário não encontrado." }, 404, origin);

    await env.DB.batch([
      env.DB.prepare("UPDATE employees SET employee_code=?, full_name=?, job_title=?, status=?, hired_on=?, terminated_on=?, updated_at=? WHERE id=? AND organization_id=?").bind(employee.employeeCode, employee.fullName, employee.jobTitle, employee.status, employee.hiredOn, employee.terminatedOn, now, employeeId, organizationId),
      env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), organizationId, actorId, "employee", employeeId, employee.status === "inactive" ? "employee.deactivated_or_updated" : "employee.updated", JSON.stringify({ employee_code: employee.employeeCode, status: employee.status }), now)
    ]);

    const updated = await env.DB.prepare("SELECT id, employee_code, full_name, job_title, status, hired_on, terminated_on, created_at, updated_at FROM employees WHERE id=? AND organization_id=?").bind(employeeId, organizationId).first();
    return reply({ success: true, employee: updated }, 200, origin);
  } catch (error) {
    console.error("Save employee failed:", error);
    if (String(error).includes("UNIQUE constraint failed")) return reply({ error: "Já existe um funcionário com essa matrícula nesta empresa." }, 409, origin);
    return reply({ error: "Não foi possível salvar o funcionário. Verifique os dados e tente novamente." }, 500, origin);
  }
}


function validTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function scheduleInput(data) {
  const employeeId = String(data.employeeId || "").trim();
  const weekday = Number(data.weekday);
  const startTime = String(data.startTime || "");
  const breakStart = String(data.breakStart || "").trim() || null;
  const breakEnd = String(data.breakEnd || "").trim() || null;
  const endTime = String(data.endTime || "");
  const effectiveFrom = String(data.effectiveFrom || "");
  const effectiveUntil = String(data.effectiveUntil || "").trim() || null;

  if (!employeeId) return { error: "Selecione um funcionário." };
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: "Selecione um dia da semana válido." };
  if (!validTime(startTime) || !validTime(endTime) || startTime >= endTime) {
    return { error: "Informe horários válidos. Esta versão não aceita jornadas que atravessam a meia-noite." };
  }
  if ((breakStart && !breakEnd) || (!breakStart && breakEnd)) {
    return { error: "Preencha o início e o fim do intervalo, ou deixe os dois vazios." };
  }
  if (breakStart && (!validTime(breakStart) || !validTime(breakEnd) || breakStart < startTime || breakEnd <= breakStart || breakEnd > endTime)) {
    return { error: "O intervalo deve estar dentro da jornada e ter início anterior ao fim." };
  }
  if (!validDateOnly(effectiveFrom) || !effectiveFrom) return { error: "Informe uma data inicial válida para a vigência." };
  if (!validDateOnly(effectiveUntil) || (effectiveUntil && effectiveUntil < effectiveFrom)) {
    return { error: "A data final da vigência deve ser igual ou posterior à data inicial." };
  }

  return { value: { employeeId, weekday, startTime, breakStart, breakEnd, endTime, effectiveFrom, effectiveUntil } };
}

async function handleSchedules(request, env, origin, session, scheduleId = null) {
  if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
  if (!canManageEmployees(session)) return reply({ error: "Você não tem permissão para gerenciar jornadas." }, 403, origin);

  const organizationId = session.organization.id;
  const actorId = session.user.id;

  if (request.method === "GET" && !scheduleId) {
    try {
      const employeeId = new URL(request.url).searchParams.get("employeeId");
      const sql = employeeId
        ? "SELECT s.id,s.employee_id,e.employee_code,e.full_name AS employee_name,s.weekday,s.start_time,s.break_start,s.break_end,s.end_time,s.effective_from,s.effective_until,s.created_at FROM work_schedules s JOIN employees e ON e.id=s.employee_id AND e.organization_id=s.organization_id WHERE s.organization_id=? AND s.employee_id=? ORDER BY e.full_name COLLATE NOCASE,s.weekday,s.effective_from DESC"
        : "SELECT s.id,s.employee_id,e.employee_code,e.full_name AS employee_name,s.weekday,s.start_time,s.break_start,s.break_end,s.end_time,s.effective_from,s.effective_until,s.created_at FROM work_schedules s JOIN employees e ON e.id=s.employee_id AND e.organization_id=s.organization_id WHERE s.organization_id=? ORDER BY e.full_name COLLATE NOCASE,s.weekday,s.effective_from DESC";
      const rows = employeeId
        ? await env.DB.prepare(sql).bind(organizationId, employeeId).all()
        : await env.DB.prepare(sql).bind(organizationId).all();
      return reply({ schedules: rows.results || [] }, 200, origin);
    } catch (error) {
      console.error("List schedules failed:", error);
      return reply({ error: "Não foi possível carregar as jornadas." }, 500, origin);
    }
  }

  if (!["POST", "PUT", "DELETE"].includes(request.method)) return reply({ error: "Método não permitido." }, 405, origin);
  if ((request.method === "POST" && scheduleId) || (request.method !== "POST" && !scheduleId)) {
    return reply({ error: "Rota não encontrada." }, 404, origin);
  }

  const existing = scheduleId
    ? await env.DB.prepare("SELECT id,employee_id,weekday,effective_from,effective_until FROM work_schedules WHERE id=? AND organization_id=?").bind(scheduleId, organizationId).first()
    : null;
  if (scheduleId && !existing) return reply({ error: "Jornada não encontrada." }, 404, origin);

  if (request.method === "DELETE") {
    const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), organizationId, actorId, "work_schedule", scheduleId, "schedule.deleted", JSON.stringify({ employee_id: existing.employee_id, weekday: existing.weekday }), now),
        env.DB.prepare("DELETE FROM work_schedules WHERE id=? AND organization_id=?").bind(scheduleId, organizationId)
      ]);
      return reply({ success: true }, 200, origin);
    } catch (error) {
      console.error("Delete schedule failed:", error);
      return reply({ error: "Não foi possível remover a jornada." }, 500, origin);
    }
  }

  let data;
  try { data = await bodyJson(request); }
  catch (error) { return reply({ error: error.message === "REQUEST_TOO_LARGE" ? "Requisição muito grande." : "JSON inválido." }, 400, origin); }

  const parsed = scheduleInput(data);
  if (parsed.error) return reply({ error: parsed.error }, 400, origin);
  const schedule = parsed.value;

  try {
    const employee = await env.DB.prepare(
      "SELECT id FROM employees WHERE id=? AND organization_id=?"
    ).bind(schedule.employeeId, organizationId).first();
    if (!employee) return reply({ error: "O funcionário selecionado não pertence a esta empresa." }, 400, origin);

    const maxDate = schedule.effectiveUntil || "9999-12-31";
    const conflictSql = scheduleId
      ? "SELECT id FROM work_schedules WHERE organization_id=? AND employee_id=? AND weekday=? AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?) AND id<>? LIMIT 1"
      : "SELECT id FROM work_schedules WHERE organization_id=? AND employee_id=? AND weekday=? AND effective_from<=? AND (effective_until IS NULL OR effective_until>=?) LIMIT 1";
    const conflict = scheduleId
      ? await env.DB.prepare(conflictSql).bind(organizationId, schedule.employeeId, schedule.weekday, maxDate, schedule.effectiveFrom, scheduleId).first()
      : await env.DB.prepare(conflictSql).bind(organizationId, schedule.employeeId, schedule.weekday, maxDate, schedule.effectiveFrom).first();
    if (conflict) return reply({ error: "Já existe uma jornada para esse funcionário e dia com período de vigência sobreposto." }, 409, origin);

    const now = new Date().toISOString();
    if (request.method === "POST") {
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO work_schedules (id,organization_id,employee_id,weekday,start_time,break_start,break_end,end_time,effective_from,effective_until,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .bind(id, organizationId, schedule.employeeId, schedule.weekday, schedule.startTime, schedule.breakStart, schedule.breakEnd, schedule.endTime, schedule.effectiveFrom, schedule.effectiveUntil, now),
        env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), organizationId, actorId, "work_schedule", id, "schedule.created", JSON.stringify({ employee_id: schedule.employeeId, weekday: schedule.weekday, start_time: schedule.startTime, end_time: schedule.endTime }), now)
      ]);
      const created = await env.DB.prepare("SELECT s.id,s.employee_id,e.employee_code,e.full_name AS employee_name,s.weekday,s.start_time,s.break_start,s.break_end,s.end_time,s.effective_from,s.effective_until,s.created_at FROM work_schedules s JOIN employees e ON e.id=s.employee_id WHERE s.id=? AND s.organization_id=?").bind(id, organizationId).first();
      return reply({ success: true, schedule: created }, 201, origin);
    }

    await env.DB.batch([
      env.DB.prepare("UPDATE work_schedules SET employee_id=?,weekday=?,start_time=?,break_start=?,break_end=?,end_time=?,effective_from=?,effective_until=? WHERE id=? AND organization_id=?")
        .bind(schedule.employeeId, schedule.weekday, schedule.startTime, schedule.breakStart, schedule.breakEnd, schedule.endTime, schedule.effectiveFrom, schedule.effectiveUntil, scheduleId, organizationId),
      env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), organizationId, actorId, "work_schedule", scheduleId, "schedule.updated", JSON.stringify({ employee_id: schedule.employeeId, weekday: schedule.weekday, start_time: schedule.startTime, end_time: schedule.endTime }), now)
    ]);
    const updated = await env.DB.prepare("SELECT s.id,s.employee_id,e.employee_code,e.full_name AS employee_name,s.weekday,s.start_time,s.break_start,s.break_end,s.end_time,s.effective_from,s.effective_until,s.created_at FROM work_schedules s JOIN employees e ON e.id=s.employee_id WHERE s.id=? AND s.organization_id=?").bind(scheduleId, organizationId).first();
    return reply({ success: true, schedule: updated }, 200, origin);
  } catch (error) {
    console.error("Save schedule failed:", error);
    if (String(error).includes("UNIQUE constraint failed")) return reply({ error: "Já existe uma jornada para esse funcionário e dia com a mesma data inicial." }, 409, origin);
    return reply({ error: "Não foi possível salvar a jornada. Verifique os dados e tente novamente." }, 500, origin);
  }
}


const DEMO_RECORD_LABELS = {
  entry: "Entrada",
  break_start: "Início do intervalo",
  break_end: "Retorno do intervalo",
  exit: "Saída"
};

function dateInTimezone(value, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

function allowedDemoRecordTypes(lastType) {
  if (!lastType || lastType === "exit") return ["entry"];
  if (lastType === "entry" || lastType === "break_end") return ["break_start", "exit"];
  if (lastType === "break_start") return ["break_end"];
  return ["entry"];
}

async function handleDemoRecords(request, env, origin, session) {
  if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
  if (!canManageEmployees(session)) return reply({ error: "Você não tem permissão para registrar marcações de teste." }, 403, origin);

  const organizationId = session.organization.id;
  const actorId = session.user.id;

  try {
    const org = await env.DB.prepare("SELECT timezone FROM organizations WHERE id=?").bind(organizationId).first();
    const timeZone = org?.timezone || "America/Maceio";

    if (request.method === "GET") {
      const employeeId = new URL(request.url).searchParams.get("employeeId");
      const sql = employeeId
        ? "SELECT r.id,r.employee_id,e.employee_code,e.full_name AS employee_name,r.record_type,r.recorded_at_utc,r.timezone,r.created_at FROM demo_time_records r JOIN employees e ON e.id=r.employee_id AND e.organization_id=r.organization_id WHERE r.organization_id=? AND r.employee_id=? ORDER BY r.recorded_at_utc DESC LIMIT 100"
        : "SELECT r.id,r.employee_id,e.employee_code,e.full_name AS employee_name,r.record_type,r.recorded_at_utc,r.timezone,r.created_at FROM demo_time_records r JOIN employees e ON e.id=r.employee_id AND e.organization_id=r.organization_id WHERE r.organization_id=? ORDER BY r.recorded_at_utc DESC LIMIT 100";
      const rows = employeeId
        ? await env.DB.prepare(sql).bind(organizationId, employeeId).all()
        : await env.DB.prepare(sql).bind(organizationId).all();
      return reply({ records: rows.results || [], timezone: timeZone, mode: "demonstration_only" }, 200, origin);
    }

    if (request.method !== "POST") return reply({ error: "Método não permitido." }, 405, origin);

    let data;
    try { data = await bodyJson(request); }
    catch (error) {
      return reply({ error: error.message === "REQUEST_TOO_LARGE" ? "Requisição muito grande." : "JSON inválido." }, 400, origin);
    }

    const employeeId = String(data.employeeId || "").trim();
    const recordType = String(data.recordType || "").trim();
    if (!employeeId) return reply({ error: "Selecione um funcionário." }, 400, origin);
    if (!Object.prototype.hasOwnProperty.call(DEMO_RECORD_LABELS, recordType)) {
      return reply({ error: "Selecione um tipo de marcação válido." }, 400, origin);
    }

    const employee = await env.DB.prepare(
      "SELECT id,employee_code,full_name FROM employees WHERE id=? AND organization_id=? AND status='active'"
    ).bind(employeeId, organizationId).first();
    if (!employee) return reply({ error: "Funcionário ativo não encontrado nesta empresa." }, 404, origin);

    const now = new Date();
    const recordedAt = now.toISOString();
    const today = dateInTimezone(recordedAt, timeZone);
    const recent = await env.DB.prepare(
      "SELECT record_type,recorded_at_utc FROM demo_time_records WHERE organization_id=? AND employee_id=? ORDER BY recorded_at_utc DESC LIMIT 40"
    ).bind(organizationId, employeeId).all();
    const lastToday = (recent.results || []).find(item => dateInTimezone(item.recorded_at_utc, timeZone) === today);
    const allowed = allowedDemoRecordTypes(lastToday?.record_type || null);

    if (!allowed.includes(recordType)) {
      const next = allowed.map(type => DEMO_RECORD_LABELS[type]).join(" ou ");
      return reply({ error: "Marcação fora da sequência. Próxima marcação permitida: " + next + "." }, 409, origin);
    }

    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO demo_time_records (id,organization_id,employee_id,record_type,recorded_at_utc,timezone,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id, organizationId, employeeId, recordType, recordedAt, timeZone, actorId, recordedAt),
      env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), organizationId, actorId, "demo_time_record", id, "demo_time_record.created", JSON.stringify({ employee_id: employeeId, record_type: recordType, demonstration_only: true }), recordedAt)
    ]);

    const created = await env.DB.prepare(
      "SELECT r.id,r.employee_id,e.employee_code,e.full_name AS employee_name,r.record_type,r.recorded_at_utc,r.timezone,r.created_at FROM demo_time_records r JOIN employees e ON e.id=r.employee_id AND e.organization_id=r.organization_id WHERE r.id=? AND r.organization_id=?"
    ).bind(id, organizationId).first();

    return reply({ success: true, record: created, mode: "demonstration_only" }, 201, origin);
  } catch (error) {
    console.error("Demo time record operation failed:", error);
    return reply({ error: "Não foi possível processar a marcação de teste. Verifique se a migração 0004_demo_time_records foi aplicada." }, 500, origin);
  }
}

async function throttleKey(request, email) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return digest(`${ip}|${email}`);
}
async function isBlocked(db, key) {
  const row = await db.prepare("SELECT blocked_until FROM login_attempts WHERE bucket_hash=?").bind(key).first();
  return Boolean(row && Number(row.blocked_until || 0) > Date.now());
}
async function recordFailedLogin(db, key) {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO login_attempts (bucket_hash,window_started_at,attempts,blocked_until) VALUES (?,?,1,NULL)
    ON CONFLICT(bucket_hash) DO UPDATE SET
      attempts=CASE WHEN (? - login_attempts.window_started_at)>=? THEN 1 ELSE login_attempts.attempts+1 END,
      window_started_at=CASE WHEN (? - login_attempts.window_started_at)>=? THEN ? ELSE login_attempts.window_started_at END,
      blocked_until=CASE
        WHEN (? - login_attempts.window_started_at)>=? THEN NULL
        WHEN login_attempts.attempts+1>=? THEN ?
        ELSE login_attempts.blocked_until
      END
  `).bind(key, now, now, LOGIN_WINDOW_MS, now, LOGIN_WINDOW_MS, now, now, LOGIN_WINDOW_MS, MAX_ATTEMPTS, now + LOGIN_WINDOW_MS).run();
}
async function handleLogin(request, env, origin) {
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 32) {
    return reply({ error: "O segredo PASSWORD_PEPPER não está configurado no Worker." }, 503, origin);
  }
  let data;
  try { data = await bodyJson(request); }
  catch (error) { return reply({ error: error.message === "REQUEST_TOO_LARGE" ? "Requisição muito grande." : "JSON inválido." }, 400, origin); }

  const email = String(data.email || "").trim().toLowerCase();
  const password = String(data.password || "");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length > 128) {
    return reply({ error: "E-mail ou senha inválidos." }, 400, origin);
  }

  try {
    const setup = await env.DB.prepare("SELECT value FROM app_settings WHERE key=?").bind("setup_complete").first();
    if (!setup) return reply({ error: "A configuração inicial ainda não foi concluída." }, 409, origin);

    const key = await throttleKey(request, email);
    if (await isBlocked(env.DB, key)) return reply({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, 429, origin);

    const user = await env.DB.prepare(
      "SELECT id,full_name,organization_id,email_normalized,password_hash,role FROM users WHERE email_normalized=? AND status='active' ORDER BY created_at LIMIT 1"
    ).bind(email).first();

    const valid = await checkPassword(password, user?.password_hash || DUMMY_HASH, env.PASSWORD_PEPPER);
    if (!user || !valid) {
      await recordFailedLogin(env.DB, key);
      return reply({ error: "E-mail ou senha incorretos." }, 401, origin);
    }

    await env.DB.prepare("DELETE FROM login_attempts WHERE bucket_hash=?").bind(key).run();
    const session = await createSession(env.DB, user.id);
    const org = await env.DB.prepare("SELECT id,legal_name FROM organizations WHERE id=?").bind(user.organization_id).first();
    return reply({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, name: user.full_name, email: user.email_normalized, role: user.role },
      organization: { id: org.id, name: org.legal_name }
    }, 200, origin);
  } catch (error) {
    console.error("Login failed:", error);
    return reply({ error: "Não foi possível entrar. Confira a migração de autenticação do banco." }, 503, origin);
  }
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const random = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(random, byte => alphabet[byte % alphabet.length]).join("");
}

async function handleEmployeeAccessCreation(request, env, origin, session, employeeId) {
  if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
  if (!canManageEmployees(session)) return reply({ error: "Você não tem permissão para gerenciar acessos." }, 403, origin);
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 32) {
    return reply({ error: "O segredo PASSWORD_PEPPER não está configurado no Worker." }, 503, origin);
  }

  try {
    const employee = await env.DB.prepare(
      "SELECT id,organization_id,user_id,employee_code,full_name,status FROM employees WHERE id=? AND organization_id=?"
    ).bind(employeeId, session.organization.id).first();
    if (!employee) return reply({ error: "Funcionário não encontrado." }, 404, origin);
    if (employee.status !== "active") return reply({ error: "Ative o funcionário antes de criar um acesso." }, 409, origin);

    let existingUser = null;
    if (employee.user_id) {
      existingUser = await env.DB.prepare(
        "SELECT id,role,status FROM users WHERE id=? AND organization_id=?"
      ).bind(employee.user_id, session.organization.id).first();
      if (!existingUser || existingUser.role !== "employee") {
        return reply({ error: "O vínculo atual da conta não permite criar um acesso de funcionário." }, 409, origin);
      }
      if (existingUser.status !== "active") return reply({ error: "A conta está suspensa. Reative-a antes de redefinir a senha." }, 409, origin);
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await makePasswordHash(temporaryPassword, env.PASSWORD_PEPPER);
    const now = new Date().toISOString();
    const userId = existingUser?.id || crypto.randomUUID();
    const action = existingUser ? "employee.access_password_reset" : "employee.access_created";
    const statements = [];

    if (existingUser) {
      statements.push(
        env.DB.prepare("UPDATE users SET password_hash=?,password_change_required=1,updated_at=? WHERE id=? AND organization_id=?")
          .bind(passwordHash, now, userId, session.organization.id),
        env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(userId)
      );
    } else {
      const syntheticEmail = "employee-" + employee.id + "@employee.invalid";
      statements.push(
        env.DB.prepare("INSERT INTO users (id,organization_id,full_name,email_normalized,password_hash,role,status,password_change_required,created_at,updated_at) VALUES (?,?,?,?,?,'employee','active',1,?,?)")
          .bind(userId, session.organization.id, employee.full_name, syntheticEmail, passwordHash, now, now),
        env.DB.prepare("UPDATE employees SET user_id=?,updated_at=? WHERE id=? AND organization_id=? AND user_id IS NULL")
          .bind(userId, now, employee.id, session.organization.id)
      );
    }

    statements.push(
      env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), session.organization.id, session.user.id, "employee", employee.id, action, JSON.stringify({ employee_code: employee.employee_code, user_id: userId }), now)
    );
    await env.DB.batch(statements);

    const linked = await env.DB.prepare(
      "SELECT user_id FROM employees WHERE id=? AND organization_id=?"
    ).bind(employee.id, session.organization.id).first();
    if (linked?.user_id !== userId) return reply({ error: "Não foi possível concluir o vínculo da conta. Atualize o cadastro e tente novamente." }, 409, origin);

    return reply({
      success: true,
      employee: { id: employee.id, employeeCode: employee.employee_code, fullName: employee.full_name },
      temporaryPassword,
      passwordChangeRequired: true,
      reset: Boolean(existingUser)
    }, existingUser ? 200 : 201, origin);
  } catch (error) {
    console.error("Create employee access failed:", error);
    if (String(error).includes("UNIQUE constraint failed")) {
      return reply({ error: "Este funcionário já possui um acesso ou existe um conflito de matrícula." }, 409, origin);
    }
    return reply({ error: "Não foi possível criar o acesso do funcionário." }, 500, origin);
  }
}

async function handleEmployeeLogin(request, env, origin) {
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 32) {
    return reply({ error: "O segredo PASSWORD_PEPPER não está configurado no Worker." }, 503, origin);
  }
  let data;
  try { data = await bodyJson(request); }
  catch (error) {
    return reply({ error: error.message === "REQUEST_TOO_LARGE" ? "Requisição muito grande." : "JSON inválido." }, 400, origin);
  }

  const organizationCode = String(data.organizationCode || "").trim().toUpperCase();
  const employeeCode = String(data.employeeCode || "").trim().toUpperCase();
  const password = String(data.password || "");
  if (!/^[A-Z0-9]{10}$/.test(organizationCode) || !employeeCode || employeeCode.length > 30 || password.length > 128) {
    return reply({ error: "Código da empresa, matrícula ou senha inválidos." }, 400, origin);
  }

  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = await digest(ip + "|employee|" + organizationCode + "|" + employeeCode);
    if (await isBlocked(env.DB, key)) {
      return reply({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, 429, origin);
    }

    const org = await env.DB.prepare(
      "SELECT id,legal_name,timezone FROM organizations WHERE employee_access_code=?"
    ).bind(organizationCode).first();

    const user = org ? await env.DB.prepare(
      "SELECT u.id,u.full_name,u.password_hash,u.password_change_required,e.id AS employee_id,e.employee_code,e.full_name AS employee_name,e.job_title " +
      "FROM employees e JOIN users u ON u.id=e.user_id AND u.organization_id=e.organization_id " +
      "WHERE e.organization_id=? AND upper(e.employee_code)=? AND e.status='active' AND u.role='employee' AND u.status='active' LIMIT 1"
    ).bind(org.id, employeeCode).first() : null;

    const valid = await checkPassword(password, user?.password_hash || DUMMY_HASH, env.PASSWORD_PEPPER);
    if (!org || !user || !valid) {
      await recordFailedLogin(env.DB, key);
      return reply({ error: "Dados de acesso incorretos. Confira o código da empresa, matrícula e senha." }, 401, origin);
    }

    await env.DB.prepare("DELETE FROM login_attempts WHERE bucket_hash=?").bind(key).run();
    const session = await createSession(env.DB, user.id);
    return reply({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      passwordChangeRequired: Boolean(user.password_change_required),
      employee: {
        id: user.employee_id, code: user.employee_code,
        name: user.employee_name, jobTitle: user.job_title
      },
      organization: { id: org.id, name: org.legal_name, timezone: org.timezone || "America/Maceio" }
    }, 200, origin);
  } catch (error) {
    console.error("Employee login failed:", error);
    return reply({ error: "Não foi possível entrar. Tente novamente." }, 503, origin);
  }
}

async function handleEmployeePasswordChange(request, env, origin, session) {
  if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
  if (session.user.role !== "employee" || !session.employee) {
    return reply({ error: "Esta operação é exclusiva da conta do funcionário." }, 403, origin);
  }
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 32) {
    return reply({ error: "O segredo PASSWORD_PEPPER não está configurado no Worker." }, 503, origin);
  }

  let data;
  try { data = await bodyJson(request); }
  catch (error) {
    return reply({ error: error.message === "REQUEST_TOO_LARGE" ? "Requisição muito grande." : "JSON inválido." }, 400, origin);
  }

  const currentPassword = String(data.currentPassword || "");
  const newPassword = String(data.newPassword || "");
  if (newPassword.length < 12 || newPassword.length > 128) {
    return reply({ error: "A nova senha precisa ter entre 12 e 128 caracteres." }, 400, origin);
  }
  if (newPassword === currentPassword) {
    return reply({ error: "Escolha uma senha diferente da senha temporária." }, 400, origin);
  }

  try {
    const user = await env.DB.prepare(
      "SELECT password_hash FROM users WHERE id=? AND organization_id=? AND role='employee' AND status='active'"
    ).bind(session.user.id, session.organization.id).first();
    if (!user || !(await checkPassword(currentPassword, user.password_hash, env.PASSWORD_PEPPER))) {
      return reply({ error: "A senha atual está incorreta." }, 401, origin);
    }

    const now = new Date().toISOString();
    const passwordHash = await makePasswordHash(newPassword, env.PASSWORD_PEPPER);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,password_change_required=0,updated_at=? WHERE id=? AND organization_id=?")
        .bind(passwordHash, now, session.user.id, session.organization.id),
      env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), session.organization.id, session.user.id, "employee", session.employee.id, "employee.password_changed", JSON.stringify({ employee_code: session.employee.code }), now)
    ]);
    return reply({ success: true, passwordChangeRequired: false }, 200, origin);
  } catch (error) {
    console.error("Employee password change failed:", error);
    return reply({ error: "Não foi possível alterar a senha. Tente novamente." }, 500, origin);
  }
}

async function handleEmployeeRecords(request, env, origin, session) {
  if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
  if (session.user.role !== "employee" || !session.employee) {
    return reply({ error: "Esta área é exclusiva do funcionário." }, 403, origin);
  }

  const organizationId = session.organization.id;
  const employeeId = session.employee.id;
  const userId = session.user.id;

  try {
    if (request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id,record_type,recorded_at_utc,timezone,source,created_at FROM employee_time_records " +
        "WHERE organization_id=? AND employee_id=? AND user_id=? ORDER BY recorded_at_utc DESC LIMIT 100"
      ).bind(organizationId, employeeId, userId).all();
      return reply({ records: rows.results || [], timezone: session.organization.timezone }, 200, origin);
    }

    if (request.method !== "POST") return reply({ error: "Método não permitido." }, 405, origin);
    let data;
    try { data = await bodyJson(request); }
    catch (error) {
      return reply({ error: error.message === "REQUEST_TOO_LARGE" ? "Requisição muito grande." : "JSON inválido." }, 400, origin);
    }

    const recordType = String(data.recordType || "").trim();
    const validTypes = ["entry", "break_start", "break_end", "exit"];
    if (!validTypes.includes(recordType)) return reply({ error: "Tipo de marcação inválido." }, 400, origin);

    // Marcações não são bloqueadas por uma sequência predefinida: cada toque válido é registrado.
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO employee_time_records (id,organization_id,employee_id,user_id,record_type,recorded_at_utc,timezone,source,created_at) VALUES (?,?,?,?,?,?,?,'online',?)")
        .bind(id, organizationId, employeeId, userId, recordType, now, session.organization.timezone, now),
      env.DB.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,subject_type,subject_id,action,metadata_json,occurred_at_utc) VALUES (?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), organizationId, userId, "employee_time_record", id, "employee_time_record.created", JSON.stringify({ employee_id: employeeId, record_type: recordType, source: "online" }), now)
    ]);

    const created = await env.DB.prepare(
      "SELECT id,record_type,recorded_at_utc,timezone,source,created_at FROM employee_time_records WHERE id=? AND organization_id=? AND employee_id=? AND user_id=?"
    ).bind(id, organizationId, employeeId, userId).first();
    return reply({ success: true, record: created }, 201, origin);
  } catch (error) {
    console.error("Employee time record failed:", error);
    return reply({ error: "Não foi possível registrar a marcação. Tente novamente." }, 500, origin);
  }
}

async function handleAdminEmployeeRecords(request, env, origin, session) {
  if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
  if (!canManageEmployees(session)) return reply({ error: "Você não tem permissão para consultar as marcações." }, 403, origin);
  if (request.method !== "GET") return reply({ error: "Método não permitido." }, 405, origin);

  try {
    const employeeId = new URL(request.url).searchParams.get("employeeId");
    const base = "SELECT r.id,r.employee_id,r.user_id,r.record_type,r.recorded_at_utc,r.timezone,r.source,e.employee_code,e.full_name AS employee_name " +
      "FROM employee_time_records r JOIN employees e ON e.id=r.employee_id AND e.organization_id=r.organization_id WHERE r.organization_id=?";
    const query = employeeId
      ? base + " AND r.employee_id=? ORDER BY r.recorded_at_utc DESC LIMIT 300"
      : base + " ORDER BY r.recorded_at_utc DESC LIMIT 300";
    const rows = employeeId
      ? await env.DB.prepare(query).bind(session.organization.id, employeeId).all()
      : await env.DB.prepare(query).bind(session.organization.id).all();
    return reply({ records: rows.results || [] }, 200, origin);
  } catch (error) {
    console.error("Admin employee records failed:", error);
    return reply({ error: "Não foi possível carregar as marcações dos funcionários." }, 500, origin);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed" }, 403, null);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
    if (url.pathname === "/api/health" && request.method === "GET") {
      let database = "not_configured";
      if (env.DB) {
        try { await env.DB.prepare("SELECT 1 AS ok").first(); database = "connected"; }
        catch (error) { console.error("D1 health check:", error); database = "error"; }
      }
      return reply({
        application: "ponto-eletronico",
        status: "development_only",
        database,
        message: "API em desenvolvimento. Não habilitada para registro oficial de jornada."
      }, 200, origin);
    }
    if (!env.DB) return reply({ error: "Banco de dados não configurado." }, 503, origin);

    try {
      if (url.pathname === "/api/setup/status" && request.method === "GET") return await handleSetupStatus(env.DB, origin);
      if (url.pathname === "/api/setup" && request.method === "POST") return await handleSetup(request, env, origin);
      if (url.pathname === "/api/auth/login" && request.method === "POST") return await handleLogin(request, env, origin);
      if (url.pathname === "/api/employee/auth/login" && request.method === "POST") return await handleEmployeeLogin(request, env, origin);

      if (url.pathname === "/api/employee/me" && request.method === "GET") {
        const session = await getSession(request, env.DB);
        if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
        if (session.user.role !== "employee" || !session.employee) return reply({ error: "Esta área é exclusiva do funcionário." }, 403, origin);
        return reply({
          employee: session.employee,
          organization: session.organization,
          passwordChangeRequired: session.user.passwordChangeRequired
        }, 200, origin);
      }
      if (url.pathname === "/api/employee/auth/change-password" && request.method === "POST") {
        const session = await getSession(request, env.DB);
        return await handleEmployeePasswordChange(request, env, origin, session);
      }
      if (url.pathname === "/api/employee/records" && ["GET", "POST"].includes(request.method)) {
        const session = await getSession(request, env.DB);
        return await handleEmployeeRecords(request, env, origin, session);
      }
      if (url.pathname === "/api/employee-records" && request.method === "GET") {
        const session = await getSession(request, env.DB);
        return await handleAdminEmployeeRecords(request, env, origin, session);
      }

      const employeeAccessMatch = url.pathname.match(/^\/api\/employees\/([0-9a-f-]{36})\/access$/i);
      if (employeeAccessMatch && request.method === "POST") {
        const session = await getSession(request, env.DB);
        return await handleEmployeeAccessCreation(request, env, origin, session, employeeAccessMatch[1]);
      }

      if (url.pathname === "/api/employees" && ["GET", "POST"].includes(request.method)) {
        const session = await getSession(request, env.DB);
        return await handleEmployees(request, env, origin, session);
      }
      const employeeMatch = url.pathname.match(/^\/api\/employees\/([0-9a-f-]{36})$/i);
      if (employeeMatch && request.method === "PUT") {
        const session = await getSession(request, env.DB);
        return await handleEmployees(request, env, origin, session, employeeMatch[1]);
      }

      if (url.pathname === "/api/schedules" && ["GET", "POST"].includes(request.method)) {
        const session = await getSession(request, env.DB);
        return await handleSchedules(request, env, origin, session);
      }
      const scheduleMatch = url.pathname.match(/^\/api\/schedules\/([0-9a-f-]{36})$/i);
      if (scheduleMatch && ["PUT", "DELETE"].includes(request.method)) {
        const session = await getSession(request, env.DB);
        return await handleSchedules(request, env, origin, session, scheduleMatch[1]);
      }
      if (url.pathname === "/api/demo-records" && ["GET", "POST"].includes(request.method)) {
        const session = await getSession(request, env.DB);
        return await handleDemoRecords(request, env, origin, session);
      }


      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const session = await getSession(request, env.DB);
        if (!session) return reply({ error: "Sessão inválida ou expirada." }, 401, origin);
        return reply({ user: session.user, organization: session.organization }, 200, origin);
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const match = (request.headers.get("Authorization") || "").match(/^Bearer ([a-f0-9]{64})$/i);
        if (match) await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await digest(match[1])).run();
        return reply({ success: true }, 200, origin);
      }
      return reply({ error: "Not found" }, 404, origin);
    } catch (error) {
      console.error("Unhandled API error:", error);
      return reply({ error: "Erro interno da API." }, 500, origin);
    }
  }
};
