const LS_KEYS = {
  timer: "focusdesk.timer.v1",
  todos: "focusdesk.todos.v1",
  settings: "focusdesk.settings.v1",
  stats: "focusdesk.stats.v1",
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${pad2(mm)}:${pad2(ss)}`;
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function $(sel) {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
}

function $$(sel) {
  return Array.from(document.querySelectorAll(sel));
}

// -----------------------
// Settings & Theme
// -----------------------

const htmlEl = document.documentElement;
const themeToggleBtn = $("#themeToggleBtn");
const settingsBtn = $("#settingsBtn");
const settingsPanel = $("#settingsPanel");
const colorThemeSelect = $("#colorThemeSelect");
const notifyToggle = $("#notifyToggle");
const soundToggle = $("#soundToggle");
const notifyPermBtn = $("#notifyPermBtn");
const notifyStatus = $("#notifyStatus");

let settings = {
  theme: "dark",
  color: "warm",
  notifications: true,
  sound: true,
};

function loadSettings() {
  const saved = safeJsonParse(localStorage.getItem(LS_KEYS.settings), null);
  if (!saved) return;
  if (saved.theme === "light" || saved.theme === "dark") settings.theme = saved.theme;
  if (typeof saved.color === "string") settings.color = saved.color;
  if (typeof saved.notifications === "boolean") settings.notifications = saved.notifications;
  if (typeof saved.sound === "boolean") settings.sound = saved.sound;
}

function persistSettings() {
  localStorage.setItem(LS_KEYS.settings, JSON.stringify(settings));
}

function applyTheme() {
  htmlEl.dataset.theme = settings.theme;
  htmlEl.dataset.color = settings.color;
  colorThemeSelect.value = settings.color;
  notifyToggle.checked = settings.notifications;
  soundToggle.checked = settings.sound;
}

function toggleTheme() {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  persistSettings();
  applyTheme();
}

function updateNotifyStatus() {
  if (!("Notification" in window)) {
    notifyStatus.textContent = "알림 권한: 이 브라우저는 알림을 지원하지 않습니다";
    notifyPermBtn.disabled = true;
    return;
  }
  const map = {
    granted: "허용됨",
    denied: "거부됨 (브라우저 설정에서 변경)",
    default: "미설정",
  };
  notifyStatus.textContent = `알림 권한: ${map[Notification.permission] ?? Notification.permission}`;
  notifyPermBtn.disabled = Notification.permission === "granted";
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  try {
    await Notification.requestPermission();
  } catch {}
  updateNotifyStatus();
}

function showTimerNotification() {
  if (!settings.notifications) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const title = "타이머 완료!";
  const body = `${timerState.label} 세션이 끝났습니다. 잠시 쉬어가세요.`;

  try {
    const n = new Notification(title, {
      body,
      icon: "data:image/svg+xml," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="%23e63b2e"/><text x="32" y="40" text-anchor="middle" fill="white" font-size="24" font-family="sans-serif">⏱</text></svg>'
      ),
      tag: "focusdesk-timer",
      renotify: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {}
}

function initSettingsEvents() {
  themeToggleBtn.addEventListener("click", toggleTheme);

  settingsBtn.addEventListener("click", () => {
    const open = settingsPanel.classList.toggle("is-hidden");
    settingsBtn.setAttribute("aria-expanded", String(!open));
  });

  colorThemeSelect.addEventListener("change", () => {
    settings.color = colorThemeSelect.value;
    persistSettings();
    applyTheme();
  });

  notifyToggle.addEventListener("change", () => {
    settings.notifications = notifyToggle.checked;
    persistSettings();
    if (settings.notifications) requestNotificationPermission();
  });

  soundToggle.addEventListener("change", () => {
    settings.sound = soundToggle.checked;
    persistSettings();
  });

  notifyPermBtn.addEventListener("click", requestNotificationPermission);

  document.addEventListener("click", (e) => {
    if (settingsPanel.classList.contains("is-hidden")) return;
    if (settingsPanel.contains(e.target) || settingsBtn.contains(e.target)) return;
    settingsPanel.classList.add("is-hidden");
    settingsBtn.setAttribute("aria-expanded", "false");
  });
}

// -----------------------
// Session stats
// -----------------------

let stats = { date: todayKey(), sessions: 0, minutes: 0 };

const sessionCount = $("#sessionCount");
const sessionMinutes = $("#sessionMinutes");

function loadStats() {
  const saved = safeJsonParse(localStorage.getItem(LS_KEYS.stats), null);
  if (!saved) return;
  if (saved.date === todayKey()) {
    stats.sessions = Number(saved.sessions) || 0;
    stats.minutes = Number(saved.minutes) || 0;
  }
}

function persistStats() {
  stats.date = todayKey();
  localStorage.setItem(LS_KEYS.stats, JSON.stringify(stats));
}

function renderStats() {
  if (stats.date !== todayKey()) {
    stats = { date: todayKey(), sessions: 0, minutes: 0 };
    persistStats();
  }
  sessionCount.textContent = String(stats.sessions);
  sessionMinutes.textContent = String(stats.minutes);
}

function recordSessionComplete() {
  const completedMinutes = Math.round(timerState.initialSeconds / 60);
  stats.sessions += 1;
  stats.minutes += completedMinutes;
  persistStats();
  renderStats();
}

// -----------------------
// Timer
// -----------------------

const PRESETS = {
  pomodoro: { label: "Pomodoro", seconds: 25 * 60 },
  short: { label: "Short break", seconds: 5 * 60 },
  long: { label: "Long break", seconds: 15 * 60 },
};

const timeText = $("#timeText");
const timerLabel = $("#timerLabel");
const startPauseBtn = $("#startPauseBtn");
const resetTimerBtn = $("#resetTimerBtn");
const customForm = $("#customForm");
const customMin = $("#customMin");
const customSec = $("#customSec");
const redWedge = $("#redWedge");
const dialTicks = $("#dialTicks");
const dialNumbers = $("#dialNumbers");
const beep = $("#beep");

const DIAL = { cx: 120, cy: 120, r: 108 };

let timerState = {
  mode: "pomodoro",
  label: PRESETS.pomodoro.label,
  initialSeconds: PRESETS.pomodoro.seconds,
  remainingSeconds: PRESETS.pomodoro.seconds,
  isRunning: false,
  endsAt: null,
};

let tickInterval = null;

function loadTimerState() {
  const saved = safeJsonParse(localStorage.getItem(LS_KEYS.timer), null);
  if (!saved) return;

  const initialSeconds = Number(saved.initialSeconds);
  const remainingSeconds = Number(saved.remainingSeconds);
  if (!Number.isFinite(initialSeconds) || initialSeconds <= 0) return;
  if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) return;

  timerState = {
    mode: typeof saved.mode === "string" ? saved.mode : "pomodoro",
    label: typeof saved.label === "string" ? saved.label : PRESETS.pomodoro.label,
    initialSeconds,
    remainingSeconds: clamp(remainingSeconds, 0, initialSeconds),
    isRunning: Boolean(saved.isRunning),
    endsAt: Number.isFinite(Number(saved.endsAt)) ? Number(saved.endsAt) : null,
  };
}

function persistTimerState() {
  localStorage.setItem(LS_KEYS.timer, JSON.stringify(timerState));
}

function setActivePresetBtn(mode) {
  $$(".seg__item").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.preset === mode);
  });
}

function polar(cx, cy, radius, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function wedgePath(cx, cy, radius, degrees) {
  if (degrees <= 0.5) return "";
  const sweep = Math.min(degrees, 359.99);
  const start = polar(cx, cy, radius, -90);
  const end = polar(cx, cy, radius, -90 + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y} Z`;
}

function buildDialFace() {
  const { cx, cy, r } = DIAL;
  dialTicks.innerHTML = "";
  dialNumbers.innerHTML = "";

  for (let min = 0; min < 60; min++) {
    const angle = -90 + (min / 60) * 360;
    const isMajor = min % 5 === 0;
    const outer = isMajor ? r - 2 : r - 5;
    const p1 = polar(cx, cy, r - 10, angle);
    const p2 = polar(cx, cy, outer, angle);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(p1.x));
    line.setAttribute("y1", String(p1.y));
    line.setAttribute("x2", String(p2.x));
    line.setAttribute("y2", String(p2.y));
    line.setAttribute("class", isMajor ? "dial__tick dial__tick--major" : "dial__tick");
    dialTicks.append(line);

    if (isMajor) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const pos = polar(cx, cy, r - 22, angle);
      label.setAttribute("x", String(pos.x));
      label.setAttribute("y", String(pos.y));
      label.setAttribute("class", "dial__num");
      label.textContent = String(min);
      dialNumbers.append(label);
    }
  }
}

function setWedgeProgress(remainingSeconds) {
  const degrees = clamp((remainingSeconds / 60 / 60) * 360, 0, 360);
  redWedge.setAttribute("d", wedgePath(DIAL.cx, DIAL.cy, DIAL.r, degrees));
}

function renderTimer() {
  timeText.textContent = formatMMSS(timerState.remainingSeconds);
  timerLabel.textContent = timerState.label;
  startPauseBtn.textContent = timerState.isRunning ? "일시정지" : "시작";
  setWedgeProgress(timerState.remainingSeconds);
  customForm.classList.toggle("is-hidden", timerState.mode !== "custom");
  setActivePresetBtn(timerState.mode);
}

function stopTick() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function finalizeTimerIfDone() {
  if (timerState.remainingSeconds > 0) return;
  timerState.isRunning = false;
  timerState.endsAt = null;
  stopTick();
  recordSessionComplete();
  showTimerNotification();
  if (settings.sound) {
    try {
      beep.currentTime = 0;
      beep.play().catch(() => {});
    } catch {}
  }
  document.title = "✓ 타이머 완료! — Focus Desk";
}

function recalcRemainingFromEndsAt() {
  if (!timerState.isRunning || !timerState.endsAt) return;
  timerState.remainingSeconds = clamp(
    Math.ceil((timerState.endsAt - Date.now()) / 1000),
    0,
    timerState.initialSeconds
  );
}

function updateDocumentTitle() {
  if (timerState.isRunning) {
    document.title = `${formatMMSS(timerState.remainingSeconds)} — Focus Desk`;
  } else {
    document.title = "Focus Desk — Pomodoro + Todo";
  }
}

function startTimer() {
  if (timerState.remainingSeconds <= 0) {
    timerState.remainingSeconds = timerState.initialSeconds;
  }
  timerState.isRunning = true;
  timerState.endsAt = Date.now() + timerState.remainingSeconds * 1000;
  persistTimerState();
  stopTick();
  tickInterval = setInterval(() => {
    recalcRemainingFromEndsAt();
    finalizeTimerIfDone();
    renderTimer();
    updateDocumentTitle();
    persistTimerState();
  }, 200);
  renderTimer();
  updateDocumentTitle();
}

function pauseTimer() {
  recalcRemainingFromEndsAt();
  timerState.isRunning = false;
  timerState.endsAt = null;
  stopTick();
  persistTimerState();
  renderTimer();
  updateDocumentTitle();
}

function toggleTimer() {
  if (timerState.isRunning) pauseTimer();
  else startTimer();
}

function resetTimer() {
  timerState.isRunning = false;
  timerState.endsAt = null;
  timerState.remainingSeconds = timerState.initialSeconds;
  stopTick();
  persistTimerState();
  renderTimer();
  updateDocumentTitle();
}

function applyPreset(mode) {
  if (mode === "custom") {
    timerState.mode = "custom";
    timerState.label = "Custom";
    timerState.initialSeconds = timerState.initialSeconds || 25 * 60;
    timerState.remainingSeconds = clamp(timerState.remainingSeconds, 0, timerState.initialSeconds);
  } else {
    const p = PRESETS[mode] ?? PRESETS.pomodoro;
    timerState.mode = mode;
    timerState.label = p.label;
    timerState.initialSeconds = p.seconds;
    timerState.remainingSeconds = p.seconds;
  }
  timerState.isRunning = false;
  timerState.endsAt = null;
  stopTick();
  persistTimerState();
  renderTimer();
  updateDocumentTitle();
}

// -----------------------
// Todos
// -----------------------

const todoForm = $("#todoForm");
const todoInput = $("#todoInput");
const todoList = $("#todoList");
const todoCountText = $("#todoCountText");
const clearCompletedBtn = $("#clearCompletedBtn");
const emptyState = $("#emptyState");
const resetAllBtn = $("#resetAllBtn");
const dragHint = $("#dragHint");

let todoFilter = "all";
let editingId = null;
let dragId = null;

/** @type {{id:string, text:string, done:boolean, createdAt:number, order:number}[]} */
let todos = [];

function loadTodos() {
  const saved = safeJsonParse(localStorage.getItem(LS_KEYS.todos), []);
  if (!Array.isArray(saved)) return;
  todos = saved
    .filter((t) => t && typeof t.id === "string")
    .map((t, i) => ({
      id: t.id,
      text: typeof t.text === "string" ? t.text : "",
      done: Boolean(t.done),
      createdAt: Number.isFinite(Number(t.createdAt)) ? Number(t.createdAt) : Date.now(),
      order: Number.isFinite(Number(t.order)) ? Number(t.order) : i,
    }))
    .filter((t) => t.text.trim().length > 0)
    .sort((a, b) => a.order - b.order);
}

function persistTodos() {
  todos.forEach((t, i) => {
    t.order = i;
  });
  localStorage.setItem(LS_KEYS.todos, JSON.stringify(todos));
}

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function getFilteredTodos() {
  const sorted = [...todos].sort((a, b) => a.order - b.order);
  if (todoFilter === "active") return sorted.filter((t) => !t.done);
  if (todoFilter === "done") return sorted.filter((t) => t.done);
  return sorted;
}

function startEditTodo(id, textEl) {
  if (editingId) return;
  editingId = id;
  const t = todos.find((x) => x.id === id);
  if (!t) return;

  const li = textEl.closest(".todo__item");
  li.classList.add("is-editing");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "todo__edit";
  input.value = t.text;
  input.maxLength = 120;

  const finish = (save) => {
    if (save) {
      const trimmed = input.value.trim();
      if (trimmed) {
        t.text = trimmed;
        persistTodos();
      } else {
        removeTodo(id);
        editingId = null;
        return;
      }
    }
    editingId = null;
    renderTodos();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });

  input.addEventListener("blur", () => finish(true));

  textEl.replaceWith(input);
  input.focus();
  input.select();
}

function reorderTodo(draggedId, targetId) {
  if (draggedId === targetId || todoFilter !== "all") return;
  const from = todos.findIndex((t) => t.id === draggedId);
  const to = todos.findIndex((t) => t.id === targetId);
  if (from < 0 || to < 0) return;
  const [item] = todos.splice(from, 1);
  todos.splice(to, 0, item);
  persistTodos();
  renderTodos();
}

function renderTodos() {
  const filtered = getFilteredTodos();
  const canDrag = todoFilter === "all";
  todoList.innerHTML = "";

  filtered.forEach((t) => {
    const li = document.createElement("li");
    li.className = `todo__item${t.done ? " is-done" : ""}`;
    li.dataset.id = t.id;
    if (canDrag) {
      li.draggable = true;
      li.addEventListener("dragstart", (e) => {
        dragId = t.id;
        li.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", t.id);
      });
      li.addEventListener("dragend", () => {
        dragId = null;
        li.classList.remove("is-dragging");
        $$(".todo__item").forEach((el) => el.classList.remove("is-drag-over"));
      });
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragId && dragId !== t.id) li.classList.add("is-drag-over");
      });
      li.addEventListener("dragleave", () => li.classList.remove("is-drag-over"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("is-drag-over");
        const id = e.dataTransfer.getData("text/plain") || dragId;
        if (id) reorderTodo(id, t.id);
      });
    }

    const handle = document.createElement("span");
    handle.className = `todo__handle${canDrag ? "" : " is-disabled"}`;
    handle.textContent = "≡";
    handle.title = canDrag ? "드래그하여 순서 변경" : "전체 보기에서만 정렬 가능";
    if (canDrag) handle.draggable = false;

    const label = document.createElement("label");
    label.className = "check";
    label.title = "완료 토글";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = t.done;
    cb.addEventListener("change", () => toggleTodoDone(t.id));
    const mark = document.createElement("span");
    mark.className = "check__mark";
    label.append(cb, mark);

    const text = document.createElement("div");
    text.className = "todo__text";
    text.textContent = t.text;
    text.title = "더블클릭하여 수정";
    text.addEventListener("dblclick", () => startEditTodo(t.id, text));

    const del = document.createElement("button");
    del.className = "iconBtn";
    del.type = "button";
    del.title = "삭제";
    del.textContent = "삭제";
    del.addEventListener("click", () => removeTodo(t.id));

    li.append(handle, label, text, del);
    todoList.append(li);
  });

  const total = todos.length;
  const doneCount = todos.filter((t) => t.done).length;
  const activeCount = total - doneCount;
  todoCountText.textContent = `${total}개 · 진행 ${activeCount} · 완료 ${doneCount}`;
  emptyState.classList.toggle("is-hidden", total !== 0);
  dragHint.classList.toggle("is-disabled", !canDrag);
}

function addTodo(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const minOrder = todos.length ? Math.min(...todos.map((t) => t.order)) - 1 : 0;
  todos.unshift({ id: uuid(), text: trimmed, done: false, createdAt: Date.now(), order: minOrder });
  persistTodos();
  renderTodos();
}

function toggleTodoDone(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  persistTodos();
  renderTodos();
}

function removeTodo(id) {
  todos = todos.filter((x) => x.id !== id);
  persistTodos();
  renderTodos();
}

function clearCompleted() {
  const before = todos.length;
  todos = todos.filter((t) => !t.done);
  if (todos.length === before) return;
  persistTodos();
  renderTodos();
}

function setFilter(f) {
  todoFilter = f;
  $$(".chip").forEach((b) => b.classList.toggle("is-active", b.dataset.filter === f));
  renderTodos();
}

function resetAll() {
  if (!confirm("타이머, 할 일, 통계, 설정을 모두 초기화할까요?")) return;

  timerState = {
    mode: "pomodoro",
    label: PRESETS.pomodoro.label,
    initialSeconds: PRESETS.pomodoro.seconds,
    remainingSeconds: PRESETS.pomodoro.seconds,
    isRunning: false,
    endsAt: null,
  };
  stopTick();
  todos = [];
  todoFilter = "all";
  stats = { date: todayKey(), sessions: 0, minutes: 0 };

  settings = { theme: "dark", color: "warm", notifications: true, sound: true };

  localStorage.removeItem(LS_KEYS.timer);
  localStorage.removeItem(LS_KEYS.todos);
  localStorage.removeItem(LS_KEYS.stats);
  localStorage.removeItem(LS_KEYS.settings);

  applyTheme();
  updateNotifyStatus();
  renderTimer();
  renderStats();
  setFilter("all");
  renderTodos();
  updateDocumentTitle();
}

// -----------------------
// Events / Init
// -----------------------

function initTimerEvents() {
  $$(".seg__item").forEach((b) => {
    b.addEventListener("click", () => applyPreset(b.dataset.preset));
  });

  startPauseBtn.addEventListener("click", toggleTimer);
  resetTimerBtn.addEventListener("click", resetTimer);

  customForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const mm = clamp(parseInt(customMin.value || "0", 10) || 0, 0, 999);
    const ss = clamp(parseInt(customSec.value || "0", 10) || 0, 0, 59);
    const total = mm * 60 + ss;
    if (total <= 0) return;

    timerState.mode = "custom";
    timerState.label = "Custom";
    timerState.initialSeconds = total;
    timerState.remainingSeconds = total;
    timerState.isRunning = false;
    timerState.endsAt = null;
    stopTick();
    persistTimerState();
    renderTimer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
    if (e.code === "Space") {
      e.preventDefault();
      toggleTimer();
    }
    if (e.key.toLowerCase() === "r") resetTimer();
  });
}

function initTodoEvents() {
  todoForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addTodo(todoInput.value);
    todoInput.value = "";
    todoInput.focus();
  });

  clearCompletedBtn.addEventListener("click", clearCompleted);
  $$(".chip").forEach((b) => {
    b.addEventListener("click", () => setFilter(b.dataset.filter));
  });
}

function boot() {
  loadSettings();
  loadStats();
  applyTheme();
  updateNotifyStatus();
  initSettingsEvents();

  buildDialFace();
  loadTimerState();
  loadTodos();

  if (timerState.isRunning && timerState.endsAt) {
    recalcRemainingFromEndsAt();
    if (timerState.remainingSeconds <= 0) {
      timerState.remainingSeconds = 0;
      timerState.isRunning = false;
      timerState.endsAt = null;
    } else {
      tickInterval = setInterval(() => {
        recalcRemainingFromEndsAt();
        finalizeTimerIfDone();
        renderTimer();
        updateDocumentTitle();
        persistTimerState();
      }, 200);
    }
  } else {
    timerState.isRunning = false;
    timerState.endsAt = null;
  }

  initTimerEvents();
  initTodoEvents();
  resetAllBtn.addEventListener("click", resetAll);

  renderTimer();
  renderStats();
  setFilter("all");
  renderTodos();
  persistTimerState();
  persistTodos();
  persistSettings();
}

boot();
