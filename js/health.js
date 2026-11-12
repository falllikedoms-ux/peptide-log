// Pure helpers for body tracking: blood pressure, weight trend, injection-site
// rotation, lab parsing and the text summary. No DOM, no storage: tested in
// tests/health.test.mjs.

import { parseYmd, ymd, fmt } from './calc.js';

const num = (x) => (x === '' || x === null || x === undefined ? NaN : Number(x));
const valid = (r) => r && Number.isFinite(num(r.sys)) && Number.isFinite(num(r.dia)) && num(r.sys) > 0 && num(r.dia) > 0;

// Average of the readings given (optionally only one period: 'am' or 'pm').
export function bpAverage(readings = [], period) {
  const list = readings.filter((r) => valid(r) && (!period || r.period === period));
  if (!list.length) return null;
  const avg = (k) => list.reduce((s, r) => s + num(r[k]), 0) / list.length;
  const hrs = list.filter((r) => Number.isFinite(num(r.hr)) && num(r.hr) > 0);
  return {
    sys: avg('sys'),
    dia: avg('dia'),
    hr: hrs.length ? hrs.reduce((s, r) => s + num(r.hr), 0) / hrs.length : null,
    n: list.length,
  };
}

export function bpText(a) {
  if (!a) return '';
  return `${fmt(a.sys, 1)}/${fmt(a.dia, 1)}${a.hr ? ` · ${fmt(a.hr, 1)} bpm` : ''}`;
}

// Fasted weights sorted by date, each with a rolling average over the
// previous `window` days (inclusive).
export function weightTrend(checkins = [], { window = 7, fastedOnly = true } = {}) {
  const pts = checkins
    .filter((c) => Number.isFinite(num(c.weight)) && num(c.weight) > 0 && (!fastedOnly || c.fasted))
    .map((c) => ({ date: c.date, weight: num(c.weight) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return pts.map((p) => {
    const start = addDays(p.date, -(window - 1));
    const inWin = pts.filter((q) => q.date >= start && q.date <= p.date);
    return { ...p, avg: inWin.reduce((s, q) => s + q.weight, 0) / inWin.length };
  });
}

export function addDays(d, n) {
  const x = parseYmd(d);
  x.setDate(x.getDate() + n);
  return ymd(x);
}

// For each site, days since it was last used (null = never). Suggests the
// site that has rested longest among `rotation` (defaults to all sites given).
export function siteRotation(doses = [], sites = [], today, rotation = sites) {
  const last = new Map();
  for (const d of doses) {
    if (!d.site || d.date > today) continue;
    if (!last.has(d.site) || d.date > last.get(d.site)) last.set(d.site, d.date);
  }
  const rows = sites.map((site) => {
    const date = last.get(site) || null;
    const days = date ? Math.round((parseYmd(today) - parseYmd(date)) / 86_400_000) : null;
    return { site, date, days };
  });
  let suggest = null;
  for (const r of rows) {
    if (!rotation.includes(r.site)) continue;
    if (!suggest) { suggest = r; continue; }
    const a = r.days === null ? Infinity : r.days;
    const b = suggest.days === null ? Infinity : suggest.days;
    if (a > b) suggest = r;
  }
  return { rows, suggest: suggest?.site ?? null };
}

// "Hct 44 %" / "Creatinine: 1.1 mg/dL H" / "AST/ALT 22/30 U/L" → results.
export function parseLabLines(text = '') {
  const out = [];
  for (const raw of String(text).split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.+?)[:=]?\s+(<|>)?(-?\d+(?:\.\d+)?)(?:\s*\/\s*(-?\d+(?:\.\d+)?))?\s*([^\s]*?)?\s*(\b(?:H|L|HIGH|LOW)\b)?$/i);
    if (!m) { out.push({ marker: line, value: '', unit: '', flag: '' }); continue; }
    const [, name, cmp, v1, v2, unitRaw, flagRaw] = m;
    let unit = unitRaw || '';
    let flag = flagRaw ? flagRaw[0].toUpperCase() : '';
    if (!flag && /^(H|L)$/i.test(unit)) { flag = unit.toUpperCase(); unit = ''; }
    const names = name.trim().replace(/:$/, '');
    if (v2 !== undefined && names.includes('/')) {
      const [a, b] = names.split('/').map((s) => s.trim());
      out.push({ marker: a, value: Number(v1), unit, flag: '' });
      out.push({ marker: b, value: Number(v2), unit, flag: '' });
    } else {
      out.push({ marker: names, value: Number(v1), unit, flag, ...(cmp ? { cmp } : {}) });
    }
  }
  return out;
}

export function labLines(results = []) {
  return results.map((r) => [r.marker, `${r.cmp || ''}${r.value}`, r.unit, r.flag].filter((x) => x !== '' && x !== undefined).join(' ')).join('\n');
}

// Markers as rows, panels (oldest first) as columns.
export function labMatrix(panels = []) {
  const sorted = [...panels].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const markers = [];
  const seen = new Map();
  for (const p of sorted) {
    for (const r of p.results || []) {
      const key = r.marker.toLowerCase();
      if (!seen.has(key)) { seen.set(key, r.marker); markers.push(key); }
    }
  }
  return {
    panels: sorted,
    rows: markers.map((key) => ({
      marker: seen.get(key),
      unit: sorted.flatMap((p) => p.results || []).find((r) => r.marker.toLowerCase() === key && r.unit)?.unit || '',
      values: sorted.map((p) => (p.results || []).find((r) => r.marker.toLowerCase() === key) || null),
    })),
  };
}

const SWEAT = { dry: 'dry', sweat: 'sweats' };

// Plain-text summary of a date range, meant to be pasted into a chat.
export function buildSummary(state, { from, to, appName = 'Dialed-In' }) {
  const name = (id) => state.compounds.find((c) => c.id === id)?.name ?? 'Unknown';
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const lines = [`${appName} summary ${from} to ${to}`, ''];

  for (const d of days) {
    const c = state.checkins.find((x) => x.date === d);
    const doses = state.doses.filter((x) => x.date === d).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (!c && !doses.length) continue;
    const dt = parseYmd(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    lines.push(`## ${dt} (${d})`);
    if (c) {
      if (c.weight) lines.push(`- Weight: ${c.weight} ${state.settings?.weightUnit || 'lb'}${c.fasted ? ' (fasted)' : ' (not fasted)'}${c.weightTime ? ` at ${c.weightTime}` : ''}`);
      for (const period of ['am', 'pm']) {
        const rs = (c.readings || []).filter((r) => r.period === period && valid(r));
        if (!rs.length) continue;
        const each = rs.map((r) => `${r.sys}/${r.dia}${r.hr ? `/${r.hr}` : ''}`).join(' and ');
        const a = bpAverage(rs);
        lines.push(`- ${period.toUpperCase()} BP/HR: ${each}${rs.length > 1 ? ` (avg ${bpText(a)})` : ''}${rs[0].time ? ` at ${rs[0].time}` : ''}`);
      }
      if (c.sweat) lines.push(`- Night sweats (last night): ${SWEAT[c.sweat] || c.sweat}`);
      if (c.notes) lines.push(`- Notes: ${c.notes}`);
    }
    for (const x of doses) {
      const bits = [`${fmt(x.amount, 3)} ${x.unit}`];
      if (x.units) bits.push(`${fmt(x.units, 1)} units`);
      if (x.route) bits.push(x.route);
      if (x.site) bits.push(x.site);
      bits.push(x.reaction && x.reaction !== 'none' ? `reaction: ${x.reaction}` : 'no reaction');
      lines.push(`- Dose${x.time ? ` ${x.time}` : ''}: ${name(x.compoundId)} ${bits.join(', ')}${x.notes ? ` (${x.notes})` : ''}`);
    }
    lines.push('');
  }

  const newLabs = (state.labs || []).filter((p) => p.date >= from && p.date <= to);
  for (const p of newLabs) {
    lines.push(`## Labs ${p.date}${p.label ? ` (${p.label})` : ''}${p.fasted ? ', fasted' : ''}`);
    if (p.notes) lines.push(`- ${p.notes}`);
    for (const r of p.results || []) lines.push(`- ${r.marker}: ${r.cmp || ''}${r.value}${r.unit ? ` ${r.unit}` : ''}${r.flag ? ` ${r.flag}` : ''}`);
    lines.push('');
  }

  const trend = weightTrend(state.checkins).filter((p) => p.date >= from && p.date <= to);
  const bpAll = state.checkins.filter((c) => c.date >= from && c.date <= to).flatMap((c) => c.readings || []);
  const am = bpAverage(bpAll, 'am');
  const pm = bpAverage(bpAll, 'pm');
  if (trend.length || am || pm) {
    lines.push('## Range averages');
    if (trend.length) {
      const avg = trend.reduce((s, p) => s + p.weight, 0) / trend.length;
      lines.push(`- Fasted weight: ${fmt(avg, 1)} avg over ${trend.length} weigh-in${trend.length === 1 ? '' : 's'} (first ${trend[0].weight}, last ${trend[trend.length - 1].weight})`);
    }
    if (am) lines.push(`- AM BP: ${bpText(am)} (${am.n} readings)`);
    if (pm) lines.push(`- PM BP: ${bpText(pm)} (${pm.n} readings)`);
  }
  if (lines.length <= 2) lines.push('Nothing logged in this range.');
  return lines.join('\n').trim() + '\n';
}
