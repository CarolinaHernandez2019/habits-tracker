/* ═══════════════════════════════════════
   Habit Tracker — Lógica principal
   Con Supabase como backend (local-first)
   ═══════════════════════════════════════ */

// ══════════════════════════════════════
// ── Configuración de Supabase ──
// Las credenciales se cargan desde config.js (local, no en git)
// Ver config.js.example para plantilla
const SUPABASE_URL = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : null;
const SUPABASE_ANON_KEY = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_ANON_KEY : null;
// ══════════════════════════════════════

// Cliente de Supabase (se inicializa si hay config)
let db = null;

// ── Configuración de hábitos ──
const HABITS = [
  { id: 'no_dulce',  name: 'No comer dulce',    icon: '🍬' },
  { id: 'proteina',  name: 'Proteína 3 comidas', icon: '🥩' },
  { id: 'agua',      name: 'Agua 2L',            icon: '💧' },
  { id: 'pasos',     name: '7.500 pasos',        icon: '🚶' },
  { id: 'congo',     name: 'Congo x2',           icon: '🐕' },
];

const GYM_GOAL = 3; // sesiones por semana

// Nombres de días en español
const DAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

// Mediciones: definición y metas
const MEASUREMENT_DEFS = [
  { id: 'peso',     name: 'Peso',            unit: 'kg', goal: 63,  lower: true },
  { id: 'musculo',  name: 'Músculo',         unit: '%',  goal: 65,  lower: false },
  { id: 'proteina', name: 'Proteína',        unit: '%',  goal: 16,  lower: false },
  { id: 'grasa',    name: 'Grasa corporal',  unit: '%',  goal: 26,  lower: true },
  { id: 'visceral', name: 'Grasa visceral',  unit: '',   goal: 6,   lower: true },
  { id: 'agua',     name: 'Agua',            unit: '%',  goal: 49,  lower: false },
];

// Datos históricos iniciales (Reto Yogurt Griego)
const INITIAL_MEASUREMENTS = {
  '2025-05': { peso: 67,   musculo: 61, proteina: 15,   grasa: 34, visceral: 6, agua: 47 },
  '2025-09': { peso: 68.8, musculo: 61, proteina: 14.5, grasa: 35, visceral: 7, agua: 47 },
  '2026-01': { peso: 71.1, musculo: 60, proteina: 14.5, grasa: 36, visceral: 7, agua: 46 },
  '2026-02': { peso: 70.8, musculo: 60, proteina: 14.5, grasa: 36, visceral: 7, agua: 46 },
};

// ── Estado de la app ──
let state = {
  habits: {},
  measurements: {},
};

let currentDate = new Date();
let calendarDate = new Date();

// ── Utilidades de fecha ──
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function parseDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isToday(d) {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

function isFuture(d) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const check = new Date(d);
  check.setHours(0, 0, 0, 0);
  return check > now;
}

function formatDateDisplay(d) {
  const day = d.getDate();
  const month = MONTHS_ES[d.getMonth()];
  const year = d.getFullYear();
  if (isToday(d)) return `Hoy, ${day} ${month.substring(0, 3)} ${year}`;
  return `${day} ${month.substring(0, 3)} ${year}`;
}

// Obtener el lunes de la semana de una fecha
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Obtener todas las fechas de la semana (lun-dom)
function getWeekDates(d) {
  const monday = getMonday(d);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    dates.push(date);
  }
  return dates;
}

// ══════════════════════════════════════
// ── Almacenamiento: local-first + Supabase ──
// ══════════════════════════════════════

// Control de sincronización automática
let autoSyncInterval = null;

// Indicador visual de estado de sync
function updateSyncIndicator(status) {
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  if (!dot || !text) return;

  dot.className = 'sync-dot ' + status;
  const messages = {
    'synced': 'Sincronizado',
    'syncing': 'Sincronizando...',
    'offline': 'Sin conexión (local)',
    'no-config': 'Solo local',
  };
  text.textContent = messages[status] || '';
}

// Guardar en localStorage (cache inmediato)
function saveToLocal() {
  localStorage.setItem('habits-tracker-data', JSON.stringify(state));
}

// Cargar desde localStorage
function loadFromLocal() {
  const saved = localStorage.getItem('habits-tracker-data');
  if (saved) {
    state = JSON.parse(saved);
    return true;
  }
  return false;
}

// Inicializar estado por primera vez
function initializeState() {
  state = {
    habits: {},
    measurements: { ...INITIAL_MEASUREMENTS },
  };
  saveToLocal();
}

// ── Supabase: sync functions ──

// Descargar todo de Supabase → actualizar state
async function syncFromSupabase() {
  if (!db) return false;

  try {
    updateSyncIndicator('syncing');

    // Traer hábitos
    const { data: habitsRows, error: hErr } = await db
      .from('daily_habits')
      .select('date, data');

    if (hErr) throw hErr;

    // Traer mediciones
    const { data: measRows, error: mErr } = await db
      .from('measurements')
      .select('month, data');

    if (mErr) throw mErr;

    // Reconstruir state desde Supabase
    const remoteHabits = {};
    if (habitsRows) {
      for (const row of habitsRows) {
        remoteHabits[row.date] = row.data;
      }
    }

    const remoteMeasurements = {};
    if (measRows) {
      for (const row of measRows) {
        remoteMeasurements[row.month] = row.data;
      }
    }

    // Merge: Supabase tiene prioridad, pero mantenemos datos locales que no existan en remoto
    // (por si se escribieron offline y aún no se subieron)
    const mergedHabits = { ...state.habits };
    for (const [date, data] of Object.entries(remoteHabits)) {
      mergedHabits[date] = { ...(mergedHabits[date] || {}), ...data };
    }

    const mergedMeasurements = { ...state.measurements };
    for (const [month, data] of Object.entries(remoteMeasurements)) {
      mergedMeasurements[month] = { ...(mergedMeasurements[month] || {}), ...data };
    }

    state.habits = mergedHabits;
    state.measurements = mergedMeasurements;

    saveToLocal();
    updateSyncIndicator('synced');
    return true;
  } catch (err) {
    console.error('Error al sincronizar desde Supabase:', err);
    updateSyncIndicator('offline');
    return false;
  }
}

// Subir un día de hábitos a Supabase
async function syncHabitToSupabase(date) {
  if (!db) return;

  try {
    updateSyncIndicator('syncing');
    const data = state.habits[date] || {};

    await db
      .from('daily_habits')
      .upsert({ date, data }, { onConflict: 'date' });

    updateSyncIndicator('synced');
  } catch (err) {
    console.error('Error al subir hábito:', err);
    updateSyncIndicator('offline');
    // Se queda en localStorage, se sincronizará después
  }
}

// Subir una medición a Supabase
async function syncMeasurementToSupabase(month) {
  if (!db) return;

  try {
    updateSyncIndicator('syncing');
    const data = state.measurements[month] || {};

    await db
      .from('measurements')
      .upsert({ month, data }, { onConflict: 'month' });

    updateSyncIndicator('synced');
  } catch (err) {
    console.error('Error al subir medición:', err);
    updateSyncIndicator('offline');
  }
}

// Subir TODO el estado local a Supabase (para import o reset)
async function syncAllToSupabase() {
  if (!db) return;

  try {
    updateSyncIndicator('syncing');

    // Subir todos los hábitos
    const habitRows = Object.entries(state.habits).map(([date, data]) => ({ date, data }));
    if (habitRows.length > 0) {
      await db.from('daily_habits').upsert(habitRows, { onConflict: 'date' });
    }

    // Subir todas las mediciones
    const measRows = Object.entries(state.measurements).map(([month, data]) => ({ month, data }));
    if (measRows.length > 0) {
      await db.from('measurements').upsert(measRows, { onConflict: 'month' });
    }

    updateSyncIndicator('synced');
  } catch (err) {
    console.error('Error al subir todo:', err);
    updateSyncIndicator('offline');
  }
}

// ── Funciones de estado unificadas ──

// Cargar: localStorage primero (instantáneo), luego Supabase en background
async function loadState() {
  const hadLocal = loadFromLocal();
  if (!hadLocal) {
    initializeState();
  }

  // Intentar sync desde Supabase
  if (db) {
    const synced = await syncFromSupabase();
    // Si Supabase está vacío, subir datos iniciales (primera vez)
    if (synced && Object.keys(state.measurements).length > 0) {
      const { data } = await db.from('measurements').select('month').limit(1);
      if (!data || data.length === 0) {
        await syncAllToSupabase();
      }
    }
  }

  // Renderizar siempre (con datos de Supabase o localStorage)
  renderAll();
}

// Guardar hábito: local inmediato + Supabase en background
function saveHabit(date) {
  saveToLocal();
  syncHabitToSupabase(date); // no await — no bloquea la UI
}

// Guardar medición: local inmediato + Supabase en background
function saveMeasurement(month) {
  saveToLocal();
  syncMeasurementToSupabase(month); // no await
}

// ── Lógica de streaks ──

function calcStreak(habitId) {
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(today);

  while (true) {
    const key = dateKey(d);
    const dayData = state.habits[key];
    if (dayData && dayData[habitId]) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function calcMainStreak() {
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(today);

  while (true) {
    const key = dateKey(d);
    const dayData = state.habits[key];
    if (dayData) {
      const allDone = HABITS.every(h => dayData[h.id]);
      if (allDone) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return streak;
}

function calcGymStreak() {
  let streak = 0;
  const thisMonday = getMonday(new Date());
  const checkMonday = new Date(thisMonday);
  checkMonday.setDate(checkMonday.getDate() - 7);

  while (true) {
    const weekDates = getWeekDates(checkMonday);
    let gymDays = 0;
    for (const d of weekDates) {
      const key = dateKey(d);
      if (state.habits[key] && state.habits[key].gym) {
        gymDays++;
      }
    }
    if (gymDays >= GYM_GOAL) {
      streak++;
      checkMonday.setDate(checkMonday.getDate() - 7);
    } else {
      break;
    }
  }
  return streak;
}

function getGymThisWeek() {
  const weekDates = getWeekDates(currentDate);
  let count = 0;
  for (const d of weekDates) {
    const key = dateKey(d);
    if (state.habits[key] && state.habits[key].gym) {
      count++;
    }
  }
  return count;
}

// ── Renderizado ──

function renderHeader() {
  const streak = calcMainStreak();
  const flame = document.getElementById('main-flame');
  const number = document.getElementById('main-streak');
  const subtitle = document.getElementById('header-subtitle');

  number.textContent = streak;

  if (streak === 0) {
    flame.textContent = '❄️';
    flame.className = 'streak-flame cold';
    number.className = 'streak-number cold';
    subtitle.textContent = '¡Empezá hoy!';
  } else if (streak <= 3) {
    flame.textContent = '🔥';
    flame.className = 'streak-flame';
    number.className = 'streak-number';
    subtitle.textContent = '¡Buen inicio!';
  } else if (streak <= 7) {
    flame.textContent = '🔥';
    flame.className = 'streak-flame';
    number.className = 'streak-number';
    subtitle.textContent = '¡Una semana entera!';
  } else if (streak <= 14) {
    flame.textContent = '🔥';
    flame.className = 'streak-flame hot';
    number.className = 'streak-number';
    subtitle.textContent = '¡Imparable!';
  } else {
    flame.textContent = '🔥';
    flame.className = 'streak-flame hot';
    number.className = 'streak-number';
    subtitle.textContent = '¡Leyenda absoluta!';
  }
}

function renderHabits() {
  const container = document.getElementById('habits-list');
  const key = dateKey(currentDate);
  const dayData = state.habits[key] || {};
  const future = isFuture(currentDate);

  document.getElementById('current-date').textContent = formatDateDisplay(currentDate);
  container.innerHTML = '';

  HABITS.forEach(habit => {
    const done = !!dayData[habit.id];
    const streak = calcStreak(habit.id);

    const card = document.createElement('div');
    card.className = `habit-card${done ? ' completed' : ''}`;
    if (future) card.style.opacity = '0.4';

    card.innerHTML = `
      <span class="habit-icon">${habit.icon}</span>
      <div class="habit-info">
        <div class="habit-name">${habit.name}</div>
        <div class="habit-streak-text">${streak > 0 ? `Racha: ${streak} día${streak > 1 ? 's' : ''}` : 'Sin racha activa'}</div>
      </div>
      <span class="habit-streak-badge ${streak > 0 ? 'fire' : 'cold'}">
        ${streak > 0 ? '🔥' + streak : '—'}
      </span>
      <div class="habit-check">${done ? '✓' : ''}</div>
    `;

    if (!future) {
      card.addEventListener('click', () => toggleHabit(habit.id));
    }

    container.appendChild(card);
  });

  const completed = HABITS.filter(h => dayData[h.id]).length;
  const total = HABITS.length;
  document.getElementById('daily-progress-fill').style.width = `${(completed / total) * 100}%`;
  document.getElementById('daily-progress-text').textContent = `${completed}/${total} hábitos`;

  renderGym();
}

function renderGym() {
  const weekDates = getWeekDates(currentDate);
  const dotsContainer = document.getElementById('gym-dots');

  dotsContainer.innerHTML = '';

  weekDates.forEach((d, i) => {
    const key = dateKey(d);
    const isGym = state.habits[key] && state.habits[key].gym;
    const isFut = isFuture(d);

    const dot = document.createElement('div');
    dot.className = `gym-dot${isGym ? ' active' : ''}`;
    if (isFut) dot.style.opacity = '0.3';

    dot.innerHTML = `
      <span class="day-label">${DAYS_SHORT[i]}</span>
      <span class="day-check">✓</span>
    `;

    if (!isFut) {
      dot.addEventListener('click', () => toggleGym(d));
    }

    dotsContainer.appendChild(dot);
  });

  const gymCount = getGymThisWeek();
  document.getElementById('gym-counter').textContent = `${gymCount}/${GYM_GOAL} esta semana`;

  const gymStreak = calcGymStreak();
  const gymStreakEl = document.getElementById('gym-streak');
  if (gymStreak > 0) {
    gymStreakEl.textContent = `🔥 ${gymStreak} semana${gymStreak > 1 ? 's' : ''} consecutiva${gymStreak > 1 ? 's' : ''}`;
  } else {
    gymStreakEl.textContent = 'Sin racha semanal activa';
  }
}

function renderMeasurements() {
  const container = document.getElementById('measurements-grid');
  container.innerHTML = '';

  const measurementDates = Object.keys(state.measurements).sort();
  const latest = measurementDates.length > 0 ? state.measurements[measurementDates[measurementDates.length - 1]] : null;

  MEASUREMENT_DEFS.forEach(def => {
    const card = document.createElement('div');
    card.className = 'measurement-card';

    const currentVal = latest ? latest[def.id] : null;
    const goalVal = def.goal;

    let progressPct = 0;
    let colorClass = 'mid';

    if (currentVal !== null && currentVal !== undefined) {
      if (def.lower) {
        const first = state.measurements[measurementDates[0]] ? state.measurements[measurementDates[0]][def.id] : currentVal;
        const range = first - goalVal;
        if (range > 0) {
          progressPct = Math.max(0, Math.min(100, ((first - currentVal) / range) * 100));
        }
        colorClass = currentVal <= goalVal ? 'good' : currentVal <= goalVal * 1.1 ? 'mid' : 'bad';
      } else {
        const first = state.measurements[measurementDates[0]] ? state.measurements[measurementDates[0]][def.id] : currentVal;
        const range = goalVal - first;
        if (range > 0) {
          progressPct = Math.max(0, Math.min(100, ((currentVal - first) / range) * 100));
        } else if (currentVal >= goalVal) {
          progressPct = 100;
        }
        colorClass = currentVal >= goalVal ? 'good' : currentVal >= goalVal * 0.9 ? 'mid' : 'bad';
      }
    }

    const values = measurementDates.map(date => state.measurements[date][def.id]).filter(v => v != null);
    const maxVal = Math.max(...values, goalVal);
    const minVal = Math.min(...values, goalVal);
    const range = maxVal - minVal || 1;

    let sparklineHTML = '';
    if (values.length > 1) {
      sparklineHTML = '<div class="measurement-sparkline">';
      values.forEach((v, i) => {
        const height = Math.max(10, ((v - minVal) / range) * 100);
        const atGoal = def.lower ? v <= goalVal : v >= goalVal;
        sparklineHTML += `<div class="spark-bar${atGoal ? ' at-goal' : ''}" style="height: ${height}%"></div>`;
      });
      sparklineHTML += '</div>';
    }

    const fmtCurrent = currentVal != null ? String(currentVal).replace('.', ',') : '—';
    const fmtGoal = String(goalVal).replace('.', ',');

    card.innerHTML = `
      <div class="measurement-header">
        <span class="measurement-name">${def.name}</span>
        <span class="measurement-values">
          <span class="measurement-current">${fmtCurrent}${def.unit}</span>
          → Meta: ${fmtGoal}${def.unit}
        </span>
      </div>
      <div class="measurement-bar">
        <div class="measurement-bar-fill ${colorClass}" style="width: ${progressPct}%"></div>
      </div>
      <div class="measurement-meta">
        <span>${measurementDates.length > 0 ? formatMonthLabel(measurementDates[0]) : ''}</span>
        <span>${progressPct.toFixed(0)}% hacia la meta</span>
      </div>
      ${sparklineHTML}
    `;

    container.appendChild(card);
  });

  const monthInput = document.getElementById('m-month');
  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTHS_ES[parseInt(m) - 1].substring(0, 3)} ${y}`;
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const monthLabel = document.getElementById('calendar-month');
  const stats = document.getElementById('calendar-stats');

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  monthLabel.textContent = `${MONTHS_ES[month]} ${year}`;
  grid.innerHTML = '';

  DAYS_SHORT.forEach(day => {
    const cell = document.createElement('div');
    cell.className = 'calendar-header-cell';
    cell.textContent = day;
    grid.appendChild(cell);
  });

  const firstDay = new Date(year, month, 1);
  let startDay = firstDay.getDay();
  startDay = startDay === 0 ? 6 : startDay - 1;

  for (let i = 0; i < startDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell empty';
    grid.appendChild(cell);
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let allCount = 0, partialCount = 0, noneCount = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const key = dateKey(d);
    const dayData = state.habits[key] || {};
    const isFut = d > today;

    const completedCount = HABITS.filter(h => dayData[h.id]).length;
    let cellClass = 'calendar-cell';

    if (isFut) {
      cellClass += ' future';
    } else if (completedCount === HABITS.length && completedCount > 0) {
      cellClass += ' all';
      allCount++;
    } else if (completedCount > 0) {
      cellClass += ' partial';
      partialCount++;
    } else {
      cellClass += ' none';
      if (d <= today) noneCount++;
    }

    if (isToday(d)) cellClass += ' today';

    const cell = document.createElement('div');
    cell.className = cellClass;
    cell.textContent = day;

    if (!isFut) {
      cell.addEventListener('click', () => {
        currentDate = new Date(year, month, day);
        switchView('habits');
        renderAll();
      });
    }

    grid.appendChild(cell);
  }

  stats.innerHTML = `
    <div>
      <div class="cal-stat-value good">${allCount}</div>
      <div class="cal-stat-label">Días perfectos</div>
    </div>
    <div>
      <div class="cal-stat-value mid">${partialCount}</div>
      <div class="cal-stat-label">Días parciales</div>
    </div>
    <div>
      <div class="cal-stat-value bad">${noneCount}</div>
      <div class="cal-stat-label">Días perdidos</div>
    </div>
  `;
}

function renderAll() {
  renderHeader();
  renderHabits();
  renderMeasurements();
  renderCalendar();
}

// ── Acciones ──

function toggleHabit(habitId) {
  const key = dateKey(currentDate);
  if (!state.habits[key]) state.habits[key] = {};
  state.habits[key][habitId] = !state.habits[key][habitId];
  saveHabit(key);
  renderAll();

  const dayData = state.habits[key];
  const allDone = HABITS.every(h => dayData[h.id]);
  if (allDone) celebrate();
}

function toggleGym(d) {
  const key = dateKey(d);
  if (!state.habits[key]) state.habits[key] = {};
  state.habits[key].gym = !state.habits[key].gym;
  saveHabit(key);
  renderAll();
}

function celebrate() {
  const emojis = ['🎉', '⭐', '💪', '🔥', '🏆', '✨'];
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'celebration';
      el.textContent = emojis[i % emojis.length];
      el.style.left = `${20 + Math.random() * 60}%`;
      el.style.animationDelay = `${Math.random() * 0.3}s`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2000);
    }, i * 100);
  }
}

// ── Navegación ──

function switchView(viewId) {
  if (viewId === 'settings') {
    document.getElementById('modal-settings').classList.add('open');
    return;
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-view="${viewId}"]`).classList.add('active');
}

// ── Export / Import ──

function exportData() {
  const dataStr = JSON.stringify(state, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `habits-backup-${dateKey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported.habits && imported.measurements) {
        state = imported;
        saveToLocal();
        syncAllToSupabase(); // subir todo al remoto
        renderAll();
        alert('Datos importados correctamente');
      } else {
        alert('El archivo no tiene el formato correcto');
      }
    } catch {
      alert('Error al leer el archivo');
    }
  };
  reader.readAsText(file);
}

// ── Inicialización ──

async function init() {
  // Inicializar Supabase si hay configuración
  if (SUPABASE_URL && SUPABASE_ANON_KEY && typeof window.supabase !== 'undefined') {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    updateSyncIndicator('syncing');
  } else {
    updateSyncIndicator('no-config');
  }

  // Cargar datos (local primero, luego Supabase)
  await loadState();

  // Navegación inferior
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Navegación de fecha
  document.getElementById('prev-day').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 1);
    renderAll();
  });

  document.getElementById('next-day').addEventListener('click', () => {
    if (!isFuture(currentDate)) {
      currentDate.setDate(currentDate.getDate() + 1);
      renderAll();
    }
  });

  // Navegación de calendario
  document.getElementById('prev-month').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();
  });

  // Modal medición
  document.getElementById('btn-add-measurement').addEventListener('click', () => {
    document.getElementById('modal-measurement').classList.add('open');
  });

  document.getElementById('btn-close-measurement').addEventListener('click', () => {
    document.getElementById('modal-measurement').classList.remove('open');
  });

  document.getElementById('form-measurement').addEventListener('submit', (e) => {
    e.preventDefault();
    const month = document.getElementById('m-month').value;
    const data = {};

    MEASUREMENT_DEFS.forEach(def => {
      const val = document.getElementById(`m-${def.id}`).value;
      if (val) data[def.id] = parseFloat(val);
    });

    if (Object.keys(data).length > 0) {
      state.measurements[month] = { ...(state.measurements[month] || {}), ...data };
      saveMeasurement(month);
      renderMeasurements();
      document.getElementById('modal-measurement').classList.remove('open');
      document.getElementById('form-measurement').reset();
    }
  });

  // Modal settings
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('modal-settings').classList.remove('open');
  });

  // Cerrar modales al hacer clic fuera
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', exportData);

  // Import
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });

  document.getElementById('file-import').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      importData(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Reset
  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (confirm('¿Estás segura? Se borrarán TODOS los datos. Hacé un export primero si querés guardarlos.')) {
      localStorage.removeItem('habits-tracker-data');
      state = { habits: {}, measurements: { ...INITIAL_MEASUREMENTS } };
      saveToLocal();

      // Limpiar Supabase
      if (db) {
        try {
          await db.from('daily_habits').delete().neq('date', '');
          await db.from('measurements').delete().neq('month', '');
          // Subir mediciones iniciales
          await syncAllToSupabase();
        } catch (err) {
          console.error('Error al limpiar Supabase:', err);
        }
      }

      renderAll();
      document.getElementById('modal-settings').classList.remove('open');
    }
  });

  // Re-sincronizar cuando la app vuelve a estar en foco (por si se editó en otro dispositivo)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && db) {
      syncFromSupabase().then(() => renderAll());
    }
  });

  // Polling automático: sincronizar cada 10 segundos si hay Supabase configurado
  if (db) {
    autoSyncInterval = setInterval(() => {
      if (!document.hidden) { // Solo si la app está visible
        syncFromSupabase().then(() => renderAll());
      }
    }, 10000); // 10 segundos
  }

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
