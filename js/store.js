// Local-only storage. Everything lives in this browser's localStorage.

const KEY = 'peptide-log-v1';

const empty = () => ({
  version: 1,
  compounds: [],
  vials: [],
  protocols: [],
  doses: [],
  settings: { syringe: 'U-100', syringeMl: 1, weightUnit: 'lb' },
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed(empty());
    const data = JSON.parse(raw);
    const base = empty();
    return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
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

const COLLECTIONS = ['compounds', 'vials', 'protocols', 'doses'];

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
    throw new Error('That file is not a Peptide Log backup.');
  }
  const base = empty();
  state = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  persist();
}

export function clearAll() {
  state = empty();
  persist();
}
