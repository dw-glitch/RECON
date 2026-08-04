(function (root) {
  "use strict";
  const STORAGE_KEY = "recon.task.center.v1";
  const CHANNEL_NAME = "recon-task-center-v1";
  const MAX_HISTORY = 40;
  const APP = "RECON";
  const runtime = `${APP}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let tasks = read().map((task) => task && task.status === "running" && Number(task.updatedAt) < Date.now() - 4 * 60 * 60 * 1000
    ? { ...task, status: "failed", detail: "A aba foi encerrada antes da confirmação do término.", finishedAt: Date.now(), updatedAt: Date.now() }
    : task).filter(Boolean);
  let channel = null;

  function id() { return root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; }
  function read() { try { const data = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(data) ? data : []; } catch (_) { return []; } }
  function persist() { try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, MAX_HISTORY))); } catch (_) { /* o histórico visual nunca bloqueia a tarefa */ } }
  function broadcast() { if (channel) try { channel.postMessage({ runtime, tasks }); } catch (_) { /* sem sincronização */ } }
  function emit() { root.dispatchEvent(new CustomEvent("quality:tasks", { detail: { app: APP, tasks: list() } })); }
  function save() { tasks.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)); tasks = tasks.slice(0, MAX_HISTORY); persist(); render(); broadcast(); emit(); }
  function list() { return tasks.map((task) => ({ ...task })); }
  function find(taskId) { return tasks.find((task) => task.id === taskId); }
  function start(label, detail) {
    const task = { id: id(), runtime, app: APP, label: String(label || "Processando"), detail: String(detail || ""), status: "running", progress: 0, startedAt: Date.now(), updatedAt: Date.now(), finishedAt: 0 };
    tasks.unshift(task); save(); return task.id;
  }
  function update(taskId, progress, detail) { const task = find(taskId); if (!task) return; task.progress = Math.max(0, Math.min(100, Number(progress) || 0)); if (detail !== undefined) task.detail = String(detail || ""); task.updatedAt = Date.now(); save(); }
  function finish(taskId, detail) { const task = find(taskId); if (!task) return; task.status = "completed"; task.progress = 100; if (detail !== undefined) task.detail = String(detail || ""); task.finishedAt = task.updatedAt = Date.now(); save(); }
  function fail(taskId, error) { const task = find(taskId); if (!task) return; task.status = "failed"; task.detail = String(error && error.message || error || "Falha na tarefa"); task.finishedAt = task.updatedAt = Date.now(); save(); }
  function remove(taskId) { tasks = tasks.filter((task) => task.id !== taskId || task.status === "running"); save(); }
  function clearCompleted() { tasks = tasks.filter((task) => task.status === "running"); save(); }
  async function run(label, work, detail) {
    const taskId = start(label, detail);
    await new Promise((resolve) => root.requestAnimationFrame ? root.requestAnimationFrame(() => resolve()) : root.setTimeout(resolve, 0));
    try { const result = await work({ id: taskId, update: (progress, message) => update(taskId, progress, message) }); finish(taskId); return result; }
    catch (error) { fail(taskId, error); throw error; }
  }
  function statusLabel(status) { return status === "running" ? "Em execução" : status === "completed" ? "Concluída" : "Falhou"; }
  function escape(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function relativeTime(timestamp) { if (!timestamp) return ""; const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000)); if (seconds < 60) return "agora"; const minutes = Math.round(seconds / 60); if (minutes < 60) return `há ${minutes} min`; return new Date(timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  function inject() {
    if (document.getElementById("quality-task-button")) return;
    const host = document.querySelector(".runtime-status, .runtime") || document.body;
    const button = document.createElement("button"); button.id = "quality-task-button"; button.className = "task-center-button"; button.type = "button"; button.innerHTML = '<span class="task-center-dot"></span><span>Tarefas</span><b id="quality-task-count">0</b>'; host.prepend(button);
    document.body.insertAdjacentHTML("beforeend", '<div id="quality-task-overlay" class="task-center-overlay" hidden></div><aside id="quality-task-drawer" class="task-center-drawer" aria-hidden="true" inert><header><div><h2>Central de tarefas</h2><span id="quality-task-summary">Nenhuma tarefa</span></div><button id="quality-task-close" type="button" aria-label="Fechar">×</button></header><div id="quality-task-list" class="task-center-list"></div><footer><button id="quality-task-clear" type="button">Limpar concluídas</button></footer></aside>');
    const open = (visible) => { const drawer = document.getElementById("quality-task-drawer"); document.getElementById("quality-task-overlay").hidden = !visible; drawer.inert = !visible; drawer.classList.toggle("open", visible); drawer.setAttribute("aria-hidden", String(!visible)); };
    button.addEventListener("click", () => open(true)); document.getElementById("quality-task-close").addEventListener("click", () => open(false)); document.getElementById("quality-task-overlay").addEventListener("click", () => open(false)); document.getElementById("quality-task-clear").addEventListener("click", clearCompleted);
    document.getElementById("quality-task-list").addEventListener("click", (event) => { const target = event.target.closest("button[data-task-remove]"); if (target) remove(target.dataset.taskRemove); });
    render();
  }
  function render() {
    const listElement = document.getElementById("quality-task-list"); if (!listElement) return;
    const running = tasks.filter((task) => task.status === "running");
    const count = document.getElementById("quality-task-count"); if (count) { count.textContent = String(running.length); count.hidden = !running.length; }
    const summary = document.getElementById("quality-task-summary"); if (summary) summary.textContent = running.length ? `${running.length} em execução` : tasks.length ? `${tasks.length} recente(s)` : "Nenhuma tarefa";
    listElement.innerHTML = tasks.length ? tasks.map((task) => `<article class="task-center-item ${escape(task.status)}"><div class="task-center-item-head"><strong>${escape(task.label)}</strong><span>${escape(statusLabel(task.status))}</span></div><small>${escape(task.app)} · ${escape(relativeTime(task.updatedAt))}</small>${task.detail ? `<p>${escape(task.detail)}</p>` : ""}<div class="task-center-progress"><i style="width:${task.status === "failed" ? 100 : task.progress}%"></i></div>${task.status !== "running" ? `<button type="button" data-task-remove="${escape(task.id)}">Remover</button>` : ""}</article>`).join("") : '<div class="task-center-empty">As tarefas desta máquina aparecerão aqui.</div>';
  }
  try { channel = new BroadcastChannel(CHANNEL_NAME); channel.addEventListener("message", (event) => { if (!event.data || event.data.runtime === runtime || !Array.isArray(event.data.tasks)) return; const merged = new Map([...tasks, ...event.data.tasks].map((task) => [task.id, task])); tasks = [...merged.values()].slice(0, MAX_HISTORY); persist(); render(); }); } catch (_) { channel = null; }
  document.addEventListener("DOMContentLoaded", inject);
  root.QualityTaskCenter = { start, update, finish, fail, run, list, clearCompleted };
})(window);
