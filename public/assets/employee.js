const $ = (selector, root = document) => root.querySelector(selector);
const API_BASE_URL = (window.APP_CONFIG?.API_BASE_URL || "").replace(/\/+$/, "");
const EMPLOYEE_SESSION_KEY = "orbe_employee_session_token";

const recordLabels = {
  entry: "Entrada",
  break_start: "Início do intervalo",
  break_end: "Retorno do intervalo",
  exit: "Saída"
};

let employeeTimezone = "America/Maceio";
let employeeSession = null;
let toastTimer = null;

function showLoginError(message) {
  const alert = $("#employeeLoginAlert");
  alert.textContent = message;
  alert.hidden = !message;
}

function showPasswordError(message) {
  const alert = $("#employeePasswordAlert");
  alert.textContent = message;
  alert.hidden = !message;
}

function notify(message) {
  const toast = $("#employeeToast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

async function employeeApi(path, options = {}) {
  if (!API_BASE_URL) throw new Error("A API ainda não está configurada.");
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  const token = sessionStorage.getItem(EMPLOYEE_SESSION_KEY);
  if (token) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(API_BASE_URL + "/api/" + path, {
    ...options,
    headers,
    cache: "no-store"
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || "Falha na comunicação (HTTP " + response.status + ").");
  return data;
}

function formatRecordDate(isoDate) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full",
      timeStyle: "medium",
      timeZone: employeeTimezone
    }).format(new Date(isoDate));
  } catch {
    return new Date(isoDate).toLocaleString("pt-BR");
  }
}

function showEmployeePortal(employee, organization, passwordChangeRequired = false) {
  employeeSession = { employee, organization };
  employeeTimezone = organization.timezone || "America/Maceio";
  $("#employeePortalAuth").hidden = true;
  $("#employeePortalApp").hidden = false;
  $("#employeePortalName").textContent = employee.name || "Funcionário";
  $("#employeePortalCompany").textContent = organization.name || "PORTAL DO FUNCIONÁRIO";
  $("#employeePortalMeta").textContent = "Matrícula " + employee.code + (employee.jobTitle ? " · " + employee.jobTitle : "");
  $("#employeeForcePassword").hidden = !passwordChangeRequired;
  $("#employeePunchContent").hidden = passwordChangeRequired;
  if (!passwordChangeRequired) loadEmployeeHistory();
}

function resetToLogin(message = "") {
  sessionStorage.removeItem(EMPLOYEE_SESSION_KEY);
  employeeSession = null;
  $("#employeePortalApp").hidden = true;
  $("#employeePortalAuth").hidden = false;
  $("#employeeLoginPassword").value = "";
  showLoginError(message);
}

async function initializeEmployeePortal() {
  const token = sessionStorage.getItem(EMPLOYEE_SESSION_KEY);
  if (!token) return;
  try {
    const result = await employeeApi("employee/me");
    showEmployeePortal(result.employee, result.organization, result.passwordChangeRequired);
  } catch {
    resetToLogin("Sua sessão expirou. Entre novamente.");
  }
}

$("#employeeLoginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#employeeLoginSubmit");
  button.disabled = true;
  button.textContent = "Entrando...";
  showLoginError("");
  try {
    const result = await employeeApi("employee/auth/login", {
      method: "POST",
      body: JSON.stringify({
        organizationCode: $("#employeeOrganizationCode").value,
        employeeCode: $("#employeeLoginCode").value,
        password: $("#employeeLoginPassword").value
      })
    });
    sessionStorage.setItem(EMPLOYEE_SESSION_KEY, result.token);
    $("#employeeLoginPassword").value = "";
    showEmployeePortal(result.employee, result.organization, result.passwordChangeRequired);
  } catch (error) {
    showLoginError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Entrar no meu ponto";
  }
});

$("#employeeChangePasswordForm").addEventListener("submit", async event => {
  event.preventDefault();
  const currentPassword = $("#employeeCurrentPassword").value;
  const newPassword = $("#employeeNewPassword").value;
  const confirmPassword = $("#employeeConfirmPassword").value;
  if (newPassword.length < 12) {
    showPasswordError("A nova senha precisa ter pelo menos 12 caracteres.");
    return;
  }
  if (newPassword !== confirmPassword) {
    showPasswordError("As novas senhas não conferem.");
    return;
  }
  const button = $("#employeeChangePasswordSubmit");
  button.disabled = true;
  button.textContent = "Salvando...";
  showPasswordError("");
  try {
    await employeeApi("employee/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    $("#employeeChangePasswordForm").reset();
    $("#employeeForcePassword").hidden = true;
    $("#employeePunchContent").hidden = false;
    notify("Senha pessoal salva com sucesso.");
    await loadEmployeeHistory();
  } catch (error) {
    showPasswordError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Salvar minha senha";
  }
});

async function loadEmployeeHistory() {
  const list = $("#employeeHistoryList");
  list.innerHTML = '<div class="employee-history-empty">Carregando seu histórico...</div>';
  try {
    const result = await employeeApi("employee/records");
    const records = Array.isArray(result.records) ? result.records : [];
    if (!records.length) {
      list.innerHTML = '<div class="employee-history-empty">Nenhuma marcação realizada ainda.</div>';
      return;
    }
    list.innerHTML = records.map(record =>
      '<article class="employee-history-item">' +
        '<span class="employee-history-icon">' + (record.record_type === "entry" ? "↗" : record.record_type === "exit" ? "↙" : record.record_type === "break_start" ? "Ⅱ" : "▶") + '</span>' +
        '<div><b>' + (recordLabels[record.record_type] || "Marcação") + '</b><small>' + formatRecordDate(record.recorded_at_utc) + '</small></div>' +
        '<span class="employee-history-source">Online</span>' +
      '</article>'
    ).join("");
  } catch (error) {
    list.innerHTML = '<div class="employee-history-empty">' + error.message + '</div>';
  }
}

document.querySelectorAll("[data-record-type]").forEach(button => {
  button.addEventListener("click", async () => {
    const recordType = button.dataset.recordType;
    const originalText = button.querySelector("b").textContent;
    const buttons = [...document.querySelectorAll("[data-record-type]")];
    buttons.forEach(item => { item.disabled = true; });
    button.querySelector("b").textContent = "Registrando...";
    $("#employeePunchFeedback").hidden = true;
    try {
      const result = await employeeApi("employee/records", {
        method: "POST",
        body: JSON.stringify({ recordType })
      });
      const stamp = formatRecordDate(result.record.recorded_at_utc);
      const feedback = $("#employeePunchFeedback");
      feedback.textContent = originalText + " registrada às " + stamp + ".";
      feedback.hidden = false;
      await loadEmployeeHistory();
    } catch (error) {
      notify(error.message);
    } finally {
      button.querySelector("b").textContent = originalText;
      buttons.forEach(item => { item.disabled = false; });
    }
  });
});

$("#employeeRefreshRecordsBtn").addEventListener("click", loadEmployeeHistory);
$("#employeeLogoutBtn").addEventListener("click", async () => {
  try { await employeeApi("auth/logout", { method: "POST" }); } catch {}
  resetToLogin("Você saiu do portal.");
});

initializeEmployeePortal();