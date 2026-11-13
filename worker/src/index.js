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
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
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
           o.id AS organization_id, o.legal_name
    FROM auth_sessions s
    JOIN users u ON u.id=s.user_id
    JOIN organizations o ON o.id=u.organization_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'
    LIMIT 1
  `).bind(tokenHash, now).first();
  if (!row) return null;
  await db.prepare("UPDATE auth_sessions SET last_seen_at=? WHERE id=?").bind(now, row.session_id).run();
  return {
    sessionId: row.session_id,
    user: { id: row.user_id, name: row.full_name, email: row.email_normalized, role: row.role },
    organization: { id: row.organization_id, name: row.legal_name }
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
