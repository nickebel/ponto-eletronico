const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const API_BASE_URL = (window.APP_CONFIG?.API_BASE_URL || "").replace(/\\/+$/, "");
const SESSION_KEY = "orbe_session_token";

const labels = {
  overview: "Visão geral",
  employees: "Funcionários",
  records: "Registros de ponto",
  reports: "Relatórios",
  settings: "Configurações"
};

async function apiRequest(path, options = {}) {
  if (!API_BASE_URL) throw new Error("A URL da API não está configurada.");
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  const token = sessionStorage.getItem(SESSION_KEY);
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}/api/${path}`, { ...options, headers, cache: "no-store" });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Falha na comunicação (HTTP ${response.status}).`);
  return data;
}

function showAuth(mode, message = "") {
  $("#authGate").hidden = false;
  $("#appShell").hidden = true;
  $("#setupForm").hidden = mode !== "setup";
  $("#loginForm").hidden = mode !== "login";
  $("#authAlert").hidden = !message;
  $("#authAlert").textContent = message;
  if (mode === "setup") {
    $("#authTitle").textContent = "Configure sua empresa";
    $("#authIntro").textContent = "Crie a empresa e a primeira conta administradora. Esta configuração só poderá ser feita uma vez.";
  } else if (mode === "login") {
    $("#authTitle").textContent = "Bem-vindo de volta";
    $("#authIntro").textContent = "Entre com seu e-mail e senha para acessar o ambiente administrativo.";
  } else {
    $("#authTitle").textContent = "Conectando ao sistema";
    $("#authIntro").textContent = "Verificando a API e o banco de dados.";
  }
}

function showApp(user, organization) {
  $("#authGate").hidden = true;
  $("#appShell").hidden = false;
  $("#companyNameDisplay").textContent = organization.name;
  $("#companyCrumb").textContent = organization.name;
  $("#adminNameDisplay").textContent = user.name || user.email;
  $("#adminInitials").textContent = (user.name || user.email).split(/\\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  $("#adminRoleDisplay").textContent = user.role === "admin" ? "Administrador" : user.role;
  $("#welcomeName").textContent = (user.name || "administrador").split(" ")[0];
  updateClock();
}

async function initializeAuth() {
  showAuth("checking");
  if (!API_BASE_URL) {
    showAuth("login", "A URL da API ainda não foi configurada.");
    return;
  }
  try {
    const status = await apiRequest("setup/status");
    if (status.setupRequired) {
      sessionStorage.removeItem(SESSION_KEY);
      showAuth("setup");
      return;
    }
    if (sessionStorage.getItem(SESSION_KEY)) {
      try {
        const session = await apiRequest("auth/me");
        showApp(session.user, session.organization);
        return;
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
    showAuth("login");
  } catch (error) {
    showAuth("login", error.message);
  }
}

$("#setupForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#setupSubmit");
  const password = $("#setupPassword").value;
  if (password !== $("#setupPasswordConfirm").value) {
    showAuth("setup", "As senhas não conferem.");
    return;
  }
  if (password.length < 12) {
    showAuth("setup", "A senha precisa ter pelo menos 12 caracteres.");
    return;
  }
  button.disabled = true;
  button.textContent = "Criando ambiente...";
  try {
    const result = await apiRequest("setup", {
      method: "POST",
      headers: { "X-Bootstrap-Key": $("#bootstrapKey").value },
      body: JSON.stringify({
        companyName: $("#companyName").value,
        adminName: $("#adminName").value,
        email: $("#setupEmail").value,
        password
      })
    });
    sessionStorage.setItem(SESSION_KEY, result.token);
    $("#bootstrapKey").value = "";
    showApp(result.user, result.organization);
  } catch (error) {
    showAuth("setup", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Criar empresa e administrador";
  }
});

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#loginSubmit");
  button.disabled = true;
  button.textContent = "Entrando...";
  try {
    const result = await apiRequest("auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#loginEmail").value, password: $("#loginPassword").value })
    });
    sessionStorage.setItem(SESSION_KEY, result.token);
    $("#loginPassword").value = "";
    showApp(result.user, result.organization);
  } catch (error) {
    showAuth("login", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Entrar no sistema";
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  try { await apiRequest("auth/logout", { method: "POST" }); } catch {}
  sessionStorage.removeItem(SESSION_KEY);
  showAuth("login", "Você saiu do sistema.");
});

function navigate(view) {
  if (!labels[view]) return;
  $$(".view").forEach(section => section.classList.toggle("active", section.id === "view-" + view));
  $$(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $("#breadcrumbCurrent").textContent = labels[view];
  $("#sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".nav-link").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
$$("[data-go]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
$("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

function updateClock() {
  const now = new Date();
  $("#clockTime").textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  $("#clockDate").textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(now);
  $("#todayLabel").textContent = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(now);
  $("#dateLong").textContent = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(now);
}
window.setInterval(() => { if (!$("#appShell").hidden) updateClock(); }, 1000);
initializeAuth();
