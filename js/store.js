// Local-only storage. Everything lives in this browser's localStorage.

const KEY = 'peptide-log-v1';
const COLLECTIONS = ['compounds', 'vials', 'protocols', 'doses', 'checkins', 'labs'];

// Same key as the old Peptide Log so existing logs carry over after the rename.
const VERSION = 2;

const empty = () => ({
  version: VERSION,
  compounds: [],
  vials: [],
  protocols: [],
  doses: [],
  checkins: [], // one per day: weight, BP readings, night sweats, notes
  labs: [], // lab panels: date, label, fasted, notes, results[]
  settings: { syringe: 'U-100', syringeMl: 1, weightUnit: 'lb', lastSummaryTo: '' },
});

// v1 (Peptide Log) had no checkins/labs; filling the missing arrays is the
// whole migration. Anything unknown is kept as-is.
function migrate(data) {
  const base = empty();
  const out = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  for (const k of COLLECTIONS) if (!Array.isArray(out[k])) out[k] = [];
  out.version = VERSION;
  return out;
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed(empty());
    return migrate(JSON.parse(raw));
  } catch {
    return seed(empty());
  }
}

// A few common entries so the app isn't blank on first open.
function seed(s) {
  const add = (name, category, defaultDose, defaultUnit, route) =>
    s.compounds.push({ id: uid(), name, category, defaultDose, defaultUnit, route, notes: '' });
  add('BPC-157', 'peptide', 250, 'mcg', 'SubQ');
  add('TB-500', 'peptide', 2.5, 'mg', 'SubQ');
  add('L-Glutamine', 'amino', 5, 'g', 'Oral');
  return s;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save: storage is full or blocked.');
  }
  listeners.forEach((fn) => fn(state));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const get = () => state;
export const subscribe = (fn) => listeners.add(fn);

export function upsert(collection, item) {
  if (!COLLECTIONS.includes(collection)) throw new Error(collection);
  const list = state[collection];
  if (!item.id) item.id = uid();
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = { ...list[i], ...item };
  else list.push(item);
  persist();
  return item;
}

export function remove(collection, id) {
  state[collection] = state[collection].filter((x) => x.id !== id);
  // Clean up references so nothing points at a deleted record.
  if (collection === 'compounds') {
    state.vials = state.vials.filter((v) => v.compoundId !== id);
    state.protocols = state.protocols.filter((p) => p.compoundId !== id);
  }
  if (collection === 'vials') {
    state.doses.forEach((d) => { if (d.vialId === id) d.vialId = ''; });
    state.protocols.forEach((p) => { if (p.vialId === id) p.vialId = ''; });
  }
  persist();
}

export function byId(collection, id) {
  return state[collection].find((x) => x.id === id);
}

export function setSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist();
}

export function exportJson() {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.doses) || !Array.isArray(data.compounds)) {
    throw new Error('That file is not a Dialed-In / Peptide Log backup.');
  }
  state = migrate(data);
  persist();
}

// Add records from a file without touching what's already here. Records whose
// id already exists are skipped; a check-in for a day that already has one is
// skipped too. Returns counts of what was added.
export function mergeJson(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object') throw new Error('That file has nothing to import.');
  const added = {};
  for (const k of COLLECTIONS) {
    if (!Array.isArray(data[k])) continue;
    const ids = new Set(state[k].map((x) => x.id));
    const days = k === 'checkins' ? new Set(state.checkins.map((x) => x.date)) : null;
    let n = 0;
    for (const item of data[k]) {
      if (!item || typeof item !== 'object') continue;
      if (item.id && ids.has(item.id)) continue;
      if (days && days.has(item.date)) continue;
      state[k].push({ ...item, id: item.id || uid() });
      if (days) days.add(item.date);
      n++;
    }
    if (n) added[k] = n;
  }
  persist();
  return added;
}

export function checkinFor(date) {
  return state.checkins.find((c) => c.date === date);
}

export function clearAll() {
  state = empty();
  persist();
}
