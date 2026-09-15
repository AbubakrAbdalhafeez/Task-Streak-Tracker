import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  Sparkles,
  LogOut,
  Cloud,
  CloudOff,
  RefreshCw,
  User as UserIcon,
  Mail,
  MoreVertical,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sunrise,
  Sunset,
  Moon as MoonIcon,
  Info,
} from 'lucide-react';

// ============================================================================
// Storage keys
// ============================================================================
const STORAGE_KEY_V5 = 'task-streak-tracker-v5';
const STORAGE_KEY_V6 = 'task-streak-tracker-v6';
const STORAGE_KEY_SETTINGS = 'task-streak-tracker-settings-v1';
const STORAGE_KEY_GREETING = 'task-streak-tracker-greeting-v1';

// ============================================================================
// Theme palettes
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
  googleBg: '#FFFFFF',
  googleText: '#3C4043',
  googleBorder: '#DADCE0',
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
  googleBg: '#FFFFFF',
  googleText: '#3C4043',
  googleBorder: '#DADCE0',
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

const DEFAULT_SETTINGS = {
  morningReminderEnabled: false,
  morningReminderTime: '09:00',
  morningReminderOnlyIfPending: true,
};

// ============================================================================
// Date utilities
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

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
// Migration
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

function normalizeLoadedSettings(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    morningReminderEnabled:
      typeof raw.morningReminderEnabled === 'boolean'
        ? raw.morningReminderEnabled
        : DEFAULT_SETTINGS.morningReminderEnabled,
    morningReminderTime:
      typeof raw.morningReminderTime === 'string' && /^\d{2}:\d{2}$/.test(raw.morningReminderTime)
        ? raw.morningReminderTime
        : DEFAULT_SETTINGS.morningReminderTime,
    morningReminderOnlyIfPending:
      typeof raw.morningReminderOnlyIfPending === 'boolean'
        ? raw.morningReminderOnlyIfPending
        : DEFAULT_SETTINGS.morningReminderOnlyIfPending,
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
// Heatmap
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
    else if (cursor === today) status = 'pending';
    else status = 'missed';
    cells.push({ date: cursor, status });
    cursor = addDays(cursor, 1);
  }
  return cells;
}

// ============================================================================
// Achievements
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
// Export / Import
// ============================================================================
function exportBackup(state) {
  const payload = {
    tasks: state.tasks,
    dailyGoal: state.dailyGoal,
    categories: state.categories,
    theme: state.theme,
    settings: state.settings,
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
// Notifications
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
    // ignore
  }
}

// ============================================================================
// Greeting helpers
// ============================================================================
function getTimeOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function TimeIcon({ timeOfDay, size = 16, color }) {
  if (timeOfDay === 'morning') return <Sunrise size={size} color={color} />;
  if (timeOfDay === 'afternoon') return <Sun size={size} color={color} />;
  if (timeOfDay === 'evening') return <Sunset size={size} color={color} />;
  return <MoonIcon size={size} color={color} />;
}

const GREETING_PREFIXES = {
  morning: ['Good morning', 'Rise and shine', 'Morning'],
  afternoon: ['Good afternoon', 'Hope your day is going well'],
  evening: ['Good evening', 'Winding down'],
  night: ['Good night', 'Still up'],
};

function pickGreeting({ timeOfDay, displayName, todaysTasks, completedTodayCount, maxStreak, streakAlert }) {
  const prefixOptions = GREETING_PREFIXES[timeOfDay] || GREETING_PREFIXES.morning;
  const prefix = prefixOptions[Math.floor(Math.random() * prefixOptions.length)];
  const greeting = displayName ? `${prefix}, ${displayName}` : prefix;

  const totalToday = todaysTasks.length;
  const pending = totalToday - completedTodayCount;

  // Streak alert takes priority — it's the most actionable info.
  if (streakAlert) {
    return {
      greeting,
      line: `${streakAlert.taskText} streak is at risk — ${streakAlert.remaining} task${
        streakAlert.remaining === 1 ? '' : 's'
      } left today to keep it alive.`,
      tone: 'warn',
    };
  }

  let lines = [];
  let tone = 'normal';

  if (totalToday === 0) {
    lines = [
      'Ready to make today productive?',
      "Nothing on today's schedule — a good moment to plan ahead.",
      'A quiet day. Want to add something small?',
    ];
  } else if (pending <= 0) {
    lines = [
      "Great job! You've completed everything for today.",
      'All done for today — you showed up.',
      "Today's list is clear. Well done.",
    ];
    tone = 'good';
  } else {
    lines = [
      `The day isn't over yet. You still have ${pending} task${pending === 1 ? '' : 's'} waiting for you.`,
      `${pending} task${pending === 1 ? '' : 's'} left today — you've got this.`,
      `Keep going — ${pending} more to finish today.`,
    ];
  }

  if (maxStreak >= 7) {
    lines.push(`You're on fire! Keep your streak of ${maxStreak} alive.`);
    tone = 'good';
  } else if (maxStreak >= 3) {
    lines.push(`Nice streak going — ${maxStreak} in a row.`);
  }

  const line = lines[Math.floor(Math.random() * lines.length)];
  return { greeting, line, tone };
}

// ============================================================================
// Google "G" icon (inline SVG)
// ============================================================================
function GoogleGIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ display: 'block' }}>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

// ============================================================================
// Sync status
// ============================================================================
function SyncStatusChip({ status, colors }) {
  const map = {
    local: { label: 'Local data', color: colors.textMuted, Icon: CloudOff },
    syncing: { label: 'Syncing…', color: colors.copper, Icon: RefreshCw },
    synced: { label: 'Synced', color: colors.complete, Icon: Cloud },
    offline: { label: 'Offline', color: colors.warn, Icon: CloudOff },
    error: { label: 'Sync error', color: colors.warn, Icon: CloudOff },
  };
  const meta = map[status] || map.local;
  const { Icon } = meta;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: `1px solid ${colors.line}`,
        padding: '5px 9px',
        fontSize: 11,
        color: meta.color,
        fontFamily: 'IBM Plex Mono, monospace',
        whiteSpace: 'nowrap',
      }}
      title="Cloud sync will be available after Firebase setup"
    >
      <Icon size={12} />
      {meta.label}
    </span>
  );
}

function SyncStatusDot({ status, colors }) {
  const color =
    status === 'synced' ? colors.complete
    : status === 'syncing' ? colors.copper
    : status === 'offline' || status === 'error' ? colors.warn
    : colors.textMuted;
  const label =
    status === 'synced' ? 'Synced'
    : status === 'syncing' ? 'Syncing…'
    : status === 'offline' ? 'Offline'
    : status === 'error' ? 'Sync error'
    : 'Local data';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: colors.textMuted }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

// ============================================================================
// Main component
// ============================================================================
function App() {
  const [tasks, setTasks] = useState([]);
  const [dailyGoal, setDailyGoal] = useState(3);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [theme, setTheme] = useState('dark');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState(false);

  const [page, setPage] = useState('dashboard');
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  const now = new Date();
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth());

  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [importError, setImportError] = useState('');
  const [pendingImportData, setPendingImportData] = useState(null);

  // ---- Auth scaffolding (Firebase will populate these later) ----
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState('local');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  // ---- Greeting (persisted per session so it doesn't flicker) ----
  const [greeting, setGreeting] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_GREETING);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  });

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
  const [reminderPermission, setReminderPermission] = useState(
    notificationsSupported() ? Notification.permission : 'unsupported'
  );

  const colors = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const fileInputRef = useRef(null);
  const firedRemindersRef = useRef(new Set());
  const searchInputRef = useRef(null);

  // ---- Close dropdowns when clicking outside ----
  const headerRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(e) {
      if (headerRef.current && !headerRef.current.contains(e.target)) {
        setMenuOpen(false);
        setAccountMenuOpen(false);
        setToolsMenuOpen(false);
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

      const settingsRaw = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (settingsRaw) {
        try {
          const parsed = JSON.parse(settingsRaw);
          setSettings(normalizeLoadedSettings(parsed));
        } catch (e) {
          setSettings({ ...DEFAULT_SETTINGS });
        }
      }
    } catch (error) {
      console.error('Failed to load saved data:', error);
    }
    setHydrated(true);
  }, []);

  // ---- Persist (v6 only) ----
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

  // ---- Persist settings ----
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }, [settings, hydrated]);

  // ---- Foreground reminder check (per-task) ----
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

  // ---- Morning reminder (settings-driven, local-only for now) ----
  useEffect(() => {
    if (!settings.morningReminderEnabled) return;
    const interval = setInterval(() => {
      const today = todayStr();
      const nowTime = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
      if (nowTime < settings.morningReminderTime) return;
      const key = `morning-${today}`;
      if (firedRemindersRef.current.has(key)) return;

      if (settings.morningReminderOnlyIfPending) {
        const pending = tasks.filter((t) => isScheduledToday(t) && !isCompletedOn(t, today));
        if (pending.length === 0) {
          firedRemindersRef.current.add(key);
          return;
        }
        fireNotification(
          'Task Streak Tracker',
          `Good morning! You have ${pending.length} task${pending.length === 1 ? '' : 's'} waiting today.`
        );
      } else {
        fireNotification('Task Streak Tracker', 'Good morning! Ready to keep your streak alive?');
      }
      firedRemindersRef.current.add(key);
    }, 30000);
    return () => clearInterval(interval);
  }, [tasks, settings]);

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

  // ---- Streak alert: a task scheduled today, not done, with a streak >= 3 ----
  const streakAlert = useMemo(() => {
    if (todaysTasks.length === 0) return null;
    const atRisk = todaysTasks
      .filter((t) => !isCompletedOn(t, today))
      .map((t) => ({ task: t, streak: calculateCurrentStreak(t) }))
      .filter((x) => x.streak >= 3)
      .sort((a, b) => b.streak - a.streak);
    if (atRisk.length === 0) return null;
    return {
      taskText: atRisk[0].task.text,
      streak: atRisk[0].streak,
      remaining: todaysTasks.filter((t) => !isCompletedOn(t, today)).length,
    };
  }, [todaysTasks, today]);

  // ---- Build the greeting once per (day + key signals), persist in sessionStorage ----
  useEffect(() => {
    if (!hydrated) return;
    const hour = new Date().getHours();
    const timeOfDay = getTimeOfDay(hour);
    const signalKey = `${today}|${timeOfDay}|${todaysTasks.length}|${completedTodayCount}|${overallCurrentStreak}|${
      streakAlert ? streakAlert.taskText : ''
    }|${user?.displayName || ''}`;

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_GREETING);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.signalKey === signalKey) {
          setGreeting(cached);
          return;
        }
      }
    } catch (e) {}

    const fresh = pickGreeting({
      timeOfDay,
      displayName: user?.displayName || '',
      todaysTasks,
      completedTodayCount,
      maxStreak: overallCurrentStreak,
      streakAlert,
    });
    const payload = { ...fresh, signalKey, timeOfDay };
    setGreeting(payload);
    try {
      sessionStorage.setItem(STORAGE_KEY_GREETING, JSON.stringify(payload));
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, today, todaysTasks.length, completedTodayCount, overallCurrentStreak, streakAlert, user?.displayName]);

  // ---- Editing state ----
  const [editingId, setEditingId] = useState(null);
  const [goalDraft, setGoalDraft] = useState(dailyGoal);

  // ---- Navigation ----
  function openTask(id) {
    setSelectedTaskId(id);
    setPage('task');
    setMenuOpen(false);
    setMobileMenuOpen(false);
    const n = new Date();
    setCalendarMonth(n.getMonth());
    setCalendarYear(n.getFullYear());
  }

  function goDashboard() {
    setPage('dashboard');
    setSelectedTaskId(null);
    setMenuOpen(false);
    setMobileMenuOpen(false);
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
    setMobileMenuOpen(false);
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
    exportBackup({ tasks, dailyGoal, categories, theme, settings });
    setToolsMenuOpen(false);
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
    setToolsMenuOpen(false);
  }

  function confirmImport() {
    if (!pendingImportData) return;
    setTasks(pendingImportData.tasks.map(normalizeLoadedTask));
    if (pendingImportData.dailyGoal) setDailyGoal(Number(pendingImportData.dailyGoal));
    if (Array.isArray(pendingImportData.categories) && pendingImportData.categories.length) {
      setCategories(pendingImportData.categories);
    }
    if (pendingImportData.theme === 'light' || pendingImportData.theme === 'dark') setTheme(pendingImportData.theme);
    if (pendingImportData.settings) setSettings(normalizeLoadedSettings(pendingImportData.settings));
    setModal(null);
    setPendingImportData(null);
    goDashboard();
  }

  function closeModal() {
    setModal(null);
    setImportError('');
    setPendingImportData(null);
  }

  // ---- Auth placeholder ----
  function handleGoogleSignInClick() {
    setModal('googleInfo');
    setMobileMenuOpen(false);
  }

  async function handleRequestNotifications() {
    const result = await requestNotificationPermission();
    setReminderPermission(result);
  }

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function handleKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;

      if (e.key === 'Escape') {
        if (modal) {
          closeModal();
        } else {
          setMenuOpen(false);
          setAccountMenuOpen(false);
          setToolsMenuOpen(false);
          setMobileMenuOpen(false);
        }
        return;
      }

      if (isTyping) return;

      if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openAddModal();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

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
        .btn-danger-ghost { color: ${colors.warn}; border-color: ${colors.line}; }
        .btn-danger-ghost:hover:not(:disabled) { border-color: ${colors.warn}; color: ${colors.warn}; }

        /* Tools menu (unified ⚙️ dropdown) */
        .tools-menu { width: 240px; padding: 6px; }
        .tools-item {
          width: 100%;
          display: flex; align-items: center; gap: 10px;
          background: transparent; border: 0; color: ${colors.text};
          padding: 10px 12px; text-align: left; font-size: 13px;
        }
        .tools-item:hover { background: rgba(127,127,127,0.08); color: ${colors.copper}; }
        .tools-item .sub { font-size: 11px; color: ${colors.textMuted}; margin-top: 2px; }
        .tools-divider { height: 1px; background: ${colors.lineDim}; margin: 6px 0; }

        /* Google Sign-In (official-ish styling) */
        .google-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: ${colors.googleBg};
          color: ${colors.googleText};
          border: 1px solid ${colors.googleBorder};
          padding: 9px 14px 9px 12px;
          font-weight: 500;
          font-size: 13px;
          transition: 0.2s;
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        }
        .google-btn:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.12); }
        .google-btn .g-wrap {
          display: inline-flex; align-items: center; justify-content: center;
          width: 18px; height: 18px; flex: 0 0 auto;
        }

        /* Profile chip */
        .profile-btn {
          display: inline-flex; align-items: center; gap: 9px;
          background: ${colors.panel}; color: ${colors.text};
          border: 1px solid ${colors.line}; padding: 5px 10px 5px 5px;
        }
        .profile-btn:hover { border-color: ${colors.copper}; }
        .profile-avatar {
          width: 26px; height: 26px; border-radius: 50%;
          background: ${colors.copper}; color: #101820;
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 12px; overflow: hidden; flex: 0 0 auto;
        }
        .profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .profile-info { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2; }
        .profile-name { font-size: 13px; font-weight: 600; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .profile-sync { font-size: 10px; color: ${colors.textMuted}; display: inline-flex; align-items: center; gap: 5px; }

        .dropdown { position: relative; }
        .dropdown-menu { position: absolute; right: 0; top: calc(100% + 8px); width: 320px; background: ${colors.panel}; border: 1px solid ${colors.line}; z-index: 30; box-shadow: 0 15px 45px ${colors.shadow}; padding: 8px; max-height: 400px; overflow-y: auto; }

        .account-menu { width: 300px; padding: 12px; }
        .account-menu-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; color: ${colors.textMuted}; font-size: 13px; }
        .account-menu-row .label { color: ${colors.text}; font-weight: 500; }
        .account-menu-row.disabled { opacity: 0.6; cursor: not-allowed; }
        .account-menu-header { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; margin-bottom: 8px; border-bottom: 1px solid ${colors.lineDim}; }
        .account-menu-note { font-size: 11px; color: ${colors.textMuted}; background: ${colors.bg}; border: 1px dashed ${colors.line}; padding: 8px 10px; margin-top: 8px; line-height: 1.4; }

        .task-option { width: 100%; background: transparent; color: ${colors.text}; border: 0; padding: 11px; display: flex; align-items: center; justify-content: space-between; text-align: left; gap: 10px; }
        .task-option:hover { background: rgba(127,127,127,0.08); }
        .task-option-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .task-dot { width: 9px; height: 9px; border-radius: 50%; background: ${colors.line}; flex: 0 0 auto; }
        .task-dot.done { background: ${colors.complete}; }
        .task-option-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .task-option-streak { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: ${colors.copper}; white-space: nowrap; }

        .section-title { font-size: 13px; color: ${colors.textMuted}; text-transform: uppercase; letter-spacing: 1.3px; margin-bottom: 12px; font-family: 'IBM Plex Mono', monospace; display: flex; align-items: center; justify-content: space-between; }

        /* Greeting card */
        .greeting-card {
          border: 1px solid ${colors.lineDim};
          background: ${colors.panel};
          padding: 18px 20px;
          margin-bottom: 22px;
          position: relative;
          overflow: hidden;
        }
        .greeting-card.tone-good { border-color: ${colors.complete}; }
        .greeting-card.tone-warn { border-color: ${colors.warn}; }
        .greeting-card::after {
          content: '';
          position: absolute; top: -40px; right: -40px;
          width: 160px; height: 160px;
          background: radial-gradient(circle, rgba(201,138,75,0.15), transparent 70%);
          pointer-events: none;
        }
        .greeting-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 16px; margin-bottom: 5px; }
        .greeting-line { color: ${colors.textMuted}; font-size: 13px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

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
        .today-streak { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: ${colors.copper}; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }

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
        .modal-title { font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
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

        .settings-section { border-top: 1px solid ${colors.lineDim}; padding-top: 16px; margin-top: 16px; }
        .settings-section:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
        .settings-section-title { font-size: 12px; color: ${colors.textMuted}; text-transform: uppercase; letter-spacing: 1.2px; font-family: 'IBM Plex Mono', monospace; margin-bottom: 12px; }
        .settings-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; }
        .settings-row .label { font-size: 13px; }
        .settings-row .sub { font-size: 11px; color: ${colors.textMuted}; margin-top: 2px; }

        .switch { position: relative; width: 40px; height: 22px; flex: 0 0 auto; border: 1px solid ${colors.line}; background: ${colors.bg}; transition: 0.2s; }
        .switch.on { background: ${colors.copper}; border-color: ${colors.copper}; }
        .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: ${colors.text}; transition: 0.2s; }
        .switch.on::after { left: 20px; background: #101820; }

        .google-modal-hero { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
        .google-modal-hero-icon { width: 46px; height: 46px; border-radius: 50%; background: #fff; border: 1px solid ${colors.googleBorder}; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }

        .kbd {
          display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 10px;
          border: 1px solid ${colors.line}; padding: 1px 5px; color: ${colors.textMuted}; margin-left: 4px;
        }

        .mono { font-family: 'IBM Plex Mono', monospace; }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

        @media (max-width: 900px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .field-row { grid-template-columns: 1fr; }
        }

        @media (max-width: 720px) {
          .container { width: min(100% - 20px, 1180px); padding-top: 18px; }
          .header { align-items: flex-start; }
          .brand-title { font-size: 17px; }
          .header-actions { gap: 6px; }
          .hide-mobile { display: none !important; }
          .google-btn { padding: 9px; }
          .google-btn .g-label { display: none; }
          .profile-info { display: none; }
          .profile-btn { padding: 5px; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .stat-card { min-height: 105px; padding: 14px; }
          .stat-value { font-size: 22px; }
          .task-page-header { flex-direction: column; }
          .task-actions { width: 100%; }
          .task-actions .btn { flex: 1; justify-content: center; }
          .chart { gap: 4px; }
          .bar-label { font-size: 8px; }
          .dropdown-menu { right: -50px; width: min(320px, calc(100vw - 20px)); }
          .account-menu { width: min(300px, calc(100vw - 40px)); }
          .today-item { flex-wrap: wrap; }
          .achievements-grid { grid-template-columns: 1fr; }
          .greeting-card { padding: 14px 16px; }
          .greeting-title { font-size: 15px; }
        }
      `}</style>

      <div className="app">
        <div className="container">
          {/* HEADER */}
          <header className="header" ref={headerRef}>
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
              {/* My Tasks — only when there is at least one task */}
              {tasks.length > 0 && (
                <div className="dropdown">
                  <button className="btn" onClick={() => {
                    setMenuOpen(!menuOpen);
                    setToolsMenuOpen(false);
                    setAccountMenuOpen(false);
                    setMobileMenuOpen(false);
                  }}>
                    <CalendarDays size={17} />
                    <span>My Tasks</span>
                    <ChevronDown size={15} />
                  </button>

                  {menuOpen && (
                    <div className="dropdown-menu">
                      {tasks.map((task) => (
                        <button key={task.id} className="task-option" onClick={() => openTask(task.id)}>
                          <div className="task-option-left">
                            <span className={`task-dot ${isCompletedOn(task, today) ? 'done' : ''}`} />
                            <span className="task-option-name">{task.text}</span>
                          </div>
                          <span className="task-option-streak">
                            <Flame size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
                            {calculateCurrentStreak(task)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Add Task */}
              <button className="btn btn-primary" onClick={openAddModal}>
                <Plus size={17} />
                <span>Add Task</span>
                <span className="kbd hide-mobile">N</span>
              </button>

              {/* Unified tools menu (theme, export, import, settings) */}
              <div className="dropdown">
                <button
                  className="btn btn-icon"
                  title="Tools & settings"
                  onClick={() => {
                    setToolsMenuOpen(!toolsMenuOpen);
                    setMenuOpen(false);
                    setAccountMenuOpen(false);
                    setMobileMenuOpen(false);
                  }}
                >
                  <Settings2 size={17} />
                </button>

                {toolsMenuOpen && (
                  <div className="dropdown-menu tools-menu">
                    <button className="tools-item" onClick={() => { toggleTheme(); setToolsMenuOpen(false); }}>
                      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                      <div>
                        <div>Switch to {theme === 'dark' ? 'light' : 'dark'} mode</div>
                      </div>
                    </button>

                    <div className="tools-divider" />

                    <button className="tools-item" onClick={handleExport}>
                      <Download size={16} />
                      <div>
                        <div>Export backup</div>
                        <div className="sub">Download JSON</div>
                      </div>
                    </button>

                    <button
                      className="tools-item"
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    >
                      <Upload size={16} />
                      <div>
                        <div>Import backup</div>
                        <div className="sub">Restore from JSON</div>
                      </div>
                    </button>

                    <div className="tools-divider" />

                    <button
                      className="tools-item"
                      onClick={() => { setModal('settings'); setToolsMenuOpen(false); }}
                    >
                      <Settings2 size={16} />
                      <div>
                        <div>Settings</div>
                        <div className="sub">Reminders & sync</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={handleImportFileChange}
              />

              {/* Auth area: Google button OR profile chip */}
              {user ? (
                <div className="dropdown">
                  <button
                    className="profile-btn"
                    onClick={() => {
                      setAccountMenuOpen(!accountMenuOpen);
                      setMenuOpen(false);
                      setToolsMenuOpen(false);
                    }}
                  >
                    <span className="profile-avatar">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt="" />
                      ) : (
                        (user.displayName || user.email || 'U').slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <span className="profile-info">
                      <span className="profile-name">{user.displayName || user.email || 'Account'}</span>
                      <SyncStatusDot status={syncStatus} colors={colors} />
                    </span>
                    <ChevronDown size={14} />
                  </button>

                  {accountMenuOpen && (
                    <div className="dropdown-menu account-menu">
                      <div className="account-menu-header">
                        <span className="profile-avatar" style={{ width: 32, height: 32, fontSize: 14 }}>
                          {user.photoURL ? (
                            <img src={user.photoURL} alt="" />
                          ) : (
                            (user.displayName || user.email || 'U').slice(0, 1).toUpperCase()
                          )}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div className="profile-name" style={{ maxWidth: 200 }}>
                            {user.displayName || 'Account'}
                          </div>
                          <div style={{ fontSize: 11, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {user.email || ''}
                          </div>
                        </div>
                      </div>

                      <div className="account-menu-row">
                        <UserIcon size={14} />
                        <span className="label">Account</span>
                      </div>
                      <div className="account-menu-row">
                        <Mail size={14} />
                        <span>{user.email || '—'}</span>
                      </div>
                      <div className="account-menu-row">
                        <SyncStatusChip status={syncStatus} colors={colors} />
                        {lastSyncedAt && syncStatus === 'synced' && (
                          <span style={{ fontSize: 11 }}>· {timeAgo(lastSyncedAt)}</span>
                        )}
                      </div>
                      <div className="account-menu-row disabled" title="Available after Firebase setup">
                        <LogOut size={14} />
                        <span>Sign out</span>
                      </div>

                      <div className="account-menu-note">
                        Account actions will be enabled after Firebase authentication is connected.
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button className="google-btn" onClick={handleGoogleSignInClick} title="Sign in with Google">
                  <span className="g-wrap">
                    <GoogleGIcon size={18} />
                  </span>
                  <span className="g-label">Sign in with Google</span>
                </button>
              )}
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
              {/* GREETING */}
              {greeting && (
                <div className={`greeting-card ${greeting.tone === 'good' ? 'tone-good' : greeting.tone === 'warn' ? 'tone-warn' : ''}`}>
                  <div className="greeting-title">
                    {greeting.tone === 'warn' ? (
                      <AlertTriangle size={16} color={colors.warn} />
                    ) : greeting.tone === 'good' ? (
                      <CheckCircle2 size={16} color={colors.complete} />
                    ) : (
                      <TimeIcon timeOfDay={greeting.timeOfDay} size={16} color={colors.copper} />
                    )}
                    {greeting.greeting}
                  </div>
                  <div className="greeting-line">
                    {greeting.tone === 'good' && <Check size={13} color={colors.complete} />}
                    {greeting.tone === 'warn' && <Flame size={13} color={colors.warn} />}
                    {greeting.line}
                  </div>
                </div>
              )}

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
                          <span className="today-streak">
                            <Flame size={12} />
                            {calculateCurrentStreak(task)}
                          </span>
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

      {/* SETTINGS MODAL */}
      {modal === 'settings' && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal" style={{ width: 'min(520px, 100%)' }}>
            <div className="modal-header">
              <div className="modal-title">
                <Settings2 size={18} color={colors.copper} />
                Settings
              </div>
              <button className="close-btn" onClick={closeModal}>
                <X size={19} />
              </button>
            </div>

            {/* Daily Morning Reminder */}
            <div className="settings-section">
              <div className="settings-section-title">Daily Morning Reminder</div>

              <div className="settings-row">
                <div>
                  <div className="label">Enable morning reminder</div>
                  <div className="sub">A friendly nudge to keep your streak going.</div>
                </div>
                <button
                  type="button"
                  className={`switch ${settings.morningReminderEnabled ? 'on' : ''}`}
                  onClick={() =>
                    setSettings((s) => ({ ...s, morningReminderEnabled: !s.morningReminderEnabled }))
                  }
                  aria-label="Toggle morning reminder"
                />
              </div>

              <div className="settings-row">
                <div>
                  <div className="label">Reminder time</div>
                  <div className="sub">Default: 9:00 AM</div>
                </div>
                <input
                  className="input"
                  style={{ width: 130 }}
                  type="time"
                  value={settings.morningReminderTime}
                  disabled={!settings.morningReminderEnabled}
                  onChange={(e) => setSettings((s) => ({ ...s, morningReminderTime: e.target.value || '09:00' }))}
                />
              </div>

              <div className="settings-row">
                <div>
                  <div className="label">Only remind me when I have unfinished tasks</div>
                  <div className="sub">Skip the reminder on days with nothing pending.</div>
                </div>
                <button
                  type="button"
                  className={`switch ${settings.morningReminderOnlyIfPending ? 'on' : ''}`}
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      morningReminderOnlyIfPending: !s.morningReminderOnlyIfPending,
                    }))
                  }
                  aria-label="Toggle only-if-pending"
                />
              </div>

              <div className="field-hint" style={{ marginTop: 6 }}>
                <Bell size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                Fires a local browser notification while this tab is open. Email reminders will be added after
                the backend is connected.
              </div>
            </div>

            {/* Browser Notifications */}
            <div className="settings-section">
              <div className="settings-section-title">Browser Notifications</div>
              <div className="settings-row">
                <div>
                  <div className="label">Permission</div>
                  <div className="sub">
                    Status: <span className="mono">{reminderPermission}</span>
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={handleRequestNotifications}
                  disabled={reminderPermission === 'granted' || reminderPermission === 'unsupported'}
                >
                  <Bell size={14} />
                  {reminderPermission === 'granted' ? 'Enabled' : 'Enable'}
                </button>
              </div>
            </div>

            {/* Sync */}
            <div className="settings-section">
              <div className="settings-section-title">Sync</div>
              <div className="settings-row">
                <div>
                  <div className="label">Cloud sync</div>
                  <div className="sub">Currently local-only. Will sync across devices after Firebase setup.</div>
                </div>
                <SyncStatusChip status={syncStatus} colors={colors} />
              </div>
            </div>

            {/* Backup */}
            <div className="settings-section">
              <div className="settings-section-title">Backup</div>
              <div className="settings-row">
                <div className="label">Export / Import</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={handleExport}>
                    <Download size={14} /> Export
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  >
                    <Upload size={14} /> Import
                  </button>
                </div>
              </div>
            </div>

            {/* Keyboard shortcuts */}
            <div className="settings-section">
              <div className="settings-section-title">Keyboard Shortcuts</div>
              <div className="settings-row">
                <div className="label">New task</div>
                <span className="kbd">N</span>
              </div>
              <div className="settings-row">
                <div className="label">Close modal / menu</div>
                <span className="kbd">Esc</span>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={closeModal}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* GOOGLE SIGN-IN INFO MODAL */}
      {modal === 'googleInfo' && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal" style={{ width: 'min(440px, 100%)' }}>
            <div className="modal-header">
              <div className="modal-title">
                <Cloud size={18} color={colors.copper} />
                Cloud Sync — Coming Soon
              </div>
              <button className="close-btn" onClick={closeModal}>
                <X size={19} />
              </button>
            </div>

            <div className="google-modal-hero">
              <div className="google-modal-hero-icon">
                <GoogleGIcon size={24} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Sign in with Google</div>
                <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  Coming after Firebase setup
                </div>
              </div>
            </div>

            <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6, margin: '0 0 8px' }}>
              Soon you'll be able to sign in with your Google account and:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <Cloud size={15} color={colors.copper} />
                Sync your tasks across all your devices
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <Bell size={15} color={colors.copper} />
                Get friendly morning email reminders
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <Trophy size={15} color={colors.copper} />
                Keep your streaks safe, even if you change devices
              </div>
            </div>

            <div className="account-menu-note" style={{ marginBottom: 12 }}>
              <Info size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
              Your data is currently saved locally on this device and stays safe. Nothing has been lost.
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={closeModal}>Got it</button>
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



  
  
  
