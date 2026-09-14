import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Check,
  Loader2,
  CalendarDays,
  Target,
  Flame,
  Trophy,
  Pencil,
  X,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Settings2,
  Award,
  Sun,
  Moon,
  Download,
  Upload,
  Bell,
  Tag,
  Lock,
} from 'lucide-react';

// ============================================================================
// Storage keys
// ============================================================================
const STORAGE_KEY_V5 = 'task-streak-tracker-v5';
const STORAGE_KEY_V6 = 'task-streak-tracker-v6';

// ============================================================================
// Theme palettes — same brand accent (copper) and structural language
// (sharp corners, hairline borders) in both modes; light mode uses a cool
// slate surface rather than a warm cream, to stay in the app's existing
// navy family instead of a generic warm palette.
// ============================================================================
const DARK_COLORS = {
  bg: '#0E2438',
  panel: '#0A1B2B',
  line: '#2C5A78',
  lineDim: '#1B3B52',
  text: '#E7EFF5',
  textMuted: '#7695AC',
  copper: '#C98A4B',
  complete: '#5E9C88',
  warn: '#C4776A',
  overlay: 'rgba(0,0,0,0.65)',
  shadow: 'rgba(0,0,0,0.4)',
};

const LIGHT_COLORS = {
  bg: '#EEF3F7',
  panel: '#FFFFFF',
  line: '#C9D6E2',
  lineDim: '#DCE5EC',
  text: '#12283A',
  textMuted: '#5D7690',
  copper: '#B4703A',
  complete: '#3F8A73',
  warn: '#B85C4E',
  overlay: 'rgba(18,40,58,0.45)',
  shadow: 'rgba(18,40,58,0.18)',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_CATEGORIES = ['General', 'Study', 'English', 'Personal', 'Fitness', 'Work'];

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'custom', label: 'Custom' },
  { value: 'once', label: 'One-time' },
];

// ============================================================================
// Date utilities — always built from (year, month, day) components, never
// from `new Date(dateString)`, so results never shift with UTC parsing.
// ============================================================================
function pad(n) {
  return String(n).padStart(2, '0');
}

function dateFromStr(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dateToStr(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayStr() {
  return dateToStr(new Date());
}

function addDays(dateStr, n) {
  const d = dateFromStr(dateStr);
  d.setDate(d.getDate() + n);
  return dateToStr(d);
}

function getWeekday(dateStr) {
  return dateFromStr(dateStr).getDay();
}

// ISO YYYY-MM-DD strings sort correctly as plain strings — used throughout
// instead of re-parsing to Date objects just to compare two dates.
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isFutureDate(dateStr) {
  return cmp(dateStr, todayStr()) > 0;
}

function formatDateLabel(dateStr) {
  const d = dateFromStr(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============================================================================
// Schedule engine
// ============================================================================
function isScheduledOn(task, dateStr) {
  const start = task.startDate || task.createdAt;
  if (!start) return false;
  if (cmp(dateStr, start) < 0) return false;
  if (task.endDate && cmp(dateStr, task.endDate) > 0) return false;

  if (task.frequency === 'once') return dateStr === start;
  if (task.frequency === 'daily') return true;
  if (task.frequency === 'custom') {
    return Array.isArray(task.repeatDays) && task.repeatDays.includes(getWeekday(dateStr));
  }
  return false;
}

function getScheduledDatesThrough(task, throughDateStr) {
  const start = task.startDate || task.createdAt;
  if (!start) return [];
  if (cmp(throughDateStr, start) < 0) return [];

  const effectiveEnd = task.endDate && cmp(task.endDate, throughDateStr) < 0 ? task.endDate : throughDateStr;
  if (cmp(effectiveEnd, start) < 0) return [];

  if (task.frequency === 'once') {
    return cmp(start, effectiveEnd) <= 0 ? [start] : [];
  }

  const dates = [];
  let cursor = start;
  let guard = 0;
  while (cmp(cursor, effectiveEnd) <= 0 && guard < 20000) {
    if (
      task.frequency === 'daily' ||
      (task.frequency === 'custom' && Array.isArray(task.repeatDays) && task.repeatDays.includes(getWeekday(cursor)))
    ) {
      dates.push(cursor);
    }
    cursor = addDays(cursor, 1);
    guard++;
  }
  return dates;
}

function isScheduledToday(task) {
  return isScheduledOn(task, todayStr());
}

function uniqueCompletedDates(task) {
  return [...new Set(task.completedDates || [])].sort();
}

function isCompletedOn(task, dateStr) {
  return (task.completedDates || []).includes(dateStr);
}

// Current streak: consecutive completed scheduled occurrences counting
// backward, with a grace period — if the most recent due occurrence is
// today and simply hasn't been marked yet, that alone doesn't zero the
// streak, since today isn't over. Any other missed due date does.
function calculateCurrentStreak(task) {
  const today = todayStr();
  const scheduled = getScheduledDatesThrough(task, today);
  if (scheduled.length === 0) return 0;

  const completed = new Set(task.completedDates || []);
  let idx = scheduled.length - 1;

  if (scheduled[idx] === today && !completed.has(today)) {
    idx--;
  }

  let streak = 0;
  for (; idx >= 0; idx--) {
    if (completed.has(scheduled[idx])) streak++;
    else break;
  }
  return streak;
}

function calculateBestStreak(task) {
  const today = todayStr();
  const scheduled = getScheduledDatesThrough(task, today);
  if (scheduled.length === 0) return 0;

  const completed = new Set(task.completedDates || []);
  let best = 0;
  let current = 0;
  for (const d of scheduled) {
    if (completed.has(d)) {
      current++;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function calculateCompletionRate(task) {
  const today = todayStr();
  const scheduled = getScheduledDatesThrough(task, today);
  if (scheduled.length === 0) return 0;
  const completed = new Set(task.completedDates || []);
  const done = scheduled.filter((d) => completed.has(d)).length;
  return Math.round((done / scheduled.length) * 100);
}

function completedInRange(task, fromStr, toStr) {
  return uniqueCompletedDates(task).filter((d) => cmp(d, fromStr) >= 0 && cmp(d, toStr) <= 0).length;
}

// ============================================================================
// Migration: v5 (daily/once only, flat storage) -> v6 (full schema)
// ============================================================================
function migrateTaskV5ToV6(oldTask, today) {
  const createdAt = oldTask.createdAt || today;
  return {
    id: oldTask.id != null ? String(oldTask.id) : `${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    text: oldTask.text || oldTask.name || 'Untitled Task',
    frequency: oldTask.frequency === 'once' ? 'once' : 'daily',
    repeatDays: Array.isArray(oldTask.repeatDays) ? oldTask.repeatDays : [],
    startDate: oldTask.startDate || createdAt,
    endDate: oldTask.endDate || '',
    category: oldTask.category || 'General',
    reminderTime: oldTask.reminderTime || '',
    createdAt,
    completedDates: Array.isArray(oldTask.completedDates) ? [...new Set(oldTask.completedDates)].sort() : [],
  };
}

function migrateV5Data(oldData, today) {
  const tasks = Array.isArray(oldData && oldData.tasks) ? oldData.tasks.map((t) => migrateTaskV5ToV6(t, today)) : [];
  return {
    tasks,
    dailyGoal: Number(oldData && oldData.dailyGoal) || 3,
    theme: 'dark',
    categories: [...DEFAULT_CATEGORIES],
    updatedAt: today,
  };
}

function normalizeLoadedTask(task) {
  return {
    ...task,
    text: task.text || task.name || 'Untitled Task',
    frequency: task.frequency || 'daily',
    repeatDays: Array.isArray(task.repeatDays) ? task.repeatDays : [],
    category: task.category || 'General',
    reminderTime: task.reminderTime || '',
    endDate: task.endDate || '',
    completedDates: [...new Set(task.completedDates || [])].sort(),
  };
}

// ============================================================================
// Calendar month grid
// ============================================================================
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getMonthCells(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let day = 1; day <= total; day++) cells.push(new Date(year, month, day));
  return cells;
}

// ============================================================================
// Heatmap (last N weeks, GitHub-style columns of 7)
// ============================================================================
function getHeatmapCells(task, weeks = 12) {
  const today = todayStr();
  const todayDow = getWeekday(today);
  const endOfWeek = addDays(today, 6 - todayDow);
  const totalDays = weeks * 7;
  const start = addDays(endOfWeek, -(totalDays - 1));

  const cells = [];
  let cursor = start;
  for (let i = 0; i < totalDays; i++) {
    let status;
    if (cmp(cursor, today) > 0) status = 'future';
    else if (!isScheduledOn(task, cursor)) status = 'non-scheduled';
    else if (isCompletedOn(task, cursor)) status = 'completed';
    else if (cursor === today) status = 'pending'; // due today, not yet marked — not a "miss" yet
    else status = 'missed';
    cells.push({ date: cursor, status });
    cursor = addDays(cursor, 1);
  }
  return cells;
}

// ============================================================================
// Achievements — kept intentionally simple; each check runs over all tasks.
// ============================================================================
const ACHIEVEMENT_DEFS = [
  {
    id: 'first-step',
    name: 'First Step',
    description: 'Complete a scheduled task for the first time',
    check: (tasks) => tasks.some((t) => uniqueCompletedDates(t).length > 0),
  },
  {
    id: 'week-streak',
    name: '7 in a Row',
    description: 'Reach a 7-occurrence streak on any task',
    check: (tasks) => tasks.some((t) => Math.max(calculateCurrentStreak(t), calculateBestStreak(t)) >= 7),
  },
  {
    id: 'month-streak',
    name: '30 in a Row',
    description: 'Reach a 30-occurrence streak on any task',
    check: (tasks) => tasks.some((t) => Math.max(calculateCurrentStreak(t), calculateBestStreak(t)) >= 30),
  },
  {
    id: 'high-achiever',
    name: 'High Achiever',
    description: '80%+ completion rate on a task with 10+ scheduled occurrences',
    check: (tasks) => tasks.some((t) => getScheduledDatesThrough(t, todayStr()).length >= 10 && calculateCompletionRate(t) >= 80),
  },
];

function computeAchievements(tasks) {
  return ACHIEVEMENT_DEFS.map((a) => ({ ...a, unlocked: a.check(tasks) }));
}

// ============================================================================
// Export / Import (local JSON backup)
// ============================================================================
function exportBackup(state) {
  const payload = {
    tasks: state.tasks,
    dailyGoal: state.dailyGoal,
    categories: state.categories,
    theme: state.theme,
    exportedAt: new Date().toISOString(),
    version: 6,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `task-streak-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.tasks)) {
          reject(new Error('This file does not look like a Task Streak Tracker backup.'));
          return;
        }
        resolve(data);
      } catch (err) {
        reject(new Error('Could not read that file as JSON.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

// ============================================================================
// Notifications — best-effort, foreground-only. There is no service worker
// here, so reminders only fire while this tab is open; that limitation is
// surfaced in the UI rather than implied to work in the background.
// ============================================================================
function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function requestNotificationPermission() {
  if (!notificationsSupported()) return Promise.resolve('unsupported');
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Promise.resolve(Notification.permission);
  }
  return Notification.requestPermission();
}

function fireNotification(title, body) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch (e) {
    // Some browsers (mostly mobile) disallow the constructor directly; safe to ignore.
  }
}

// ============================================================================
// Main component
// ============================================================================
function App() {
  const [tasks, setTasks] = useState([]);
  const [dailyGoal, setDailyGoal] = useState(3);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [theme, setTheme] = useState('dark');
  const [hydrated, setHydrated] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState(false);

  const [page, setPage] = useState('dashboard');
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  const now = new Date();
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth());

  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [importError, setImportError] = useState('');
  const [pendingImportData, setPendingImportData] = useState(null);

  const emptyForm = {
    text: '',
    frequency: 'daily',
    repeatDays: [],
    category: 'General',
    startDate: todayStr(),
    endDate: '',
    reminderTime: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [newCategoryDraft, setNewCategoryDraft] = useState('');

  const colors = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const fileInputRef = useRef(null);
  const firedRemindersRef = useRef(new Set());

  // ---- Load + one-time migration ----
  useEffect(() => {
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY_V6);
      if (currentRaw) {
        const data = JSON.parse(currentRaw);
        setTasks(Array.isArray(data.tasks) ? data.tasks.map(normalizeLoadedTask) : []);
        if (data.dailyGoal) setDailyGoal(Number(data.dailyGoal));
        if (Array.isArray(data.categories) && data.categories.length) setCategories(data.categories);
        if (data.theme === 'light' || data.theme === 'dark') setTheme(data.theme);
      } else {
        const oldRaw = localStorage.getItem(STORAGE_KEY_V5);
        if (oldRaw) {
          const oldData = JSON.parse(oldRaw);
          const migrated = migrateV5Data(oldData, todayStr());
          setTasks(migrated.tasks);
          setDailyGoal(migrated.dailyGoal);
          setCategories(migrated.categories);
          setTheme(migrated.theme);
          setMigrationNotice(true);
        }
      }
    } catch (error) {
      console.error('Failed to load saved data:', error);
    }
    setHydrated(true);
  }, []);

  // ---- Persist (v6 only — v5 is left untouched as a fallback) ----
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY_V6,
        JSON.stringify({ tasks, dailyGoal, categories, theme, updatedAt: todayStr() })
      );
    } catch (error) {
      console.error('Failed to save data:', error);
    }
  }, [tasks, dailyGoal, categories, theme, hydrated]);

  // ---- Foreground reminder check ----
  useEffect(() => {
    const interval = setInterval(() => {
      const today = todayStr();
      const nowTime = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
      tasks.forEach((task) => {
        if (!task.reminderTime) return;
        if (!isScheduledToday(task)) return;
        if (isCompletedOn(task, today)) return;
        const key = `${task.id}-${today}`;
        if (firedRemindersRef.current.has(key)) return;
        if (nowTime >= task.reminderTime) {
          fireNotification('Task Streak Tracker', `Reminder: "${task.text}" is due today`);
          firedRemindersRef.current.add(key);
        }
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [tasks]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const today = todayStr();

  const todaysTasks = useMemo(
    () => tasks.filter((t) => isScheduledToday(t)),
    [tasks]
  );
  const completedTodayCount = todaysTasks.filter((t) => isCompletedOn(t, today)).length;

  const overallCurrentStreak = tasks.length ? Math.max(...tasks.map(calculateCurrentStreak)) : 0;
  const overallBestStreak = tasks.length ? Math.max(...tasks.map(calculateBestStreak)) : 0;
  const overallCompletionRate = tasks.length
    ? Math.round(tasks.reduce((sum, t) => sum + calculateCompletionRate(t), 0) / tasks.length)
    : 0;
  const totalCompletions = tasks.reduce((sum, t) => sum + uniqueCompletedDates(t).length, 0);

  const weekStart = addDays(today, -6);
  const monthStart = today.slice(0, 8) + '01';
  const completedThisWeek = tasks.reduce((sum, t) => sum + completedInRange(t, weekStart, today), 0);
  const completedThisMonth = tasks.reduce((sum, t) => sum + completedInRange(t, monthStart, today), 0);

  const achievements = useMemo(() => computeAchievements(tasks), [tasks]);

  const monthlyOverall = useMemo(() => {
    return MONTHS.map((_, month) => {
      let completed = 0;
      tasks.forEach((task) => {
        const total = daysInMonth(calendarYear, month);
        for (let day = 1; day <= total; day++) {
          const date = `${calendarYear}-${pad(month + 1)}-${pad(day)}`;
          if (!isFutureDate(date) && isCompletedOn(task, date)) completed++;
        }
      });
      return { month: MONTHS[month].slice(0, 3), completed };
    });
  }, [tasks, calendarYear]);

  const taskMonthlyStats = useMemo(() => {
    if (!selectedTask) return [];
    const yearEnd = `${calendarYear}-12-31`;
    const cappedEnd = cmp(yearEnd, today) > 0 ? today : yearEnd;
    const yearStart = `${calendarYear}-01-01`;
    const allScheduled = cmp(cappedEnd, yearStart) >= 0 ? getScheduledDatesThrough(selectedTask, cappedEnd) : [];
    const yearScheduled = allScheduled.filter((d) => d.slice(0, 4) === String(calendarYear));
    const completedSet = new Set(selectedTask.completedDates || []);
    return MONTHS.map((_, month) => {
      const mm = pad(month + 1);
      const inMonth = yearScheduled.filter((d) => d.slice(5, 7) === mm);
      const completedCount = inMonth.filter((d) => completedSet.has(d)).length;
      return {
        month: MONTHS[month].slice(0, 3),
        scheduled: inMonth.length,
        completed: completedCount,
        percentage: inMonth.length ? Math.round((completedCount / inMonth.length) * 100) : 0,
      };
    });
  }, [selectedTask, calendarYear, today]);

  // ---- Editing state (shared by the Add and Edit task forms) ----
  const [editingId, setEditingId] = useState(null);
  const [goalDraft, setGoalDraft] = useState(dailyGoal);

  // ---- Navigation ----
  function openTask(id) {
    setSelectedTaskId(id);
    setPage('task');
    setMenuOpen(false);
    const n = new Date();
    setCalendarMonth(n.getMonth());
    setCalendarYear(n.getFullYear());
  }

  function goDashboard() {
    setPage('dashboard');
    setSelectedTaskId(null);
    setMenuOpen(false);
  }

  function changeMonth(delta) {
    let newMonth = calendarMonth + delta;
    let newYear = calendarYear;
    if (newMonth < 0) {
      newMonth = 11;
      newYear -= 1;
    } else if (newMonth > 11) {
      newMonth = 0;
      newYear += 1;
    }
    setCalendarMonth(newMonth);
    setCalendarYear(newYear);
  }

  function goToCurrentMonth() {
    const n = new Date();
    setCalendarMonth(n.getMonth());
    setCalendarYear(n.getFullYear());
  }

  const viewingCurrentMonth = calendarYear === now.getFullYear() && calendarMonth === now.getMonth();

  // ---- Completion toggling ----
  function toggleDate(taskId, dateStr) {
    if (isFutureDate(dateStr)) return;
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        const dates = new Set(task.completedDates || []);
        if (dates.has(dateStr)) dates.delete(dateStr);
        else dates.add(dateStr);
        return { ...task, completedDates: [...dates].sort() };
      })
    );
  }

  // ---- Add / Edit task form ----
  function openAddModal() {
    setForm({ ...emptyForm, startDate: todayStr() });
    setEditingId(null);
    setModal('taskForm');
  }

  function openEditModal(task) {
    setForm({
      text: task.text,
      frequency: task.frequency || 'daily',
      repeatDays: task.repeatDays || [],
      category: task.category || 'General',
      startDate: task.startDate || task.createdAt || todayStr(),
      endDate: task.endDate || '',
      reminderTime: task.reminderTime || '',
    });
    setEditingId(task.id);
    setModal('taskForm');
  }

  function toggleFormWeekday(dow) {
    setForm((f) => {
      const has = f.repeatDays.includes(dow);
      return {
        ...f,
        repeatDays: has ? f.repeatDays.filter((d) => d !== dow) : [...f.repeatDays, dow].sort((a, b) => a - b),
      };
    });
  }

  function addCategory() {
    const name = newCategoryDraft.trim();
    if (!name) return;
    if (!categories.includes(name)) setCategories((prev) => [...prev, name]);
    setForm((f) => ({ ...f, category: name }));
    setNewCategoryDraft('');
  }

  const formIsValid = form.text.trim().length > 0 && (form.frequency !== 'custom' || form.repeatDays.length > 0);

  function submitTaskForm() {
    if (!formIsValid) return;
    const text = form.text.trim();

    if (editingId) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === editingId
            ? {
                ...t,
                text,
                frequency: form.frequency,
                repeatDays: form.frequency === 'custom' ? form.repeatDays : [],
                category: form.category,
                startDate: form.startDate || t.startDate,
                endDate: form.endDate,
                reminderTime: form.reminderTime,
              }
            : t
        )
      );
    } else {
      const newTask = {
        id: `${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
        text,
        frequency: form.frequency,
        repeatDays: form.frequency === 'custom' ? form.repeatDays : [],
        category: form.category,
        startDate: form.startDate || todayStr(),
        endDate: form.endDate,
        reminderTime: form.reminderTime,
        createdAt: todayStr(),
        completedDates: [],
      };
      setTasks((prev) => [...prev, newTask]);
      setSelectedTaskId(newTask.id);
      setPage('task');
      goToCurrentMonth();
    }

    if (form.reminderTime) requestNotificationPermission();

    setModal(null);
    setForm(emptyForm);
    setEditingId(null);
  }

  function deleteTask(taskId) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const confirmed = window.confirm(`Delete "${task.text}"?\n\nAll completion history for this task will be removed.`);
    if (!confirmed) return;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    goDashboard();
  }

  // ---- Daily goal ----
  function openGoalModal() {
    setGoalDraft(dailyGoal);
    setModal('goal');
  }

  function saveGoal() {
    const value = Math.max(1, Math.min(100, Number(goalDraft) || 1));
    setDailyGoal(value);
    setModal(null);
  }

  // ---- Theme ----
  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  // ---- Export / Import ----
  function handleExport() {
    exportBackup({ tasks, dailyGoal, categories, theme });
  }

  function handleImportFileChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    readBackupFile(file)
      .then((data) => {
        setPendingImportData(data);
        setImportError('');
        setModal('import');
      })
      .catch((err) => {
        setImportError(err.message);
        setPendingImportData(null);
        setModal('import');
      });
  }

  function confirmImport() {
    if (!pendingImportData) return;
    setTasks(pendingImportData.tasks.map(normalizeLoadedTask));
    if (pendingImportData.dailyGoal) setDailyGoal(Number(pendingImportData.dailyGoal));
    if (Array.isArray(pendingImportData.categories) && pendingImportData.categories.length) {
      setCategories(pendingImportData.categories);
    }
    if (pendingImportData.theme === 'light' || pendingImportData.theme === 'dark') setTheme(pendingImportData.theme);
    setModal(null);
    setPendingImportData(null);
    goDashboard();
  }

  function closeModal() {
    setModal(null);
    setImportError('');
    setPendingImportData(null);
  }

  if (!hydrated) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: colors.bg,
          color: colors.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'IBM Plex Sans, sans-serif',
        }}
      >
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; }

        body {
          margin: 0;
          background: ${colors.bg};
          color: ${colors.text};
          font-family: 'IBM Plex Sans', sans-serif;
          transition: background 0.2s ease, color 0.2s ease;
        }

        button, input, select { font: inherit; }
        button { cursor: pointer; }
        button:disabled { cursor: not-allowed; }

        .app {
          min-height: 100vh;
          background: radial-gradient(circle at top right, rgba(201,138,75,0.06), transparent 28%), ${colors.bg};
        }

        .container { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 60px; }

        .header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 30px; flex-wrap: wrap; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-icon { width: 42px; height: 42px; border: 1px solid ${colors.line}; background: ${colors.panel}; display: flex; align-items: center; justify-content: center; color: ${colors.copper}; }
        .brand-title { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
        .brand-subtitle { color: ${colors.textMuted}; font-size: 12px; margin-top: 2px; }
        .header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

        .btn { border: 1px solid ${colors.line}; background: ${colors.panel}; color: ${colors.text}; padding: 10px 14px; display: inline-flex; align-items: center; gap: 8px; transition: 0.2s; }
        .btn:hover:not(:disabled) { border-color: ${colors.copper}; color: ${colors.copper}; }
        .btn-icon { padding: 10px; }
        .btn-primary { background: ${colors.copper}; border-color: ${colors.copper}; color: #101820; font-weight: 600; }
        .btn-primary:hover:not(:disabled) { color: #101820; opacity: 0.9; }
        .btn-primary:disabled { opacity: 0.45; }
        .btn-sm { padding: 7px 11px; font-size: 12px; }

        .dropdown { position: relative; }
        .dropdown-menu { position: absolute; right: 0; top: calc(100% + 8px); width: 320px; background: ${colors.panel}; border: 1px solid ${colors.line}; z-index: 30; box-shadow: 0 15px 45px ${colors.shadow}; padding: 8px; max-height: 400px; overflow-y: auto; }

        .task-option { width: 100%; background: transparent; color: ${colors.text}; border: 0; padding: 11px; display: flex; align-items: center; justify-content: space-between; text-align: left; gap: 10px; }
        .task-option:hover { background: rgba(127,127,127,0.08); }
        .task-option-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .task-dot { width: 9px; height: 9px; border-radius: 50%; background: ${colors.line}; flex: 0 0 auto; }
        .task-dot.done { background: ${colors.complete}; }
        .task-option-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .task-option-streak { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: ${colors.copper}; white-space: nowrap; }

        .section-title { font-size: 13px; color: ${colors.textMuted}; text-transform: uppercase; letter-spacing: 1.3px; margin-bottom: 12px; font-family: 'IBM Plex Mono', monospace; display: flex; align-items: center; justify-content: space-between; }

        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
        .stat-card { background: ${colors.panel}; border: 1px solid ${colors.lineDim}; padding: 18px; min-height: 125px; }
        .stat-icon { color: ${colors.copper}; margin-bottom: 14px; }
        .stat-value { font-family: 'IBM Plex Mono', monospace; font-size: 27px; font-weight: 600; }
        .stat-label { color: ${colors.textMuted}; font-size: 12px; margin-top: 4px; }

        .today-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 22px; }
        .today-item { background: ${colors.panel}; border: 1px solid ${colors.lineDim}; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .today-item-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .today-check { width: 26px; height: 26px; flex: 0 0 auto; border: 1px solid ${colors.line}; background: transparent; color: transparent; display: flex; align-items: center; justify-content: center; }
        .today-check:hover { border-color: ${colors.complete}; }
        .today-check.done { background: ${colors.complete}; border-color: ${colors.complete}; color: #071712; }
        .today-item-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .today-item-name.done { text-decoration: line-through; color: ${colors.textMuted}; }
        .today-item-meta { font-size: 12px; color: ${colors.textMuted}; display: flex; gap: 8px; align-items: center; margin-top: 2px; }
        .today-item-right { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; }
        .today-streak { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: ${colors.copper}; white-space: nowrap; }

        .category-pill { display: inline-flex; align-items: center; gap: 5px; border: 1px solid ${colors.line}; padding: 3px 9px; font-size: 11px; color: ${colors.textMuted}; }

        .goal-panel { border: 1px solid ${colors.lineDim}; background: ${colors.panel}; padding: 20px; margin-bottom: 22px; }
        .goal-top { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 13px; flex-wrap: wrap; }
        .goal-title { display: flex; align-items: center; gap: 10px; font-weight: 600; }
        .goal-number { font-family: 'IBM Plex Mono', monospace; color: ${colors.copper}; }
        .progress { height: 7px; background: ${colors.lineDim}; overflow: hidden; }
        .progress-fill { height: 100%; background: ${colors.copper}; transition: width 0.25s ease; }

        .panel { background: ${colors.panel}; border: 1px solid ${colors.lineDim}; padding: 20px; margin-bottom: 22px; }
        .panel-header { display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; }
        .panel-title { display: flex; align-items: center; gap: 9px; font-weight: 600; }

        .nav-controls { display: flex; align-items: center; gap: 8px; }
        .nav-btn { width: 34px; height: 34px; background: transparent; color: ${colors.text}; border: 1px solid ${colors.line}; display: flex; align-items: center; justify-content: center; }
        .nav-btn:hover:not(:disabled) { border-color: ${colors.copper}; color: ${colors.copper}; }
        .nav-btn:disabled { opacity: 0.3; }
        .nav-label { min-width: 120px; text-align: center; font-family: 'IBM Plex Mono', monospace; color: ${colors.copper}; font-size: 13px; }
        .nav-today-btn { font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 6px 10px; }

        .chart { display: grid; grid-template-columns: repeat(12, 1fr); gap: 10px; align-items: end; height: 190px; }
        .chart-item { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 8px; }
        .bar-area { width: 100%; height: 145px; display: flex; align-items: flex-end; }
        .bar { width: 100%; min-height: 2px; background: ${colors.copper}; opacity: 0.8; transition: height 0.3s; }
        .bar:hover { opacity: 1; }
        .bar-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: ${colors.textMuted}; }

        .empty { text-align: center; padding: 65px 20px; border: 1px dashed ${colors.line}; color: ${colors.textMuted}; }
        .empty-icon { margin-bottom: 14px; color: ${colors.copper}; }
        .empty-title { color: ${colors.text}; font-weight: 600; margin-bottom: 7px; }

        .task-page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 15px; margin-bottom: 24px; flex-wrap: wrap; }
        .back-btn { background: transparent; border: 0; color: ${colors.textMuted}; display: inline-flex; align-items: center; gap: 7px; padding: 0; margin-bottom: 14px; }
        .back-btn:hover { color: ${colors.text}; }
        .task-page-title { font-size: 30px; margin: 0 0 6px; letter-spacing: -0.5px; }
        .task-page-meta { color: ${colors.textMuted}; font-size: 13px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .task-actions { display: flex; gap: 8px; }

        .weekday-picker { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
        .weekday-btn { border: 1px solid ${colors.line}; background: transparent; color: ${colors.textMuted}; padding: 9px 0; font-size: 11px; font-family: 'IBM Plex Mono', monospace; text-align: center; }
        .weekday-btn.active { background: ${colors.copper}; border-color: ${colors.copper}; color: #101820; font-weight: 600; }
        .weekday-btn:hover:not(.active) { border-color: ${colors.copper}; color: ${colors.copper}; }

        .days-header { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 6px; }
        .days-header-cell { text-align: center; font-size: 11px; color: ${colors.textMuted}; font-family: 'IBM Plex Mono', monospace; }
        .days-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
        .day-cell { aspect-ratio: 1; border: 1px solid ${colors.lineDim}; background: transparent; color: ${colors.text}; font-family: 'IBM Plex Mono', monospace; font-size: 13px; display: flex; align-items: center; justify-content: center; position: relative; }
        .day-cell:not(:disabled):hover { border-color: ${colors.copper}; }
        .day-cell.non-scheduled { color: ${colors.textMuted}; opacity: 0.35; border-style: dashed; }
        .day-cell.completed { background: ${colors.complete}; border-color: ${colors.complete}; color: #071712; font-weight: 600; }
        .day-cell.today { border-color: ${colors.copper}; border-width: 2px; }
        .day-cell.future { opacity: 0.25; cursor: not-allowed; }
        .day-cell.empty-cell { border: 0; pointer-events: none; }

        .calendar-legend { display: flex; gap: 16px; margin-top: 16px; color: ${colors.textMuted}; font-size: 11px; align-items: center; flex-wrap: wrap; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-box { width: 12px; height: 12px; border: 1px solid ${colors.line}; }
        .legend-box.completed { background: ${colors.complete}; border-color: ${colors.complete}; }
        .legend-box.non-scheduled { opacity: 0.35; border-style: dashed; }
        .legend-box.today { border-color: ${colors.copper}; border-width: 2px; }

        .heatmap-scroll { overflow-x: auto; padding-bottom: 4px; }
        .heatmap-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 1fr); gap: 3px; width: max-content; }
        .heatmap-cell { width: 13px; height: 13px; border: 1px solid ${colors.lineDim}; }
        .heatmap-cell.completed { background: ${colors.complete}; border-color: ${colors.complete}; }
        .heatmap-cell.missed { background: ${colors.warn}; opacity: 0.55; border-color: ${colors.warn}; }
        .heatmap-cell.pending { border-color: ${colors.copper}; border-width: 2px; }
        .heatmap-cell.non-scheduled { opacity: 0.25; }
        .heatmap-cell.future { opacity: 0.08; }

        .achievements-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .achievement-card { border: 1px solid ${colors.lineDim}; padding: 14px; display: flex; gap: 12px; align-items: flex-start; }
        .achievement-card.unlocked { border-color: ${colors.copper}; }
        .achievement-icon { color: ${colors.textMuted}; flex: 0 0 auto; margin-top: 2px; }
        .achievement-card.unlocked .achievement-icon { color: ${colors.copper}; }
        .achievement-name { font-weight: 600; font-size: 13px; }
        .achievement-card:not(.unlocked) .achievement-name, .achievement-card:not(.unlocked) .achievement-desc { color: ${colors.textMuted}; }
        .achievement-desc { font-size: 11px; color: ${colors.textMuted}; margin-top: 3px; }

        .modal-backdrop { position: fixed; inset: 0; background: ${colors.overlay}; display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; overflow-y: auto; }
        .modal { width: min(480px, 100%); background: ${colors.panel}; border: 1px solid ${colors.line}; box-shadow: 0 25px 80px ${colors.shadow}; padding: 22px; max-height: 90vh; overflow-y: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .modal-title { font-size: 18px; font-weight: 600; }
        .close-btn { background: transparent; border: 0; color: ${colors.textMuted}; padding: 4px; }
        .close-btn:hover { color: ${colors.text}; }

        .field { margin-bottom: 16px; }
        .field label { display: block; font-size: 12px; color: ${colors.textMuted}; margin-bottom: 7px; }
        .field-hint { font-size: 11px; color: ${colors.textMuted}; margin-top: 6px; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .input, .select { width: 100%; background: ${colors.bg}; color: ${colors.text}; border: 1px solid ${colors.line}; padding: 12px; outline: none; }
        .input:focus, .select:focus { border-color: ${colors.copper}; }
        .input-with-btn { display: flex; gap: 8px; }
        .input-with-btn .input { flex: 1; }

        .freq-toggle { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .freq-btn { border: 1px solid ${colors.line}; background: transparent; color: ${colors.text}; padding: 10px; font-size: 12px; }
        .freq-btn.active { background: ${colors.copper}; border-color: ${colors.copper}; color: #101820; font-weight: 600; }

        .modal-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 20px; }
        .danger { color: ${colors.warn}; }
        .danger:hover:not(:disabled) { border-color: ${colors.warn}; color: ${colors.warn}; }
        .error-box { border: 1px solid ${colors.warn}; color: ${colors.warn}; padding: 10px 12px; font-size: 12px; margin-bottom: 14px; }
        .notice-box { border: 1px solid ${colors.copper}; color: ${colors.copper}; padding: 10px 12px; font-size: 12px; margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }

        .mono { font-family: 'IBM Plex Mono', monospace; }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        @media (max-width: 900px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .field-row { grid-template-columns: 1fr; }
        }

        @media (max-width: 650px) {
          .container { width: min(100% - 20px, 1180px); padding-top: 18px; }
          .header { align-items: flex-start; }
          .brand-title { font-size: 17px; }
          .header-actions { gap: 6px; }
          .btn span { display: none; }
          .btn-icon span { display: none; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .stat-card { min-height: 105px; padding: 14px; }
          .stat-value { font-size: 22px; }
          .task-page-header { flex-direction: column; }
          .task-actions { width: 100%; }
          .task-actions .btn { flex: 1; justify-content: center; }
          .chart { gap: 4px; }
          .bar-label { font-size: 8px; }
          .dropdown-menu { right: -50px; width: min(320px, calc(100vw - 20px)); }
          .today-item { flex-wrap: wrap; }
          .achievements-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="app">
        <div className="container">
          {/* HEADER */}
          <header className="header">
            <div className="brand">
              <div className="brand-icon">
                <Flame size={22} />
              </div>
              <div>
                <div className="brand-title">Task Streak Tracker</div>
                <div className="brand-subtitle">Build consistency. Track progress.</div>
              </div>
            </div>

            <div className="header-actions">
              <button className="btn btn-icon" onClick={toggleTheme} title="Toggle dark / light mode">
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>

              <button className="btn btn-icon" onClick={handleExport} title="Export backup (JSON)">
                <Download size={17} />
              </button>

              <button className="btn btn-icon" onClick={() => fileInputRef.current && fileInputRef.current.click()} title="Import backup (JSON)">
                <Upload size={17} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={handleImportFileChange}
              />

              <div className="dropdown">
                <button className="btn" onClick={() => setMenuOpen(!menuOpen)}>
                  <CalendarDays size={17} />
                  <span>My Tasks</span>
                  <ChevronDown size={15} />
                </button>

                {menuOpen && (
                  <div className="dropdown-menu">
                    {tasks.length === 0 ? (
                      <div style={{ padding: 18, color: colors.textMuted, fontSize: 13, textAlign: 'center' }}>
                        No tasks yet.
                      </div>
                    ) : (
                      tasks.map((task) => (
                        <button key={task.id} className="task-option" onClick={() => openTask(task.id)}>
                          <div className="task-option-left">
                            <span className={`task-dot ${isCompletedOn(task, today) ? 'done' : ''}`} />
                            <span className="task-option-name">{task.text}</span>
                          </div>
                          <span className="task-option-streak">🔥 {calculateCurrentStreak(task)}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <button className="btn btn-primary" onClick={openAddModal}>
                <Plus size={17} />
                <span>Add Task</span>
              </button>
            </div>
          </header>

          {migrationNotice && (
            <div className="notice-box">
              <span>Your existing tasks were carried over from the previous version — nothing was lost.</span>
              <button className="close-btn" onClick={() => setMigrationNotice(false)}>
                <X size={16} />
              </button>
            </div>
          )}

          {page === 'dashboard' ? (
            <>
              {/* TODAY */}
              <div className="section-title">Today · {formatDateLabel(today)}</div>

              {todaysTasks.length === 0 ? (
                <div className="empty" style={{ marginBottom: 22 }}>
                  <CalendarDays size={30} className="empty-icon" />
                  <div className="empty-title">Nothing scheduled today</div>
                  <div>Custom-scheduled tasks will appear here on their scheduled days.</div>
                </div>
              ) : (
                <div className="today-list">
                  {todaysTasks.map((task) => {
                    const done = isCompletedOn(task, today);
                    return (
                      <div className="today-item" key={task.id}>
                        <div
                          className="today-item-left"
                          style={{ cursor: 'pointer', minWidth: 0 }}
                          onClick={() => openTask(task.id)}
                        >
                          <button
                            className={`today-check ${done ? 'done' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDate(task.id, today);
                            }}
                            title={done ? 'Mark incomplete' : 'Mark complete'}
                          >
                            {done && <Check size={15} />}
                          </button>
                          <div style={{ minWidth: 0 }}>
                            <div className={`today-item-name ${done ? 'done' : ''}`}>{task.text}</div>
                            <div className="today-item-meta">
                              <span className="category-pill">
                                <Tag size={10} />
                                {task.category}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="today-item-right">
                          <span className="today-streak">🔥 {calculateCurrentStreak(task)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* OVERVIEW */}
              <div className="section-title">Overview</div>
              <div className="stats-grid">
                <div className="stat-card">
                  <Flame size={19} className="stat-icon" />
                  <div className="stat-value">{overallCurrentStreak}</div>
                  <div className="stat-label">Current streak</div>
                </div>
                <div className="stat-card">
                  <Trophy size={19} className="stat-icon" />
                  <div className="stat-value">{overallBestStreak}</div>
                  <div className="stat-label">Best streak</div>
                </div>
                <div className="stat-card">
                  <Target size={19} className="stat-icon" />
                  <div className="stat-value">{overallCompletionRate}%</div>
                  <div className="stat-label">Average completion</div>
                </div>
                <div className="stat-card">
                  <Check size={19} className="stat-icon" />
                  <div className="stat-value">{totalCompletions}</div>
                  <div className="stat-label">Total completions</div>
                </div>
              </div>

              <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="stat-card" style={{ minHeight: 'auto', padding: 16 }}>
                  <div className="stat-value" style={{ fontSize: 22 }}>{completedThisWeek}</div>
                  <div className="stat-label">Completed this week</div>
                </div>
                <div className="stat-card" style={{ minHeight: 'auto', padding: 16 }}>
                  <div className="stat-value" style={{ fontSize: 22 }}>{completedThisMonth}</div>
                  <div className="stat-label">Completed this month</div>
                </div>
              </div>

              {/* DAILY GOAL */}
              <div className="goal-panel">
                <div className="goal-top">
                  <div className="goal-title">
                    <Target size={18} color={colors.copper} />
                    <span>Today's Goal</span>
                  </div>
                  <button className="btn btn-sm" onClick={openGoalModal}>
                    <Settings2 size={15} />
                    <span>Set Goal</span>
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9, fontSize: 12 }}>
                  <span style={{ color: colors.textMuted }}>
                    {completedTodayCount} of {dailyGoal} tasks completed
                  </span>
                  <span className="goal-number">{Math.min(100, Math.round((completedTodayCount / dailyGoal) * 100))}%</span>
                </div>
                <div className="progress">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, (completedTodayCount / dailyGoal) * 100)}%` }}
                  />
                </div>
              </div>

              {/* MONTHLY CHART */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">
                    <BarChart3 size={18} color={colors.copper} />
                    Monthly Activity
                  </div>
                  <div className="nav-controls">
                    <button className="nav-btn" onClick={() => setCalendarYear((y) => y - 1)}>
                      <ChevronLeft size={16} />
                    </button>
                    <div className="nav-label">{calendarYear}</div>
                    <button
                      className="nav-btn"
                      onClick={() => setCalendarYear((y) => y + 1)}
                      disabled={calendarYear >= now.getFullYear()}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                {tasks.length === 0 ? (
                  <div className="empty">
                    <BarChart3 size={35} className="empty-icon" />
                    <div className="empty-title">No activity yet</div>
                    <div>Add your first task to start tracking.</div>
                  </div>
                ) : (
                  <div className="chart">
                    {monthlyOverall.map((item) => {
                      const max = Math.max(1, ...monthlyOverall.map((x) => x.completed));
                      return (
                        <div className="chart-item" key={item.month}>
                          <div className="bar-area" title={`${item.completed} completed`}>
                            <div className="bar" style={{ height: `${(item.completed / max) * 100}%` }} />
                          </div>
                          <div className="bar-label">{item.month}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ACHIEVEMENTS */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">
                    <Award size={18} color={colors.copper} />
                    Achievements
                  </div>
                </div>
                <div className="achievements-grid">
                  {achievements.map((a) => (
                    <div className={`achievement-card ${a.unlocked ? 'unlocked' : ''}`} key={a.id}>
                      <div className="achievement-icon">{a.unlocked ? <Award size={20} /> : <Lock size={18} />}</div>
                      <div>
                        <div className="achievement-name">{a.name}</div>
                        <div className="achievement-desc">{a.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {tasks.length === 0 && (
                <div className="empty">
                  <Flame size={42} className="empty-icon" />
                  <div className="empty-title">Start your first streak</div>
                  <div style={{ marginBottom: 18 }}>Create a task and record completion for any scheduled day.</div>
                  <button className="btn btn-primary" onClick={openAddModal}>
                    <Plus size={17} />
                    Add Your First Task
                  </button>
                </div>
              )}
            </>
          ) : selectedTask ? (
            <>
              {/* TASK DETAIL */}
              <div className="task-page-header">
                <div>
                  <button className="back-btn" onClick={goDashboard}>
                    <ArrowLeft size={16} />
                    Back to Dashboard
                  </button>
                  <h1 className="task-page-title">{selectedTask.text}</h1>
                  <div className="task-page-meta">
                    <span className="category-pill">
                      <Tag size={10} />
                      {selectedTask.category}
                    </span>
                    <span>
                      {selectedTask.frequency === 'daily'
                        ? 'Daily'
                        : selectedTask.frequency === 'once'
                        ? 'One-time'
                        : `Custom: ${(selectedTask.repeatDays || [])
                            .slice()
                            .sort((a, b) => a - b)
                            .map((d) => WEEKDAYS[d])
                            .join(', ')}`}
                    </span>
                    <span>· Started {formatDateLabel(selectedTask.startDate || selectedTask.createdAt)}</span>
                    {selectedTask.endDate && <span>· Ends {formatDateLabel(selectedTask.endDate)}</span>}
                    {selectedTask.reminderTime && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Bell size={11} />
                        {selectedTask.reminderTime}
                      </span>
                    )}
                  </div>
                </div>

                <div className="task-actions">
                  <button className="btn" onClick={() => openEditModal(selectedTask)}>
                    <Pencil size={16} />
                    <span>Edit</span>
                  </button>
                  <button className="btn danger" onClick={() => deleteTask(selectedTask.id)}>
                    <Trash2 size={16} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <Flame size={19} className="stat-icon" />
                  <div className="stat-value">{calculateCurrentStreak(selectedTask)}</div>
                  <div className="stat-label">Current streak</div>
                </div>
                <div className="stat-card">
                  <Trophy size={19} className="stat-icon" />
                  <div className="stat-value">{calculateBestStreak(selectedTask)}</div>
                  <div className="stat-label">Best streak</div>
                </div>
                <div className="stat-card">
                  <Target size={19} className="stat-icon" />
                  <div className="stat-value">{calculateCompletionRate(selectedTask)}%</div>
                  <div className="stat-label">Completion rate</div>
                </div>
                <div className="stat-card">
                  <Check size={19} className="stat-icon" />
                  <div className="stat-value">{uniqueCompletedDates(selectedTask).length}</div>
                  <div className="stat-label">Completed occurrences</div>
                </div>
              </div>

              {/* MONTH CALENDAR */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">
                    <CalendarDays size={18} color={colors.copper} />
                    {MONTHS[calendarMonth]} {calendarYear}
                  </div>
                  <div className="nav-controls">
                    <button className="nav-btn" onClick={() => changeMonth(-1)} title="Previous month">
                      <ChevronLeft size={16} />
                    </button>
                    {!viewingCurrentMonth && (
                      <button className="btn nav-today-btn" onClick={goToCurrentMonth}>
                        Today
                      </button>
                    )}
                    <button className="nav-btn" onClick={() => changeMonth(1)} title="Next month">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="days-header">
                  {WEEKDAYS.map((d) => (
                    <div className="days-header-cell" key={d}>{d}</div>
                  ))}
                </div>

                <div className="days-grid">
                  {getMonthCells(calendarYear, calendarMonth).map((date, i) => {
                    if (!date) return <div className="day-cell empty-cell" key={`e-${i}`} />;
                    const dateStr = dateToStr(date);
                    const scheduled = isScheduledOn(selectedTask, dateStr);
                    const completed = isCompletedOn(selectedTask, dateStr);
                    const future = isFutureDate(dateStr);
                    const isToday = dateStr === today;
                    const classes = ['day-cell'];
                    if (!scheduled) classes.push('non-scheduled');
                    if (completed) classes.push('completed');
                    if (future) classes.push('future');
                    if (isToday) classes.push('today');
                    return (
                      <button
                        key={dateStr}
                        className={classes.join(' ')}
                        disabled={future}
                        title={
                          future
                            ? `${dateStr}: future date`
                            : !scheduled
                            ? `${dateStr}: not a scheduled day`
                            : completed
                            ? `${dateStr}: completed`
                            : `${dateStr}: mark complete`
                        }
                        onClick={() => toggleDate(selectedTask.id, dateStr)}
                      >
                        {date.getDate()}
                      </button>
                    );
                  })}
                </div>

                <div className="calendar-legend">
                  <div className="legend-item">
                    <span className="legend-box completed" />
                    Completed
                  </div>
                  <div className="legend-item">
                    <span className="legend-box non-scheduled" />
                    Not scheduled
                  </div>
                  <div className="legend-item">
                    <span className="legend-box today" />
                    Today
                  </div>
                  <span>Click any past or current day to record or correct completion.</span>
                </div>
              </div>

              {/* HEATMAP */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">
                    <BarChart3 size={18} color={colors.copper} />
                    Last 12 Weeks
                  </div>
                </div>
                <div className="heatmap-scroll">
                  <div className="heatmap-grid">
                    {getHeatmapCells(selectedTask, 12).map((cell) => (
                      <div
                        key={cell.date}
                        className={`heatmap-cell ${cell.status}`}
                        title={`${cell.date}: ${cell.status.replace('-', ' ')}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="calendar-legend">
                  <div className="legend-item">
                    <span className="legend-box completed" />
                    Completed
                  </div>
                  <div className="legend-item">
                    <span className="heatmap-cell missed" style={{ display: 'inline-block' }} />
                    Missed
                  </div>
                  <div className="legend-item">
                    <span className="legend-box non-scheduled" />
                    Not scheduled
                  </div>
                </div>
              </div>

              {/* TASK MONTHLY COMPLETION */}
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title">
                    <BarChart3 size={18} color={colors.copper} />
                    Monthly Completion
                  </div>
                  <div className="nav-controls">
                    <button className="nav-btn" onClick={() => setCalendarYear((y) => y - 1)}>
                      <ChevronLeft size={16} />
                    </button>
                    <div className="nav-label">{calendarYear}</div>
                    <button
                      className="nav-btn"
                      onClick={() => setCalendarYear((y) => y + 1)}
                      disabled={calendarYear >= now.getFullYear()}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="chart">
                  {taskMonthlyStats.map((item) => (
                    <div className="chart-item" key={item.month}>
                      <div className="bar-area" title={`${item.completed}/${item.scheduled} scheduled days completed`}>
                        <div className="bar" style={{ height: `${item.percentage}%` }} />
                      </div>
                      <div className="bar-label">{item.month}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="empty">
              Task not found.
              <br />
              <button className="btn" style={{ marginTop: 15 }} onClick={goDashboard}>
                Back to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ADD / EDIT TASK MODAL */}
      {modal === 'taskForm' && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{editingId ? 'Edit Task' : 'Add New Task'}</div>
              <button className="close-btn" onClick={closeModal}>
                <X size={19} />
              </button>
            </div>

            <div className="field">
              <label>Task name</label>
              <input
                className="input"
                autoFocus
                value={form.text}
                onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
                placeholder="e.g. Study English"
              />
            </div>

            <div className="field">
              <label>Frequency</label>
              <div className="freq-toggle">
                {FREQUENCIES.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={`freq-btn ${form.frequency === f.value ? 'active' : ''}`}
                    onClick={() => setForm((prev) => ({ ...prev, frequency: f.value }))}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {form.frequency === 'custom' && (
              <div className="field">
                <label>Repeat on</label>
                <div className="weekday-picker">
                  {WEEKDAYS.map((label, dow) => (
                    <button
                      key={dow}
                      type="button"
                      className={`weekday-btn ${form.repeatDays.includes(dow) ? 'active' : ''}`}
                      onClick={() => toggleFormWeekday(dow)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {form.repeatDays.length === 0 && (
                  <div className="field-hint" style={{ color: colors.warn }}>Pick at least one day.</div>
                )}
              </div>
            )}

            <div className="field">
              <label>Category</label>
              <select
                className="select"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <div className="input-with-btn" style={{ marginTop: 8 }}>
                <input
                  className="input"
                  placeholder="Add a custom category"
                  value={newCategoryDraft}
                  onChange={(e) => setNewCategoryDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCategory();
                    }
                  }}
                />
                <button type="button" className="btn btn-sm" onClick={addCategory}>Add</button>
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Start date</label>
                <input
                  className="input"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>End date (optional)</label>
                <input
                  className="input"
                  type="date"
                  min={form.startDate}
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label>Reminder time (optional)</label>
              <input
                className="input"
                type="time"
                value={form.reminderTime}
                onChange={(e) => setForm((f) => ({ ...f, reminderTime: e.target.value }))}
              />
              <div className="field-hint">
                <Bell size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                Only fires while this app is open in your browser — not a background alert.
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={submitTaskForm} disabled={!formIsValid}>
                {editingId ? <Pencil size={16} /> : <Plus size={16} />}
                {editingId ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DAILY GOAL MODAL */}
      {modal === 'goal' && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Daily Goal</div>
              <button className="close-btn" onClick={closeModal}>
                <X size={19} />
              </button>
            </div>
            <div className="field">
              <label>Number of tasks to complete per day</label>
              <input
                className="input"
                type="number"
                min="1"
                max="100"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={saveGoal}>Save Goal</button>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT CONFIRMATION MODAL */}
      {modal === 'import' && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Import Backup</div>
              <button className="close-btn" onClick={closeModal}>
                <X size={19} />
              </button>
            </div>

            {importError ? (
              <div className="error-box">{importError}</div>
            ) : pendingImportData ? (
              <>
                <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 0 }}>
                  This file contains {pendingImportData.tasks.length} task
                  {pendingImportData.tasks.length === 1 ? '' : 's'}
                  {pendingImportData.exportedAt ? ` (exported ${formatDateLabel(pendingImportData.exportedAt.slice(0, 10))})` : ''}.
                  Importing will replace all current tasks and settings on this device.
                </p>
              </>
            ) : null}

            <div className="modal-actions">
              <button className="btn" onClick={closeModal}>Cancel</button>
              {!importError && pendingImportData && (
                <button className="btn btn-primary" onClick={confirmImport}>
                  <Upload size={16} />
                  Replace with this backup
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
