const LS_KEYS = {
  timer: "focusdesk.timer.v1",
  todos: "focusdesk.todos.v2",
  ddays: "focusdesk.ddays.v1",
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
// Todos (Schedule Planner v2)
// -----------------------

const CATEGORY_LABELS = { daily: "매일", short: "단기", long: "장기" };
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const todoGreeting = $("#todoGreeting");
const todoProgressFill = $("#todoProgressFill");
const todoProgressText = $("#todoProgressText");
const openTodoModalBtn = $("#openTodoModalBtn");
const openDdayModalBtn = $("#openDdayModalBtn");
const weekStrip = $("#weekStrip");
const todoScheduleList = $("#todoScheduleList");
const emptyState = $("#emptyState");
const resetAllBtn = $("#resetAllBtn");

const todoModal = $("#todoModal");
const todoForm = $("#todoForm");
const todoCategory = $("#todoCategory");
const todoTitle = $("#todoTitle");
const todoDesc = $("#todoDesc");
const todoImportant = $("#todoImportant");
const todoDate = $("#todoDate");
const todoEndDate = $("#todoEndDate");
const todoTimeStart = $("#todoTimeStart");
const todoTimeEnd = $("#todoTimeEnd");

const ddayModal = $("#ddayModal");
const ddayForm = $("#ddayForm");
const ddayList = $("#ddayList");
const ddayTitle = $("#ddayTitle");
const ddayDate = $("#ddayDate");

let todoFilter = "all";
let selectedDate = todayKey();
let editingId = null;
let dragId = null;

/** @type {TodoItem[]} */
let todos = [];

/** @type {{id:string, title:string, targetDate:string, color:string}[]} */
let ddays = [];

function migrateTodo(raw, i) {
  const title = raw.title || raw.text || "";
  return {
    id: raw.id,
    title,
    description: raw.description || "",
    category: ["daily", "short", "long"].includes(raw.category) ? raw.category : "daily",
    important: Boolean(raw.important),
    done: Boolean(raw.done),
    date: raw.date || todayKey(),
    endDate: raw.endDate || "",
    timeStart: raw.timeStart || "09:00",
    timeEnd: raw.timeEnd || "10:00",
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : i,
  };
}

function loadTodos() {
  let saved = safeJsonParse(localStorage.getItem(LS_KEYS.todos), null);
  if (!saved) {
    const legacy = safeJsonParse(localStorage.getItem("focusdesk.todos.v1"), []);
    saved = Array.isArray(legacy) ? legacy : [];
  }
  if (!Array.isArray(saved)) return;
  todos = saved
    .filter((t) => t && typeof t.id === "string")
    .map(migrateTodo)
    .filter((t) => t.title.trim().length > 0)
    .sort((a, b) => a.order - b.order);
}

function loadDdays() {
  const saved = safeJsonParse(localStorage.getItem(LS_KEYS.ddays), []);
  if (!Array.isArray(saved)) return;
  ddays = saved
    .filter((d) => d && typeof d.id === "string" && d.title && d.targetDate)
    .map((d, i) => ({
      id: d.id,
      title: d.title,
      targetDate: d.targetDate,
      color: d.color === "teal" ? "teal" : "blue",
      order: i,
    }));
}

function persistTodos() {
  todos.forEach((t, i) => {
    t.order = i;
  });
  localStorage.setItem(LS_KEYS.todos, JSON.stringify(todos));
}

function persistDdays() {
  localStorage.setItem(LS_KEYS.ddays, JSON.stringify(ddays));
}

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function daysUntil(dateStr) {
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date(todayKey() + "T00:00:00");
  return Math.ceil((target - today) / 86400000);
}

function formatDday(days) {
  if (days < 0) return `D+${Math.abs(days)}`;
  if (days === 0) return "D-Day";
  return `D-${days}`;
}

function isOnSelectedDate(todo) {
  const sel = selectedDate;
  if (todo.category === "long" && todo.endDate) {
    return sel >= todo.date && sel <= todo.endDate;
  }
  if (todo.category === "daily") return true;
  return todo.date === sel;
}

function getFilteredTodos() {
  let list = [...todos].sort((a, b) => a.order - b.order);
  list = list.filter(isOnSelectedDate);

  if (todoFilter === "daily") list = list.filter((t) => t.category === "daily");
  else if (todoFilter === "short") list = list.filter((t) => t.category === "short");
  else if (todoFilter === "long") list = list.filter((t) => t.category === "long");
  else if (todoFilter === "done") list = list.filter((t) => t.done);
  else list = list.filter((t) => !t.done || todoFilter === "all");

  return list.sort((a, b) => {
    if (a.timeStart !== b.timeStart) return a.timeStart.localeCompare(b.timeStart);
    return a.order - b.order;
  });
}

function getTodayTodos() {
  return todos.filter((t) => isOnSelectedDate(t) && (todoFilter === "all" || todoFilter === t.category || (todoFilter === "done" && t.done)));
}

function renderProgress() {
  const todayItems = todos.filter((t) => {
    const d = todayKey();
    if (t.category === "daily") return true;
    if (t.category === "long" && t.endDate) return d >= t.date && d <= t.endDate;
    return t.date === d;
  });
  const done = todayItems.filter((t) => t.done).length;
  const total = todayItems.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  todoProgressFill.style.width = `${pct}%`;
  todoProgressText.textContent = `${done}/${total}`;
  todoGreeting.textContent =
    total === 0
      ? "오늘 스케줄을 추가해보세요"
      : done === total
        ? `오늘 ${total}가지를 모두 완료했어요! 🎉`
        : `오늘 ${done}가지 완료 · ${total - done}가지 남았어요`;
}

function renderWeekStrip() {
  weekStrip.innerHTML = "";
  const base = new Date(selectedDate + "T00:00:00");
  const dayOfWeek = base.getDay();
  const start = new Date(base);
  start.setDate(base.getDate() - dayOfWeek);

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "week-day";
    if (key === todayKey()) btn.classList.add("is-today");
    if (key === selectedDate) btn.classList.add("is-selected");
    btn.innerHTML = `<span class="week-day__num">${d.getDate()}</span><span class="week-day__label">${WEEKDAY_LABELS[d.getDay()]}</span>`;
    btn.addEventListener("click", () => {
      selectedDate = key;
      renderWeekStrip();
      renderTodos();
    });
    weekStrip.append(btn);
  }
}

function renderDdays() {
  ddayList.innerHTML = "";
  const sorted = [...ddays].sort((a, b) => daysUntil(a.targetDate) - daysUntil(b.targetDate));

  sorted.forEach((d) => {
    const days = daysUntil(d.targetDate);
    const card = document.createElement("div");
    card.className = `dday-card dday-card--${d.color}`;
    card.innerHTML = `
      <button class="dday-card__del" type="button" aria-label="삭제">×</button>
      <p class="dday-card__title">${escapeHtml(d.title)}</p>
      <div class="dday-card__days">${formatDday(days)}</div>
    `;
    card.querySelector(".dday-card__del").addEventListener("click", () => {
      ddays = ddays.filter((x) => x.id !== d.id);
      persistDdays();
      renderDdays();
    });
    ddayList.append(card);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function startEditTodo(id, titleEl) {
  if (editingId) return;
  editingId = id;
  const t = todos.find((x) => x.id === id);
  if (!t) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "todo__edit";
  input.value = t.title;
  input.maxLength = 80;

  const finish = (save) => {
    if (save) {
      const trimmed = input.value.trim();
      if (trimmed) {
        t.title = trimmed;
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
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));

  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

function reorderTodo(draggedId, targetId) {
  if (draggedId === targetId) return;
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
  todoScheduleList.innerHTML = "";

  filtered.forEach((t) => {
    const card = document.createElement("article");
    card.className = `schedule-card${t.done ? " is-done" : ""}`;
    card.dataset.id = t.id;
    card.draggable = true;

    card.addEventListener("dragstart", (e) => {
      dragId = t.id;
      card.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.id);
    });
    card.addEventListener("dragend", () => {
      dragId = null;
      card.classList.remove("is-dragging");
      $$(".schedule-card").forEach((el) => el.classList.remove("is-drag-over"));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dragId && dragId !== t.id) card.classList.add("is-drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-drag-over"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("is-drag-over");
      const id = e.dataTransfer.getData("text/plain") || dragId;
      if (id) reorderTodo(id, t.id);
    });

    const head = document.createElement("div");
    head.className = "schedule-card__head";
    head.innerHTML = `
      <span class="schedule-card__time">${t.timeStart} - ${t.timeEnd}</span>
      <div class="schedule-card__actions">
        <span class="schedule-card__handle" title="드래그하여 순서 변경">≡</span>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "schedule-card__body";

    const tags = document.createElement("div");
    tags.className = "schedule-card__tags";
    if (t.important) tags.innerHTML += `<span class="tag tag--important">중요</span>`;
    tags.innerHTML += `<span class="tag tag--cat">${CATEGORY_LABELS[t.category]}</span>`;

    const title = document.createElement("h4");
    title.className = "schedule-card__title";
    title.textContent = t.title;
    title.title = "더블클릭하여 수정";
    title.addEventListener("dblclick", () => startEditTodo(t.id, title));

    body.append(tags, title);
    if (t.description) {
      const desc = document.createElement("p");
      desc.className = "schedule-card__desc";
      desc.textContent = t.description;
      body.append(desc);
    }

    const footer = document.createElement("div");
    footer.className = "schedule-card__footer";

    const completeBtn = document.createElement("button");
    completeBtn.type = "button";
    completeBtn.className = `btn btn--complete${t.done ? " is-done" : ""}`;
    completeBtn.textContent = t.done ? "완료됨" : "완료";
    completeBtn.addEventListener("click", () => toggleTodoDone(t.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn--secondary btn--delete-sm";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => removeTodo(t.id));

    footer.append(completeBtn, delBtn);
    card.append(head, body, footer);
    todoScheduleList.append(card);
  });

  emptyState.classList.toggle("is-hidden", filtered.length !== 0);
  renderProgress();
}

function addTodo(data) {
  const minOrder = todos.length ? Math.min(...todos.map((t) => t.order)) - 1 : 0;
  todos.unshift({
    id: uuid(),
    title: data.title,
    description: data.description,
    category: data.category,
    important: data.important,
    done: false,
    date: data.date,
    endDate: data.endDate,
    timeStart: data.timeStart,
    timeEnd: data.timeEnd,
    createdAt: Date.now(),
    order: minOrder,
  });
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

function setFilter(f) {
  todoFilter = f;
  $$(".chip").forEach((b) => b.classList.toggle("is-active", b.dataset.filter === f));
  renderTodos();
}

function setFormCategory(cat) {
  todoCategory.value = cat;
  $$(".form-seg__item").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.category === cat);
  });
}

function openTodoModal() {
  todoForm.reset();
  todoCategory.value = "daily";
  setFormCategory("daily");
  todoDate.value = selectedDate;
  todoTimeStart.value = "09:00";
  todoTimeEnd.value = "10:00";
  todoModal.classList.remove("is-hidden");
  todoTitle.focus();
}

function closeTodoModal() {
  todoModal.classList.add("is-hidden");
}

function openDdayModalFn() {
  ddayForm.reset();
  ddayDate.value = selectedDate;
  ddayModal.classList.remove("is-hidden");
  ddayTitle.focus();
}

function closeDdayModal() {
  ddayModal.classList.add("is-hidden");
}

function initTodoEvents() {
  openTodoModalBtn.addEventListener("click", openTodoModal);
  openDdayModalBtn.addEventListener("click", openDdayModalFn);

  $$("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeTodoModal);
  });
  $$("[data-close-dday]").forEach((el) => {
    el.addEventListener("click", closeDdayModal);
  });

  $$(".form-seg__item").forEach((b) => {
    b.addEventListener("click", () => setFormCategory(b.dataset.category));
  });

  todoForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = todoTitle.value.trim();
    if (!title) return;

    addTodo({
      title,
      description: todoDesc.value.trim(),
      category: todoCategory.value,
      important: todoImportant.checked,
      date: todoDate.value || selectedDate,
      endDate: todoEndDate.value || "",
      timeStart: todoTimeStart.value || "09:00",
      timeEnd: todoTimeEnd.value || "10:00",
    });
    closeTodoModal();
  });

  ddayForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = ddayTitle.value.trim();
    if (!title) return;
    ddays.push({
      id: uuid(),
      title,
      targetDate: ddayDate.value,
      color: ddays.length % 2 === 0 ? "blue" : "teal",
    });
    persistDdays();
    renderDdays();
    closeDdayModal();
  });

  $$(".chip").forEach((b) => {
    b.addEventListener("click", () => setFilter(b.dataset.filter));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeTodoModal();
      closeDdayModal();
    }
  });
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
  ddays = [];
  todoFilter = "all";
  selectedDate = todayKey();
  stats = { date: todayKey(), sessions: 0, minutes: 0 };

  settings = { theme: "dark", color: "warm", notifications: true, sound: true };

  localStorage.removeItem(LS_KEYS.timer);
  localStorage.removeItem(LS_KEYS.todos);
  localStorage.removeItem(LS_KEYS.ddays);
  localStorage.removeItem(LS_KEYS.stats);
  localStorage.removeItem(LS_KEYS.settings);

  applyTheme();
  updateNotifyStatus();
  renderTimer();
  renderStats();
  renderWeekStrip();
  renderDdays();
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

function boot() {
  loadSettings();
  loadStats();
  applyTheme();
  updateNotifyStatus();
  initSettingsEvents();

  buildDialFace();
  loadTimerState();
  loadTodos();
  loadDdays();

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
  renderWeekStrip();
  renderDdays();
  setFilter("all");
  renderTodos();
  persistTimerState();
  persistTodos();
  persistSettings();
}

boot();
