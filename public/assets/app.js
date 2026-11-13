const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const API_BASE_URL = (window.APP_CONFIG?.API_BASE_URL || "").replace(/\/+$/, "");
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
  if (!response.ok) {
    const stage = data.stage ? ` (etapa: ${data.stage})` : "";
    throw new Error((data.error || `Falha na comunicação (HTTP ${response.status}).`) + stage);
  }
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
  $("#logoutBtn").hidden = false;
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
  if (view === "employees") loadEmployees();
}
$$(".nav-link").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
$$("[data-go]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.go)));
$("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));


let employeesCache = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function displayDate(value) {
  if (!value) return "—";
  const parts = String(value).split("-");
  return parts.length === 3 ? parts.reverse().join("/") : "—";
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function renderEmployees() {
  const search = ($("#employeeSearch")?.value || "").trim().toLocaleLowerCase("pt-BR");
  const statusFilter = $("#employeeStatusFilter")?.value || "active";
  const activeCount = employeesCache.filter(employee => employee.status === "active").length;
  const inactiveCount = employeesCache.length - activeCount;
  $("#employeeSummary").textContent = activeCount + " ativos · " + inactiveCount + " inativos · " + employeesCache.length + " no total";

  const visible = employeesCache.filter(employee => {
    const matchesStatus = statusFilter === "all" || employee.status === statusFilter;
    const matchesSearch = !search ||
      employee.full_name.toLocaleLowerCase("pt-BR").includes(search) ||
      employee.employee_code.toLocaleLowerCase("pt-BR").includes(search);
    return matchesStatus && matchesSearch;
  });

  const body = $("#employeeRows");
  if (!visible.length) {
    const message = employeesCache.length
      ? "Nenhum funcionário corresponde a esse filtro."
      : "Nenhum funcionário cadastrado ainda.";
    body.innerHTML = '<tr><td colspan="5" class="table-empty">' + message + '</td></tr>';
    return;
  }

  body.innerHTML = visible.map(employee => {
    const active = employee.status === "active";
    return '<tr>' +
      '<td><b>' + escapeHtml(employee.full_name) + '</b><small>' + escapeHtml(employee.job_title || "Cargo não informado") + '</small></td>' +
      '<td>' + escapeHtml(employee.employee_code) + '</td>' +
      '<td>' + displayDate(employee.hired_on) + '</td>' +
      '<td><span class="status ' + (active ? "working" : "pending") + '">' + (active ? "Ativo" : "Inativo") + '</span></td>' +
      '<td><div class="row-actions">' +
      '<button class="mini-action" type="button" data-action="edit" data-id="' + escapeHtml(employee.id) + '">Editar</button>' +
      '<button class="mini-action ' + (active ? "danger-action" : "") + '" type="button" data-action="toggle" data-id="' + escapeHtml(employee.id) + '">' + (active ? "Desativar" : "Reativar") + '</button>' +
      '</div></td></tr>';
  }).join("");
}

async function loadEmployees() {
  const body = $("#employeeRows");
  if (body) body.innerHTML = '<tr><td colspan="5" class="table-empty">Carregando funcionários...</td></tr>';
  try {
    const result = await apiRequest("employees?status=all");
    employeesCache = Array.isArray(result.employees) ? result.employees : [];
    renderEmployees();
  } catch (error) {
    if (body) body.innerHTML = '<tr><td colspan="5" class="table-empty">' + escapeHtml(error.message) + '</td></tr>';
    notify(error.message);
  }
}

function openEmployeeForm(employee = null) {
  const form = $("#employeeForm");
  form.reset();
  form.dataset.employeeId = employee?.id || "";
  $("#employeeFormTitle").textContent = employee ? "Editar funcionário" : "Novo funcionário";
  $("#saveEmployeeBtn").textContent = employee ? "Salvar alterações" : "Salvar funcionário";
  $("#employeeCode").value = employee?.employee_code || "";
  $("#employeeFullName").value = employee?.full_name || "";
  $("#employeeJobTitle").value = employee?.job_title || "";
  $("#employeeHiredOn").value = employee?.hired_on || "";
  $("#employeeStatus").value = employee?.status || "active";
  $("#employeeTerminatedOn").value = employee?.terminated_on || "";
  $("#employeeFormPanel").hidden = false;
  $("#employeeCode").focus();
  $("#employeeFormPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#addEmployeeBtn").addEventListener("click", () => openEmployeeForm());
$("#cancelEmployeeBtn").addEventListener("click", () => {
  $("#employeeFormPanel").hidden = true;
  $("#employeeForm").reset();
});
$("#refreshEmployeesBtn").addEventListener("click", loadEmployees);
$("#employeeSearch").addEventListener("input", renderEmployees);
$("#employeeStatusFilter").addEventListener("change", renderEmployees);

$("#employeeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#saveEmployeeBtn");
  const employeeId = event.currentTarget.dataset.employeeId;
  const payload = {
    employeeCode: $("#employeeCode").value,
    fullName: $("#employeeFullName").value,
    jobTitle: $("#employeeJobTitle").value,
    hiredOn: $("#employeeHiredOn").value || null,
    status: $("#employeeStatus").value,
    terminatedOn: $("#employeeTerminatedOn").value || null
  };
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    await apiRequest(employeeId ? "employees/" + encodeURIComponent(employeeId) : "employees", {
      method: employeeId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    $("#employeeFormPanel").hidden = true;
    $("#employeeForm").reset();
    await loadEmployees();
    notify(employeeId ? "Cadastro atualizado com sucesso." : "Funcionário cadastrado com sucesso.");
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
    button.textContent = employeeId ? "Salvar alterações" : "Salvar funcionário";
  }
});

$("#employeeRows").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const employee = employeesCache.find(item => item.id === button.dataset.id);
  if (!employee) return;
  if (button.dataset.action === "edit") {
    openEmployeeForm(employee);
    return;
  }
  if (button.dataset.action === "toggle") {
    const activating = employee.status === "inactive";
    const actionText = activating ? "reativar" : "desativar";
    if (!window.confirm("Confirma " + actionText + " " + employee.full_name + "?")) return;
    button.disabled = true;
    try {
      await apiRequest("employees/" + encodeURIComponent(employee.id), {
        method: "PUT",
        body: JSON.stringify({
          employeeCode: employee.employee_code,
          fullName: employee.full_name,
          jobTitle: employee.job_title || "",
          hiredOn: employee.hired_on || null,
          status: activating ? "active" : "inactive",
          terminatedOn: activating ? null : (employee.terminated_on || null)
        })
      });
      await loadEmployees();
      notify(activating ? "Funcionário reativado." : "Funcionário desativado.");
    } catch (error) {
      notify(error.message);
      button.disabled = false;
    }
  }
});

function updateClock() {
  const now = new Date();
  $("#clockTime").textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  $("#clockDate").textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(now);
  $("#todayLabel").textContent = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(now);
  $("#dateLong").textContent = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(now);
}
window.setInterval(() => { if (!$("#appShell").hidden) updateClock(); }, 1000);
initializeAuth();
