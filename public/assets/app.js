const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const labels = {
  overview: "Visão geral",
  employees: "Funcionários",
  records: "Registros de ponto",
  reports: "Relatórios",
  settings: "Configurações"
};

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

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

$("#exportDemo").addEventListener("click", () => showToast("Exportação desabilitada: esta tela contém apenas dados ilustrativos."));

function updateClock() {
  const now = new Date();
  $("#clockTime").textContent = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(now);
  $("#clockDate").textContent = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  }).format(now);
  $("#todayLabel").textContent = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", year: "numeric"
  }).format(now);
  $("#dateLong").textContent = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", year: "numeric"
  }).format(now);
}
updateClock();
window.setInterval(updateClock, 1000);

// Diagnóstico opcional. Este endpoint não recebe nem armazena dados de funcionários.
fetch("/api/health", { headers: { Accept: "application/json" } })
  .then(response => response.ok ? response.json() : Promise.reject(new Error("HTTP " + response.status)))
  .then(data => console.info("[Controle de Jornada] API:", data))
  .catch(error => console.info("[Controle de Jornada] API ainda não conectada:", error.message));
