import * as store from './store.js';
import {
  reconstitute, doseFromUnits, waterForTarget, weightBasedDose, vialDuration,
  isScheduledOn, cyclePhase, dosesPerWeek, vialRemaining, vialAge,
  ymd, parseYmd, fmt, fmtBase, toBase, sameKind, unitsPerMl,
} from './calc.js';
import {
  bpAverage, bpText, weightTrend, siteRotation, parseLabLines, labLines, labMatrix, buildSummary,
} from './health.js';

const APP = 'Dialed-In';

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => ymd(new Date());
const nowTime = () => new Date().toTimeString().slice(0, 5);
const S = () => store.get();

const CATEGORIES = { peptide: 'Peptide', hormone: 'Hormone', sarm: 'SARM', amino: 'Amino', other: 'Other' };
const DOSE_UNITS = ['mcg', 'mg', 'g', 'IU', 'mL', 'caps', 'tabs'];
const VIAL_UNITS = ['mg', 'mcg', 'IU'];
const ROUTES = ['SubQ', 'IM', 'Oral', 'Nasal', 'Topical', 'Other'];
const SITES = [
  'Abdomen upper L', 'Abdomen upper R', 'Abdomen lower L', 'Abdomen lower R',
  'Glute L', 'Glute R', 'Ventroglute L', 'Ventroglute R', 'Thigh L', 'Thigh R', 'Deltoid L', 'Deltoid R', 'Other',
];
const SUBQ_ROTATION = SITES.slice(0, 4);
const IM_ROTATION = ['Glute L', 'Glute R', 'Ventroglute L', 'Ventroglute R', 'Thigh L', 'Thigh R', 'Deltoid L', 'Deltoid R'];
const REACTIONS = [['none', 'None'], ['redness', 'Redness'], ['itch', 'Itch'], ['swelling', 'Swelling'], ['lump', 'Lump'], ['sore', 'Sore / pain'], ['other', 'Other (see notes)']];
const RED_FLAGS = 'Spreading redness, warmth, increasing pain, a hard painful lump or fever: get it checked.';
// Keep a value that isn't in a list (e.g. an old site name) selectable.
const withValue = (list, v) => (v && !list.some((x) => (Array.isArray(x) ? x[0] : x) === v) ? [...list, v] : list);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const compoundName = (id) => store.byId('compounds', id)?.name ?? 'Unknown';
const options = (list, selected) => list.map((v) => {
  const [value, label] = Array.isArray(v) ? v : [v, v];
  return `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label || '—')}</option>`;
}).join('');

function prettyDate(d) {
  const t = today();
  if (d === t) return 'Today';
  const diff = Math.round((parseYmd(d) - parseYmd(t)) / 86_400_000);
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return parseYmd(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: parseYmd(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function addDays(d, n) {
  const x = parseYmd(d);
  x.setDate(x.getDate() + n);
  return ymd(x);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function vialLabel(v) {
  const c = compoundName(v.compoundId);
  const r = vialRemaining(v, S().doses);
  return `${c} · ${fmt(v.amount)} ${v.unit} vial (${fmtBase(r.left, r.baseUnit)} left)`;
}

// Units to draw for a dose from a given vial.
function drawUnits(vial, amount, unit) {
  if (!vial || !vial.waterMl || !sameKind(vial.unit, unit)) return null;
  const r = reconstitute({
    vialAmount: vial.amount, vialUnit: vial.unit, waterMl: vial.waterMl,
    dose: amount, doseUnit: unit, syringe: S().settings.syringe,
  });
  return r.units ?? null;
}

function protocolLabel(p) {
  return p.name || compoundName(p.compoundId);
}

function freqText(p) {
  let f = '';
  if (p.frequency === 'daily') f = 'Daily';
  else if (p.frequency === 'everyN') f = Number(p.everyN) === 2 ? 'Every other day' : `Every ${p.everyN} days`;
  else if (p.frequency === 'weekdays') f = (p.weekdays || []).map((d) => WEEKDAYS[d]).join('/') || 'No days picked';
  if ((p.times || []).length > 1) f += ` · ${p.times.length}× (${p.times.join(', ')})`;
  else if ((p.times || []).length === 1) f += ` at ${p.times[0]}`;
  if (Number(p.weeksOn) > 0 && Number(p.weeksOff) > 0) f += ` · ${p.weeksOn} wk on / ${p.weeksOff} wk off`;
  return f;
}

// ---------- router ----------

const ui = {
  tab: 'today',
  date: today(),
  calcMode: 'recon',
  calc: { vialAmount: 5, vialUnit: 'mg', waterMl: 2, dose: 250, doseUnit: 'mcg', units: 10, targetUnits: 10, perKg: 2, weight: '', dosesPerWeek: 7 },
  historyFilter: { category: '', compoundId: '' },
  showFinished: false,
  bodyRange: 30,
  stackView: 'cycles',
};

const TITLES = { today: 'Today', body: 'Body & labs', calc: 'Calculator', history: 'History', stack: 'Stack' };
const VIEWS = { today: viewToday, body: viewBody, calc: viewCalc, history: viewHistory, stack: viewStack };

function render() {
  $('#title').textContent = TITLES[ui.tab];
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  $('#view').innerHTML = VIEWS[ui.tab]();
  if (ui.tab === 'calc') updateCalc();
  document.title = `${TITLES[ui.tab]} · ${APP}`;
}

function go(tab) {
  ui.tab = VIEWS[tab] ? tab : 'today';
  try { localStorage.setItem('peptide-log-tab', tab); } catch { /* ignore */ }
  render();
  window.scrollTo(0, 0);
}

// ---------- Today ----------

function scheduledItems(date) {
  const items = [];
  for (const p of S().protocols) {
    if (p.active === false) continue;
    if (!isScheduledOn(p, date)) continue;
    const times = (p.times && p.times.length) ? p.times : [''];
    times.forEach((time, slot) => {
      const done = S().doses.find((d) => d.protocolId === p.id && d.date === date && Number(d.slot || 0) === slot);
      items.push({ p, time, slot, done });
    });
  }
  return items.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}

function alerts() {
  const out = [];
  const t = today();
  const recent = S().doses.filter((x) => x.reaction && x.reaction !== 'none' && x.date >= addDays(t, -2) && x.date <= t);
  if (recent.length) {
    const r = recent.sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push(`Site reaction logged ${esc(prettyDate(r.date).toLowerCase())} (${esc(reactionLabel(r.reaction))}${r.site ? `, ${esc(r.site)}` : ''}). ${esc(RED_FLAGS)}`);
  }
  for (const v of S().vials) {
    if (v.finished) continue;
    const age = vialAge(v, t);
    const r = vialRemaining(v, S().doses);
    const name = compoundName(v.compoundId);
    if (age?.expired) out.push(`${esc(name)} vial was mixed ${age.age} days ago (use-by ${age.limit} days).`);
    else if (age && age.daysLeft !== null && age.daysLeft <= 3) out.push(`${esc(name)} vial reaches its use-by window in ${age.daysLeft} day${age.daysLeft === 1 ? '' : 's'}.`);
    if (r.total > 0 && r.left / r.total <= 0.15) out.push(`${esc(name)} vial is low: ${fmtBase(r.left, r.baseUnit)} left.`);
  }
  return out;
}

function viewToday() {
  const d = ui.date;
  const sched = scheduledItems(d);
  const offProtocols = S().protocols.filter((p) => p.active !== false && cyclePhase(p, d).phase === 'off');
  const other = S().doses.filter((x) => x.date === d && !sched.some((s) => s.done?.id === x.id))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const al = d === today() ? alerts() : [];

  return `
    <div class="datenav">
      <button class="ghost" data-action="day" data-n="-1" aria-label="Previous day">‹</button>
      <button class="ghost date-label" data-action="day" data-n="0">${esc(prettyDate(d))}</button>
      <button class="ghost" data-action="day" data-n="1" aria-label="Next day">›</button>
    </div>

    ${al.length ? `<div class="card warn">${al.map((a) => `<div>⚠ ${a}</div>`).join('')}</div>` : ''}

    ${checkinCard(d)}

    <section>
      <h2>Scheduled</h2>
      ${sched.length ? sched.map(({ p, time, slot, done }) => {
        const vial = store.byId('vials', p.vialId);
        const units = drawUnits(vial, p.dose, p.unit);
        const ph = cyclePhase(p, d);
        return `
        <div class="card row ${done ? 'done' : ''}">
          <div class="grow">
            <div class="strong">${esc(protocolLabel(p))}</div>
            <div class="muted">${esc(fmt(p.dose))} ${esc(p.unit)}${units !== null ? ` · <b>${fmt(units, 1)} units</b>` : ''}${time ? ` · ${esc(time)}` : ''}</div>
            ${ph.of ? `<div class="muted small">On-phase day ${ph.day} of ${ph.of}${ph.cycleNumber > 1 ? ` (round ${ph.cycleNumber})` : ''}</div>` : ''}
          </div>
          ${done
            ? `<button class="chip ok" data-action="edit-dose" data-id="${done.id}">✓ ${esc(done.time || 'Done')}</button>`
            : `<button class="primary sm" data-action="log-scheduled" data-id="${p.id}" data-slot="${slot}">Log</button>`}
        </div>`;
      }).join('') : `<p class="empty">Nothing scheduled${S().protocols.length ? '' : '. Set up a protocol in Stack → Protocols and it shows up here.'}</p>`}
      ${offProtocols.length ? `<p class="muted small">On break: ${offProtocols.map((p) => esc(protocolLabel(p))).join(', ')}</p>` : ''}
    </section>

    <section>
      <h2>Other doses logged</h2>
      ${other.length ? other.map(doseRow).join('') : '<p class="empty">None.</p>'}
    </section>

    <button class="fab" data-action="new-dose" aria-label="Log a dose">+ Log dose</button>
  `;
}

function doseRow(x) {
  const c = store.byId('compounds', x.compoundId);
  return `
    <button class="card row as-btn" data-action="edit-dose" data-id="${x.id}">
      <div class="time">${esc(x.time || '')}</div>
      <div class="grow">
        <div class="strong">${esc(c?.name ?? 'Unknown')} ${c ? `<span class="tag ${esc(c.category)}">${esc(CATEGORIES[c.category] || '')}</span>` : ''}</div>
        <div class="muted">${esc(fmt(x.amount, 3))} ${esc(x.unit)}${x.units ? ` · ${fmt(x.units, 1)} units` : ''}${x.route ? ` · ${esc(x.route)}` : ''}${x.site ? ` · ${esc(x.site)}` : ''}</div>
        ${x.reaction && x.reaction !== 'none' ? `<div class="small warn-inline">Reaction: ${esc(reactionLabel(x.reaction))}</div>` : ''}
        ${x.notes ? `<div class="muted small">${esc(x.notes)}</div>` : ''}
      </div>
    </button>`;
}

// ---------- Dose form ----------

function openDoseForm(dose = {}) {
  const s = S();
  if (!s.compounds.length) {
    toast('Add a compound first');
    openCompoundForm();
    return;
  }
  const isNew = !dose.id;
  const c = store.byId('compounds', dose.compoundId) || s.compounds[0];
  const d = {
    compoundId: c.id, amount: c.defaultDose ?? '', unit: c.defaultUnit || 'mcg', route: c.route || 'SubQ',
    date: ui.date, time: nowTime(), site: '', reaction: 'none', notes: '', vialId: '', ...dose,
  };
  if (isNew && !dose.vialId) {
    const v = s.vials.find((x) => !x.finished && x.compoundId === d.compoundId);
    if (v) d.vialId = v.id;
  }

  openModal(isNew ? 'Log dose' : 'Edit dose', `
    <label>Compound
      <select name="compoundId" data-live="dose">${options(s.compounds.map((x) => [x.id, x.name]), d.compoundId)}</select>
    </label>
    <label>From vial <span class="muted small">(optional, tracks what's left)</span>
      <select name="vialId" data-live="dose"></select>
    </label>
    <div class="grid2">
      <label>Amount<input name="amount" type="number" inputmode="decimal" step="any" min="0" required value="${esc(d.amount)}" data-live="dose"></label>
      <label>Unit<select name="unit" data-live="dose">${options(DOSE_UNITS, d.unit)}</select></label>
    </div>
    <div class="callout" id="dose-units"></div>
    <div class="grid2">
      <label>Date<input name="date" type="date" required value="${esc(d.date)}"></label>
      <label>Time<input name="time" type="time" value="${esc(d.time)}"></label>
    </div>
    <div class="grid2">
      <label>Route<select name="route" data-live="dose">${options(ROUTES, d.route)}</select></label>
      <label>Site<select name="site">${options(withValue([['', '—'], ...SITES], d.site), d.site)}</select></label>
    </div>
    <div class="muted small" id="site-hint"></div>
    <label>Reaction<select name="reaction">${options(REACTIONS, d.reaction || 'none')}</select></label>
    <label>Notes<textarea name="notes" rows="2">${esc(d.notes)}</textarea></label>
  `, {
    onSubmit(f) {
      const vial = store.byId('vials', f.vialId);
      const amount = Number(f.amount);
      store.upsert('doses', {
        ...dose, compoundId: f.compoundId, vialId: f.vialId, amount, unit: f.unit,
        units: drawUnits(vial, amount, f.unit) ?? undefined,
        date: f.date, time: f.time, route: f.route, site: f.site, reaction: f.reaction, notes: f.notes.trim(),
      });
      toast(isNew ? 'Dose logged' : 'Dose saved');
      if (f.reaction && f.reaction !== 'none') setTimeout(() => toast(RED_FLAGS), 2300);
    },
    onDelete: isNew ? null : () => { store.remove('doses', dose.id); toast('Dose deleted'); },
    onLive(form, changed) {
      if (changed === 'compoundId') {
        const cc = store.byId('compounds', form.compoundId.value);
        if (cc) {
          if (cc.defaultDose) form.amount.value = cc.defaultDose;
          if (cc.defaultUnit) form.unit.value = cc.defaultUnit;
          if (cc.route) form.route.value = cc.route;
        }
      }
      if (['init', 'compoundId', 'route'].includes(changed)) {
        const route = form.route.value;
        const rot = route === 'IM' ? IM_ROTATION : route === 'SubQ' ? SUBQ_ROTATION : null;
        const hint = $('#site-hint');
        if (rot) {
          const others = S().doses.filter((x) => x.id !== dose.id);
          const { rows, suggest } = siteRotation(others, SITES, form.date.value || today(), rot);
          const last = rows.filter((r) => rot.includes(r.site) && r.days !== null).sort((a, b) => a.days - b.days)[0];
          hint.innerHTML = `${suggest ? `Rested longest: <b>${esc(suggest)}</b>` : ''}${last ? ` · last used ${esc(last.site)} ${last.days === 0 ? 'today' : `${last.days}d ago`}` : ''}`;
          if (isNew && suggest && (changed !== 'init' || !form.site.value)) form.site.value = suggest;
        } else hint.textContent = '';
      }
      if (changed === 'compoundId' || changed === 'init') {
        const vials = S().vials.filter((v) => v.compoundId === form.compoundId.value && (!v.finished || v.id === d.vialId));
        const keep = changed === 'init' ? d.vialId : (vials[0]?.id ?? '');
        form.vialId.innerHTML = options([['', 'None'], ...vials.map((v) => [v.id, vialLabel(v)])], keep);
      }
      const vial = store.byId('vials', form.vialId.value);
      const u = drawUnits(vial, form.amount.value, form.unit.value);
      const box = $('#dose-units');
      if (u !== null) {
        box.innerHTML = `Draw <b>${fmt(u, 1)} units</b> on a ${esc(S().settings.syringe)} syringe (${fmt(u / unitsPerMl(S().settings.syringe), 3)} mL)`;
        box.hidden = false;
      } else if (vial && !sameKind(vial.unit, form.unit.value)) {
        box.textContent = `This vial is measured in ${vial.unit}; pick a matching unit to work out the draw.`;
        box.hidden = false;
      } else box.hidden = true;
    },
  });
}

// ---------- Calculator ----------

const CALC_MODES = [
  ['recon', 'Reconstitution'],
  ['units', 'Units → dose'],
  ['water', 'How much water'],
  ['weight', 'Per body weight'],
  ['duration', 'Vial duration'],
];

function viewCalc() {
  const c = ui.calc;
  if (c.weight === '' || c.weight === undefined) {
    const w = weightTrend(S().checkins).at(-1);
    if (w) { c.weight = w.weight; c.weightUnit = S().settings.weightUnit; }
  }
  const s = S().settings;
  const vials = S().vials.filter((v) => !v.finished && v.waterMl);
  const vialFields = `
    ${vials.length ? `<label>Fill from a saved vial<select data-calc-vial>${options([['', 'Choose…'], ...vials.map((v) => [v.id, vialLabel(v)])], '')}</select></label>` : ''}
    <div class="grid2">
      <label>Peptide in vial<input name="vialAmount" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.vialAmount)}"></label>
      <label>Unit<select name="vialUnit">${options(VIAL_UNITS, c.vialUnit)}</select></label>
    </div>`;
  const water = `<label>Bacteriostatic water (mL)<input name="waterMl" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.waterMl)}"></label>`;
  const dose = `
    <div class="grid2">
      <label>Dose<input name="dose" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.dose)}"></label>
      <label>Unit<select name="doseUnit">${options(['mcg', 'mg', 'IU'], c.doseUnit)}</select></label>
    </div>`;
  const syringe = `
    <div class="grid2">
      <label>Syringe<select name="syringe">${options(['U-100', 'U-50', 'U-40'], c.syringe ?? s.syringe)}</select></label>
      <label>Size<select name="syringeMl">${options([['0.3', '0.3 mL (30u)'], ['0.5', '0.5 mL (50u)'], ['1', '1 mL (100u)']], String(c.syringeMl ?? s.syringeMl))}</select></label>
    </div>`;

  const forms = {
    recon: vialFields + water + dose + syringe,
    units: vialFields + water + `<label>Units drawn<input name="units" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.units)}"></label>` + syringe,
    water: vialFields + dose + `<label>Units you want per dose<input name="targetUnits" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.targetUnits)}"></label>` + syringe,
    weight: `
      <div class="grid2">
        <label>Dose per kg<input name="perKg" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.perKg)}"></label>
        <label>Unit<select name="perKgUnit">${options(['mcg', 'mg', 'IU'], c.perKgUnit || 'mcg')}</select></label>
      </div>
      <div class="grid2">
        <label>Body weight<input name="weight" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.weight)}"></label>
        <label>Unit<select name="weightUnit">${options(['lb', 'kg'], c.weightUnit || s.weightUnit)}</select></label>
      </div>`,
    duration: vialFields + dose + `<label>Doses per week<input name="dosesPerWeek" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.dosesPerWeek)}"></label>`,
  };

  return `
    <div class="seg" role="tablist">
      ${CALC_MODES.map(([k, l]) => `<button role="tab" data-action="calc-mode" data-mode="${k}" class="${ui.calcMode === k ? 'active' : ''}">${l}</button>`).join('')}
    </div>
    <form id="calc-form" class="card" autocomplete="off" onsubmit="return false">
      ${forms[ui.calcMode]}
    </form>
    <div id="calc-result" class="card result" aria-live="polite"></div>
    <p class="disclaimer">For record keeping and math only. Not medical advice. Double-check every draw.</p>
  `;
}

function readCalc() {
  const f = $('#calc-form');
  if (!f) return ui.calc;
  for (const el of f.elements) if (el.name) ui.calc[el.name] = el.value;
  return ui.calc;
}

function syringeSvg(units, capacity) {
  const W = 300, H = 56, x0 = 14, x1 = 250;
  const len = x1 - x0;
  const frac = Math.max(0, Math.min(1, units / capacity));
  const step = capacity <= 30 ? 1 : capacity <= 50 ? 1 : 2;
  const major = capacity <= 50 ? 5 : 10;
  let ticks = '';
  for (let u = 0; u <= capacity + 1e-9; u += step) {
    const x = x0 + (u / capacity) * len;
    const isMajor = Math.abs(u % major) < 1e-9;
    ticks += `<line x1="${x}" y1="14" x2="${x}" y2="${isMajor ? 28 : 22}" />`;
    if (isMajor && u > 0) ticks += `<text x="${x}" y="44">${u}</text>`;
  }
  const fx = x0 + frac * len;
  return `
  <svg class="syringe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Syringe filled to ${fmt(units, 1)} of ${capacity} units">
    <rect class="barrel" x="${x0}" y="12" width="${len}" height="20" rx="3"/>
    <rect class="fill" x="${x0}" y="12" width="${fx - x0}" height="20" rx="3"/>
    <g class="ticks">${ticks}</g>
    <rect class="plunger" x="${fx - 2}" y="8" width="4" height="28" rx="1"/>
    <line class="rod" x1="${fx}" y1="22" x2="${Math.max(fx + 30, x1 + 20)}" y2="22"/>
    <rect class="needle" x="2" y="21" width="12" height="2"/>
    ${units > capacity ? `<text class="over" x="${x1 + 4}" y="12">over!</text>` : ''}
  </svg>`;
}

function updateCalc() {
  const c = readCalc();
  const out = $('#calc-result');
  if (!out) return;
  const syr = c.syringe || S().settings.syringe;
  const syrMl = Number(c.syringeMl || S().settings.syringeMl);
  let html = '';

  if (ui.calcMode === 'recon') {
    const r = reconstitute({ ...c, syringe: syr, syringeMl: syrMl });
    if (r.concentrationPerMl) {
      html += `<div class="kv"><span>Concentration</span><b>${fmtBase(r.concentrationPerMl, r.baseUnit)} / mL</b></div>
               <div class="kv"><span>Each unit on the syringe</span><b>${fmtBase(r.concentrationPerUnit, r.baseUnit)}</b></div>`;
    }
    if (r.units !== undefined) {
      html = `<div class="big">${fmt(r.units, 1)} <small>units</small></div>
              <div class="muted center">draw ${fmt(r.volumeMl, 3)} mL for ${fmt(Number(c.dose), 3)} ${esc(c.doseUnit)}</div>
              ${syringeSvg(r.units, r.syringeCapacityUnits)}
              ${html}
              <div class="kv"><span>Doses per vial</span><b>${fmt(r.dosesPerVial, 1)}</b></div>
              ${r.exceedsSyringe ? `<div class="warn-text">That's more than one ${syrMl} mL syringe holds. Use a bigger syringe or more concentrated mix.</div>` : ''}
              ${r.units < 2 && !r.error ? '<div class="warn-text">Under 2 units is hard to measure. Consider adding less water.</div>' : ''}`;
    }
    if (r.error) html += `<div class="warn-text">${esc(r.error)}</div>`;
    if (r.units !== undefined && !r.error) {
      html += `<div class="actions"><button class="ghost" data-action="calc-save-vial">Save as vial</button><button class="primary" data-action="calc-log">Log this dose</button></div>`;
    }
  }

  if (ui.calcMode === 'units') {
    const r = doseFromUnits({ ...c, syringe: syr });
    html = r.error ? `<div class="muted">${esc(r.error)}</div>` : `
      <div class="big">${r.unit === 'IU' ? fmt(r.dose, 2) : r.dose >= 1000 ? fmt(r.dose / 1000, 3) : fmt(r.dose, 1)} <small>${r.unit === 'IU' ? 'IU' : r.dose >= 1000 ? 'mg' : 'mcg'}</small></div>
      <div class="muted center">in ${fmt(Number(c.units), 1)} units (${fmt(r.volumeMl, 3)} mL)</div>
      ${syringeSvg(Number(c.units), syrMl * unitsPerMl(syr))}`;
  }

  if (ui.calcMode === 'water') {
    const r = waterForTarget({ ...c, syringe: syr });
    html = r.error ? `<div class="warn-text">${esc(r.error)}</div>` : `
      <div class="big">${fmt(r.waterMl, 2)} <small>mL water</small></div>
      <div class="muted center">so each ${fmt(Number(c.dose), 3)} ${esc(c.doseUnit)} dose is ${fmt(Number(c.targetUnits), 1)} units</div>
      <div class="kv"><span>Doses per vial</span><b>${fmt(r.dosesPerVial, 1)}</b></div>
      ${r.waterMl > 10 ? '<div class="warn-text">That is more water than most vials hold.</div>' : ''}`;
  }

  if (ui.calcMode === 'weight') {
    const r = weightBasedDose(c);
    html = r.error ? `<div class="muted">${esc(r.error)}</div>` : `
      <div class="big">${fmt(r.dose, 2)} <small>${esc(r.unit)}</small></div>
      <div class="muted center">for ${fmt(r.kg, 1)} kg body weight</div>`;
  }

  if (ui.calcMode === 'duration') {
    const r = vialDuration(c);
    html = r.error ? `<div class="muted">${esc(r.error)}</div>` : `
      <div class="big">${fmt(r.days, 1)} <small>days</small></div>
      <div class="muted center">${fmt(r.doses, 1)} doses at ${fmt(Number(c.dosesPerWeek), 1)} per week (about ${fmt(r.days / 7, 1)} weeks)</div>`;
  }

  out.innerHTML = html;
}

// ---------- History ----------

function viewHistory() {
  const f = ui.historyFilter;
  const s = S();
  let list = [...s.doses];
  if (f.compoundId) list = list.filter((d) => d.compoundId === f.compoundId);
  else if (f.category) list = list.filter((d) => store.byId('compounds', d.compoundId)?.category === f.category);
  list.sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

  const groups = new Map();
  for (const d of list) {
    if (!groups.has(d.date)) groups.set(d.date, []);
    groups.get(d.date).push(d);
  }

  // Totals for the last 7 days per compound.
  const since = addDays(today(), -6);
  const totals = new Map();
  for (const d of list) {
    if (d.date < since) continue;
    const key = `${d.compoundId}|${['mcg', 'mg', 'g'].includes(d.unit) ? 'mass' : d.unit}`;
    const t = totals.get(key) || { compoundId: d.compoundId, unit: d.unit, sum: 0, n: 0 };
    t.sum += ['mcg', 'mg', 'g'].includes(d.unit) ? toBase(d.amount, d.unit) : Number(d.amount);
    t.n++;
    totals.set(key, t);
  }

  return `
    <div class="filters">
      <select data-filter="category">${options([['', 'All types'], ...Object.entries(CATEGORIES)], f.category)}</select>
      <select data-filter="compoundId">${options([['', 'All compounds'], ...s.compounds.map((c) => [c.id, c.name])], f.compoundId)}</select>
    </div>
    ${totals.size ? `<div class="card"><h3>Last 7 days</h3>${[...totals.values()].map((t) => `
      <div class="kv"><span>${esc(compoundName(t.compoundId))} <span class="muted small">(${t.n} dose${t.n === 1 ? '' : 's'})</span></span>
      <b>${['mcg', 'mg', 'g'].includes(t.unit) ? fmtBase(t.sum, 'mcg') : `${fmt(t.sum, 2)} ${esc(t.unit)}`}</b></div>`).join('')}</div>` : ''}
    ${groups.size ? [...groups].map(([date, ds]) => `<h2>${esc(prettyDate(date))}</h2>${ds.map(doseRow).join('')}`).join('')
      : '<p class="empty">No doses logged yet.</p>'}
    <div class="actions"><button class="ghost" data-action="export-csv">Export CSV</button></div>
    <button class="fab" data-action="new-dose">+ Log dose</button>
  `;
}


// ---------- Daily check-in ----------

const reactionLabel = (r) => (REACTIONS.find(([k]) => k === r)?.[1] ?? r);
const SWEATS = [['', 'Not logged'], ['dry', 'Dry night'], ['sweat', 'Night sweats']];
const wUnit = () => S().settings.weightUnit || 'lb';

function checkinCard(d) {
  const c = store.checkinFor(d);
  if (!c) {
    return `<button class="card row as-btn checkin empty-checkin" data-action="checkin" data-date="${d}">
      <div class="grow"><div class="strong">Daily check-in</div><div class="muted small">Weight, blood pressure, night sweats, notes</div></div>
      <span class="primary-pill">+ Add</span></button>`;
  }
  const am = bpAverage(c.readings, 'am');
  const pm = bpAverage(c.readings, 'pm');
  const bits = [];
  if (c.weight) bits.push(`<div><span class="muted small">Weight</span><b>${esc(fmt(Number(c.weight), 1))}</b><span class="muted small">${esc(wUnit())}${c.fasted ? ' fasted' : ''}</span></div>`);
  if (am) bits.push(`<div><span class="muted small">AM BP${am.n > 1 ? ` (avg of ${am.n})` : ''}</span><b>${fmt(am.sys, 1)}/${fmt(am.dia, 1)}</b><span class="muted small">${am.hr ? `${fmt(am.hr, 1)} bpm` : ''}</span></div>`);
  if (pm) bits.push(`<div><span class="muted small">PM BP${pm.n > 1 ? ` (avg of ${pm.n})` : ''}</span><b>${fmt(pm.sys, 1)}/${fmt(pm.dia, 1)}</b><span class="muted small">${pm.hr ? `${fmt(pm.hr, 1)} bpm` : ''}</span></div>`);
  if (c.sweat) bits.push(`<div><span class="muted small">Last night</span><b>${c.sweat === 'dry' ? 'Dry' : 'Sweats'}</b><span></span></div>`);
  return `<button class="card as-btn checkin" data-action="checkin" data-date="${d}">
    <div class="row"><div class="strong grow">Daily check-in</div><span class="muted small">Edit</span></div>
    ${bits.length ? `<div class="stats">${bits.join('')}</div>` : ''}
    ${c.notes ? `<div class="muted small">${esc(c.notes)}</div>` : ''}
  </button>`;
}

function openCheckinForm(date) {
  const existing = store.checkinFor(date);
  const c = { date, weight: '', fasted: true, weightTime: '', readings: [], sweat: '', notes: '', ...(existing || {}) };
  const slot = (period, i) => (c.readings || []).filter((r) => r.period === period)[i] || {};
  const bpRow = (period, i, label) => {
    const r = slot(period, i);
    return `<div class="bp-row"><span class="bp-label">${label}</span>
      <input name="${period}${i}sys" type="number" inputmode="numeric" min="0" placeholder="SYS" aria-label="${label} systolic" value="${esc(r.sys ?? '')}">
      <span class="slash">/</span>
      <input name="${period}${i}dia" type="number" inputmode="numeric" min="0" placeholder="DIA" aria-label="${label} diastolic" value="${esc(r.dia ?? '')}">
      <input name="${period}${i}hr" type="number" inputmode="numeric" min="0" placeholder="HR" aria-label="${label} pulse" value="${esc(r.hr ?? '')}">
    </div>`;
  };
  const amTime = slot('am', 0).time || (existing ? '' : (new Date().getHours() < 14 ? nowTime() : ''));
  const pmTime = slot('pm', 0).time || (existing ? '' : (new Date().getHours() >= 14 ? nowTime() : ''));
  openModal(`Check-in · ${prettyDate(date)}`, `
    <div class="grid2">
      <label>Weight (${esc(wUnit())})<input name="weight" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.weight)}"></label>
      <label>Time<input name="weightTime" type="time" value="${esc(c.weightTime || (existing ? '' : nowTime()))}"></label>
    </div>
    <label class="check"><input type="checkbox" name="fasted" ${c.fasted ? 'checked' : ''}> Fasted (only fasted weights count in the trend)</label>
    <h3 class="mt">Blood pressure</h3>
    <p class="muted small">Two readings back to back are averaged.</p>
    <label>Morning time<input name="amTime" type="time" value="${esc(amTime)}"></label>
    ${bpRow('am', 0, 'AM 1')}${bpRow('am', 1, 'AM 2')}
    <label>Evening time<input name="pmTime" type="time" value="${esc(pmTime)}"></label>
    ${bpRow('pm', 0, 'PM 1')}${bpRow('pm', 1, 'PM 2')}
    <div class="callout" id="bp-avg" hidden></div>
    <label>Night sweats last night<select name="sweat">${options(SWEATS, c.sweat || '')}</select></label>
    <label>Notes <span class="muted small">(sleep, mood, sick, swelling, anything)</span><textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>
  `, {
    onSubmit(f, form) {
      const readings = [];
      for (const period of ['am', 'pm']) {
        for (const i of [0, 1]) {
          const sys = f[`${period}${i}sys`], dia = f[`${period}${i}dia`], hr = f[`${period}${i}hr`];
          if (sys && dia) readings.push({ period, sys: Number(sys), dia: Number(dia), hr: hr ? Number(hr) : '', time: f[`${period}Time`] || '' });
        }
      }
      store.upsert('checkins', {
        ...(existing || {}), date, weight: f.weight === '' ? '' : Number(f.weight), fasted: form.fasted.checked,
        weightTime: f.weight === '' ? '' : f.weightTime, readings, sweat: f.sweat, notes: f.notes.trim(),
      });
      toast('Check-in saved');
    },
    onDelete: existing ? () => { store.remove('checkins', existing.id); toast('Check-in deleted'); } : null,
    onLive: liveBp,
  });
  $$('.bp-row input', $('#modal-form')).forEach((el) => { el.dataset.live = 'bp'; });
}

function liveBp(form) {
  const box = $('#bp-avg');
  if (!box) return;
  const parts = [];
  for (const period of ['am', 'pm']) {
    const rs = [0, 1].map((i) => ({ period, sys: form[`${period}${i}sys`].value, dia: form[`${period}${i}dia`].value, hr: form[`${period}${i}hr`].value }));
    const a = bpAverage(rs);
    if (a && a.n > 1) parts.push(`${period.toUpperCase()} average <b>${esc(bpText(a))}</b>`);
  }
  box.innerHTML = parts.join('<br>');
  box.hidden = !parts.length;
}

// ---------- Body & labs ----------

function lineChart({ series, height = 150, yFmt = (v) => fmt(v, 0), label }) {
  const all = series.flatMap((s) => s.points);
  if (new Set(all.map((p) => p.date)).size < 2) return '<p class="empty small">Log a few more days to see a trend.</p>';
  const W = 320, H = height, L = 34, R = 8, T = 10, B = 22;
  const dates = [...new Set(all.map((p) => p.date))].sort();
  const t0 = parseYmd(dates[0]).getTime(), t1 = parseYmd(dates[dates.length - 1]).getTime();
  const span = Math.max(t1 - t0, 86_400_000);
  let lo = Math.min(...all.map((p) => p.y)), hi = Math.max(...all.map((p) => p.y));
  const pad = Math.max((hi - lo) * 0.15, 1);
  lo -= pad; hi += pad;
  const x = (d) => L + ((parseYmd(d).getTime() - t0) / span) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const short = (d) => parseYmd(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
  svg += ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${esc(yFmt(v))}</text>`).join('');
  svg += `<text class="ax" x="${L}" y="${H - 6}">${esc(short(dates[0]))}</text><text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(short(dates[dates.length - 1]))}</text>`;
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    svg += `<path class="${s.cls}" d="${d}"/>`;
    if (s.dots) svg += s.points.map((p) => `<circle class="${s.cls}-dot" cx="${x(p.date).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3"><title>${esc(short(p.date))}: ${esc(yFmt(p.y))}</title></circle>`).join('');
  }
  svg += '</svg>';
  const legend = series.filter((s) => s.name).map((s) => `<span class="lg"><i class="${s.cls}-key"></i>${esc(s.name)}</span>`).join('');
  return svg + (legend ? `<div class="legend">${legend}</div>` : '');
}

function viewBody() {
  const s = S();
  const t = today();
  const since = addDays(t, -(ui.bodyRange - 1));
  const trend = weightTrend(s.checkins).filter((p) => p.date >= since);
  const ck = s.checkins.filter((c) => c.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  const bpDaily = (period) => ck.map((c) => ({ date: c.date, a: bpAverage(c.readings, period) })).filter((x) => x.a);
  const am = bpDaily('am');
  const last7 = weightTrend(s.checkins).filter((p) => p.date >= addDays(t, -6));
  const prev7 = weightTrend(s.checkins).filter((p) => p.date >= addDays(t, -13) && p.date < addDays(t, -6));
  const avg = (xs) => (xs.length ? xs.reduce((a, p) => a + p.weight, 0) / xs.length : null);
  const w7 = avg(last7), wPrev = avg(prev7);
  const bp7 = bpAverage(s.checkins.filter((c) => c.date >= addDays(t, -6)).flatMap((c) => c.readings || []));
  const sweatsLogged = ck.filter((c) => c.sweat);
  const dry = sweatsLogged.filter((c) => c.sweat === 'dry').length;

  const rot = siteRotation(s.doses, SITES, t);
  const rotRows = rot.rows.filter((r) => r.site !== 'Other' && (r.days !== null || SUBQ_ROTATION.includes(r.site)));
  const sugSubq = siteRotation(s.doses, SITES, t, SUBQ_ROTATION).suggest;
  const sugIm = siteRotation(s.doses, SITES, t, IM_ROTATION).suggest;
  const reactions = s.doses.filter((x) => x.reaction && x.reaction !== 'none').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  const lm = labMatrix(s.labs);

  return `
    <div class="seg">${[7, 14, 30, 90].map((n) => `<button data-action="body-range" data-n="${n}" class="${ui.bodyRange === n ? 'active' : ''}">${n} days</button>`).join('')}</div>

    <div class="card">
      <div class="stats">
        <div><span class="muted small">7-day fasted avg</span><b>${w7 ? fmt(w7, 1) : '—'}</b><span class="muted small">${w7 && wPrev ? `${w7 - wPrev >= 0 ? '+' : ''}${fmt(w7 - wPrev, 1)} vs prior week` : esc(wUnit())}</span></div>
        <div><span class="muted small">7-day BP avg</span><b>${bp7 ? `${fmt(bp7.sys, 0)}/${fmt(bp7.dia, 0)}` : '—'}</b><span class="muted small">${bp7?.hr ? `${fmt(bp7.hr, 0)} bpm · ${bp7.n} readings` : ''}</span></div>
        <div><span class="muted small">Dry nights</span><b>${sweatsLogged.length ? `${dry}/${sweatsLogged.length}` : '—'}</b><span class="muted small">of nights logged</span></div>
      </div>
    </div>

    <h2>Fasted weight</h2>
    <div class="card">${lineChart({
      label: 'Fasted weight trend',
      yFmt: (v) => fmt(v, 0),
      series: [
        { name: 'Weigh-ins', cls: 's1', dots: true, points: trend.map((p) => ({ date: p.date, y: p.weight })) },
        { name: '7-day average', cls: 's2', points: trend.map((p) => ({ date: p.date, y: p.avg })) },
      ],
    })}</div>

    <h2>Morning blood pressure</h2>
    <div class="card">${lineChart({
      label: 'Morning blood pressure',
      series: [
        { name: 'Systolic', cls: 's1', dots: true, points: am.map((x) => ({ date: x.date, y: x.a.sys })) },
        { name: 'Diastolic', cls: 's3', dots: true, points: am.map((x) => ({ date: x.date, y: x.a.dia })) },
        { name: 'Pulse', cls: 's2', points: am.filter((x) => x.a.hr).map((x) => ({ date: x.date, y: x.a.hr })) },
      ],
    })}</div>

    <h2>Injection sites</h2>
    <div class="card">
      <p class="small">Next SubQ: <b>${esc(sugSubq || '—')}</b> · Next IM: <b>${esc(sugIm || '—')}</b></p>
      <div class="sites">${rotRows.map((r) => `<div class="site ${r.days === null ? 'never' : r.days < 2 ? 'recent' : ''}"><span>${esc(r.site)}</span><b>${r.days === null ? 'never' : r.days === 0 ? 'today' : `${r.days}d`}</b></div>`).join('')}</div>
      ${reactions.length ? `<h3 class="mt">Recent reactions</h3>${reactions.map((x) => `<div class="kv"><span>${esc(prettyDate(x.date))} · ${esc(x.site || 'site?')}</span><b>${esc(reactionLabel(x.reaction))}</b></div>`).join('')}<p class="muted small">${esc(RED_FLAGS)}</p>` : '<p class="muted small">No site reactions logged.</p>'}
    </div>

    <h2>Labs</h2>
    ${lm.panels.length ? `<div class="card scroll-x"><table class="labs">
      <thead><tr><th>Marker</th>${lm.panels.map((p) => `<th><button class="link" data-action="edit-lab" data-id="${p.id}">${esc(p.label || prettyDate(p.date))}</button><div class="muted small">${esc(p.date)}${p.fasted ? ' · fasted' : ''}</div></th>`).join('')}</tr></thead>
      <tbody>${lm.rows.map((r) => `<tr><td>${esc(r.marker)} <span class="muted small">${esc(r.unit)}</span></td>${r.values.map((v) => `<td class="${v?.flag ? 'flag' : ''}">${v ? `${esc(v.cmp || '')}${esc(fmt(Number(v.value), 3))}${v.flag ? ` ${esc(v.flag)}` : ''}` : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">No labs yet.</p>'}
    <div class="actions"><button class="ghost" data-action="new-lab">+ Add lab results</button></div>

    <div class="actions"><button class="primary" data-action="summary">Copy summary for Claude</button></div>
    <button class="fab" data-action="checkin" data-date="${t}">+ Check-in</button>
  `;
}

function openLabForm(p = {}) {
  const isNew = !p.id;
  const d = { date: today(), label: '', fasted: true, notes: '', results: [], ...p };
  openModal(isNew ? 'Add lab results' : 'Edit lab results', `
    <div class="grid2">
      <label>Date<input name="date" type="date" required value="${esc(d.date)}"></label>
      <label>Name <span class="muted small">(optional)</span><input name="label" value="${esc(d.label)}" placeholder="e.g. Week 8 panel"></label>
    </div>
    <label class="check"><input type="checkbox" name="fasted" ${d.fasted ? 'checked' : ''}> Fasted draw</label>
    <label>Results <span class="muted small">(one per line: marker, value, unit, H/L)</span>
      <textarea name="results" rows="10" data-live="lab" placeholder="Hct 44 %&#10;Glucose 92 mg/dL&#10;AST/ALT 22/30 U/L&#10;Estradiol 25 pg/mL">${esc(labLines(d.results))}</textarea></label>
    <div class="callout small" id="lab-preview" hidden></div>
    <label>Notes<textarea name="notes" rows="2" placeholder="e.g. non-fasted, afternoon draw">${esc(d.notes)}</textarea></label>
  `, {
    onSubmit(f, form) {
      store.upsert('labs', { ...p, date: f.date, label: f.label.trim(), fasted: form.fasted.checked, notes: f.notes.trim(), results: parseLabLines(f.results).filter((r) => r.value !== '') });
      toast('Labs saved');
    },
    onDelete: isNew ? null : () => { store.remove('labs', p.id); toast('Labs deleted'); },
    onLive(form) {
      const rs = parseLabLines(form.results.value);
      const box = $('#lab-preview');
      box.hidden = !rs.length;
      box.innerHTML = `${rs.filter((r) => r.value !== '').length} markers read${rs.some((r) => r.value === '') ? `. Couldn't read: ${rs.filter((r) => r.value === '').map((r) => esc(r.marker)).join(', ')}` : ''}`;
    },
  });
}

function openSummary() {
  const s = S();
  const t = today();
  const last = s.settings.lastSummaryTo;
  const ranges = [['3', 'Last 3 days'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']];
  if (last && last < t) ranges.unshift(['since', `Since last copy (${prettyDate(addDays(last, 1))})`]);
  const pick = ranges[0][0];
  const fromFor = (v) => (v === 'since' ? addDays(last, 1) : addDays(t, -(Number(v) - 1)));
  openModal('Summary for Claude', `
    <label>Range<select name="range" data-live="sum">${options(ranges, pick)}</select></label>
    <label>Preview<textarea name="text" rows="12" readonly class="mono"></textarea></label>
    <p class="muted small">Copy, then paste it into this project's chat and I'll update the tracker.</p>
  `, {
    submitLabel: 'Copy',
    onSubmit(f) {
      const text = f.text;
      const done = () => { store.setSettings({ lastSummaryTo: t }); toast('Copied. Paste it to Claude'); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => shareText(text, done));
      else shareText(text, done);
    },
    onLive(form) {
      form.text.value = buildSummary(S(), { from: fromFor(form.range.value), to: t, appName: APP });
    },
  });
  const foot = $('#modal-form .modal-foot');
  if (navigator.share) {
    foot.insertAdjacentHTML('afterbegin', '<button type="button" class="ghost" data-action="share-summary">Share</button>');
  }
}

function shareText(text, done) {
  if (navigator.share) navigator.share({ text }).then(done, () => {});
  else { const ta = $('#modal-form textarea[name=text]'); ta?.select(); document.execCommand?.('copy'); done(); }
}

// ---------- Stack: protocols + vials + compounds ----------

function viewStack() {
  return `
    <div class="seg">
      <button data-action="stack-view" data-v="cycles" class="${ui.stackView === 'cycles' ? 'active' : ''}">Protocols</button>
      <button data-action="stack-view" data-v="library" class="${ui.stackView === 'library' ? 'active' : ''}">Vials & compounds</button>
    </div>
    ${ui.stackView === 'cycles' ? viewCycles() : viewLibrary()}`;
}

// ---------- Protocols ----------

function viewCycles() {
  const s = S();
  const t = today();
  const list = [...s.protocols].sort((a, b) => (b.active !== false) - (a.active !== false) || (a.startDate || '').localeCompare(b.startDate || ''));
  return `
    <p class="muted">A protocol is a repeating schedule for one compound: dose, how often, and optional weeks on and off. Scheduled doses show on the Today tab.</p>
    ${list.length ? list.map((p) => {
      const ph = cyclePhase(p, t);
      const vial = store.byId('vials', p.vialId);
      let runout = '';
      if (vial && sameKind(vial.unit, p.unit)) {
        const r = vialRemaining(vial, s.doses);
        const perWeek = dosesPerWeek(p);
        if (perWeek > 0) {
          const days = (r.left / toBase(p.dose, p.unit)) / perWeek * 7;
          runout = `Vial lasts about ${fmt(days, 0)} more days`;
        }
      }
      const badge = p.active === false ? '<span class="tag off">Paused</span>'
        : ph.phase === 'on' ? `<span class="tag on">On${ph.of ? ` · day ${ph.day}/${ph.of}` : ` · day ${ph.day}`}</span>`
        : ph.phase === 'off' ? `<span class="tag off">Off · day ${ph.day}/${ph.of}</span>`
        : `<span class="tag">${esc(ph.phase)}</span>`;
      const taken = s.doses.filter((d) => d.protocolId === p.id).length;
      return `
      <button class="card as-btn" data-action="edit-protocol" data-id="${p.id}">
        <div class="row"><div class="strong grow">${esc(protocolLabel(p))}</div>${badge}</div>
        <div class="muted">${esc(fmt(p.dose, 3))} ${esc(p.unit)} · ${esc(freqText(p))}</div>
        <div class="muted small">${p.startDate ? `From ${esc(prettyDate(p.startDate))}` : ''}${p.endDate ? ` to ${esc(prettyDate(p.endDate))}` : ''} · ${taken} logged${runout ? ` · ${runout}` : ''}</div>
      </button>`;
    }).join('') : '<p class="empty">No protocols yet.</p>'}
    <button class="fab" data-action="new-protocol">+ New protocol</button>
  `;
}

function openProtocolForm(p = {}) {
  const s = S();
  if (!s.compounds.length) { toast('Add a compound first'); openCompoundForm(); return; }
  const isNew = !p.id;
  const c = store.byId('compounds', p.compoundId) || s.compounds[0];
  const d = {
    name: '', compoundId: c.id, dose: c.defaultDose ?? '', unit: c.defaultUnit || 'mcg', frequency: 'daily', everyN: 2,
    weekdays: [1, 3, 5], times: [], startDate: today(), endDate: '', weeksOn: '', weeksOff: '', vialId: '', active: true, notes: '', ...p,
  };
  openModal(isNew ? 'New protocol' : 'Edit protocol', `
    <label>Compound<select name="compoundId" data-live="proto">${options(s.compounds.map((x) => [x.id, x.name]), d.compoundId)}</select></label>
    <label>Name <span class="muted small">(optional)</span><input name="name" value="${esc(d.name)}" placeholder="e.g. Healing stack AM"></label>
    <div class="grid2">
      <label>Dose<input name="dose" type="number" inputmode="decimal" step="any" min="0" required value="${esc(d.dose)}"></label>
      <label>Unit<select name="unit">${options(DOSE_UNITS, d.unit)}</select></label>
    </div>
    <label>How often
      <select name="frequency" data-live="proto">${options([['daily', 'Every day'], ['everyN', 'Every few days'], ['weekdays', 'Certain weekdays']], d.frequency)}</select>
    </label>
    <label data-show="everyN">Every how many days<input name="everyN" type="number" min="1" step="1" value="${esc(d.everyN)}"></label>
    <fieldset data-show="weekdays" class="days">
      ${WEEKDAYS.map((w, i) => `<label class="day"><input type="checkbox" name="wd${i}" ${d.weekdays.includes(i) ? 'checked' : ''}><span>${w}</span></label>`).join('')}
    </fieldset>
    <label>Times of day <span class="muted small">(optional, comma separated, e.g. 08:00, 20:00)</span><input name="times" value="${esc(d.times.join(', '))}" placeholder="08:00"></label>
    <div class="grid2">
      <label>Start<input name="startDate" type="date" required value="${esc(d.startDate)}"></label>
      <label>End <span class="muted small">(optional)</span><input name="endDate" type="date" value="${esc(d.endDate)}"></label>
    </div>
    <div class="grid2">
      <label>Weeks on<input name="weeksOn" type="number" min="0" step="1" value="${esc(d.weeksOn)}" placeholder="e.g. 8"></label>
      <label>Weeks off<input name="weeksOff" type="number" min="0" step="1" value="${esc(d.weeksOff)}" placeholder="e.g. 4"></label>
    </div>
    <label>Draw from vial<select name="vialId"></select></label>
    <label class="check"><input type="checkbox" name="active" ${d.active !== false ? 'checked' : ''}> Active</label>
    <label>Notes<textarea name="notes" rows="2">${esc(d.notes)}</textarea></label>
  `, {
    onSubmit(f, form) {
      const times = f.times.split(',').map((x) => x.trim()).filter(Boolean)
        .map((x) => (/^\d{1,2}$/.test(x) ? `${x.padStart(2, '0')}:00` : /^\d:\d\d$/.test(x) ? `0${x}` : x));
      store.upsert('protocols', {
        ...p, name: f.name.trim(), compoundId: f.compoundId, dose: Number(f.dose), unit: f.unit,
        frequency: f.frequency, everyN: Number(f.everyN) || 1,
        weekdays: WEEKDAYS.map((_, i) => (form[`wd${i}`].checked ? i : -1)).filter((i) => i >= 0),
        times, startDate: f.startDate, endDate: f.endDate, weeksOn: Number(f.weeksOn) || 0, weeksOff: Number(f.weeksOff) || 0,
        vialId: f.vialId, active: form.active.checked, notes: f.notes.trim(),
      });
      toast('Protocol saved');
    },
    onDelete: isNew ? null : () => { store.remove('protocols', p.id); toast('Protocol deleted'); },
    onLive(form, changed) {
      const freq = form.frequency.value;
      $$('[data-show]', form).forEach((el) => { el.hidden = el.dataset.show !== freq; });
      if (changed === 'compoundId') {
        const cc = store.byId('compounds', form.compoundId.value);
        if (cc?.defaultDose) form.dose.value = cc.defaultDose;
        if (cc?.defaultUnit) form.unit.value = cc.defaultUnit;
      }
      if (changed === 'compoundId' || changed === 'init') {
        const vials = S().vials.filter((v) => v.compoundId === form.compoundId.value && (!v.finished || v.id === d.vialId));
        const keep = changed === 'init' && (!isNew || d.vialId) ? d.vialId : (vials[0]?.id ?? '');
        form.vialId.innerHTML = options([['', 'None'], ...vials.map((v) => [v.id, vialLabel(v)])], keep);
      }
    },
  });
}

// ---------- Library: vials + compounds ----------

function viewLibrary() {
  const s = S();
  const t = today();
  const active = s.vials.filter((v) => !v.finished);
  const finished = s.vials.filter((v) => v.finished);
  const vialCard = (v) => {
    const r = vialRemaining(v, s.doses);
    const age = vialAge(v, t);
    const pct = r.total ? (r.left / r.total) * 100 : 0;
    const conc = v.waterMl ? reconstitute({ vialAmount: v.amount, vialUnit: v.unit, waterMl: v.waterMl }) : null;
    return `
      <button class="card as-btn" data-action="edit-vial" data-id="${v.id}">
        <div class="row"><div class="strong grow">${esc(compoundName(v.compoundId))} · ${esc(fmt(v.amount))} ${esc(v.unit)}</div>
          ${age?.expired ? '<span class="tag off">Past use-by</span>' : v.finished ? '<span class="tag">Finished</span>' : ''}</div>
        <div class="bar"><span style="width:${pct.toFixed(1)}%" class="${pct < 15 ? 'low' : ''}"></span></div>
        <div class="muted small">${fmtBase(r.left, r.baseUnit)} left of ${fmtBase(r.total, r.baseUnit)}
          ${conc ? ` · ${fmtBase(conc.concentrationPerMl, conc.baseUnit)}/mL in ${fmt(Number(v.waterMl), 2)} mL` : ' · not mixed yet'}
          ${age ? ` · mixed ${age.age}d ago${age.daysLeft !== null && !age.expired ? `, ${age.daysLeft}d left` : ''}` : ''}
          ${v.lot ? ` · lot ${esc(v.lot)}` : ''}</div>
      </button>`;
  };
  return `
    <section>
      <h2>Vials</h2>
      ${active.length ? active.map(vialCard).join('') : '<p class="empty">No vials yet.</p>'}
      <div class="actions"><button class="primary" data-action="new-vial">+ Add vial</button></div>
      ${finished.length ? `<button class="link" data-action="toggle-finished">${ui.showFinished ? 'Hide' : 'Show'} ${finished.length} finished vial${finished.length === 1 ? '' : 's'}</button>
        ${ui.showFinished ? finished.map(vialCard).join('') : ''}` : ''}
    </section>
    <section>
      <h2>Compounds</h2>
      <p class="muted small">Peptides, aminos and anything else you track. Defaults fill in the dose form.</p>
      ${s.compounds.length ? s.compounds.map((c) => `
        <button class="card row as-btn" data-action="edit-compound" data-id="${c.id}">
          <div class="grow"><div class="strong">${esc(c.name)} <span class="tag ${esc(c.category)}">${esc(CATEGORIES[c.category] || c.category)}</span></div>
          <div class="muted small">${c.defaultDose ? `Default ${esc(fmt(c.defaultDose, 3))} ${esc(c.defaultUnit)}` : 'No default dose'}${c.route ? ` · ${esc(c.route)}` : ''}</div></div>
        </button>`).join('') : '<p class="empty">No compounds yet.</p>'}
      <div class="actions"><button class="ghost" data-action="new-compound">+ Add compound</button></div>
    </section>
  `;
}

function openCompoundForm(c = {}) {
  const isNew = !c.id;
  const d = { name: '', category: 'peptide', defaultDose: '', defaultUnit: 'mcg', route: 'SubQ', notes: '', ...c };
  openModal(isNew ? 'New compound' : 'Edit compound', `
    <label>Name<input name="name" required value="${esc(d.name)}" placeholder="e.g. BPC-157"></label>
    <label>Type<select name="category">${options(Object.entries(CATEGORIES), d.category)}</select></label>
    <div class="grid2">
      <label>Default dose<input name="defaultDose" type="number" inputmode="decimal" step="any" min="0" value="${esc(d.defaultDose)}"></label>
      <label>Unit<select name="defaultUnit">${options(DOSE_UNITS, d.defaultUnit)}</select></label>
    </div>
    <label>Route<select name="route">${options(ROUTES, d.route)}</select></label>
    <label>Notes<textarea name="notes" rows="2">${esc(d.notes)}</textarea></label>
    ${isNew ? '' : '<p class="muted small">Deleting a compound also deletes its vials and protocols. Logged doses are kept.</p>'}
  `, {
    onSubmit(f) {
      store.upsert('compounds', { ...c, name: f.name.trim(), category: f.category, defaultDose: f.defaultDose === '' ? '' : Number(f.defaultDose), defaultUnit: f.defaultUnit, route: f.route, notes: f.notes.trim() });
      toast('Compound saved');
    },
    onDelete: isNew ? null : () => { store.remove('compounds', c.id); toast('Compound deleted'); },
  });
}

function openVialForm(v = {}) {
  const s = S();
  if (!s.compounds.length) { toast('Add a compound first'); openCompoundForm(); return; }
  const isNew = !v.id;
  const d = { compoundId: s.compounds[0].id, amount: '', unit: 'mg', waterMl: '', mixedOn: today(), shelfDays: 28, lot: '', cost: '', notes: '', finished: false, ...v };
  openModal(isNew ? 'New vial' : 'Edit vial', `
    <label>Compound<select name="compoundId">${options(s.compounds.map((x) => [x.id, x.name]), d.compoundId)}</select></label>
    <div class="grid2">
      <label>Amount in vial<input name="amount" type="number" inputmode="decimal" step="any" min="0" required value="${esc(d.amount)}"></label>
      <label>Unit<select name="unit">${options(VIAL_UNITS, d.unit)}</select></label>
    </div>
    <div class="grid2">
      <label>Water added (mL)<input name="waterMl" type="number" inputmode="decimal" step="any" min="0" value="${esc(d.waterMl)}" placeholder="blank if not mixed"></label>
      <label>Mixed on<input name="mixedOn" type="date" value="${esc(d.mixedOn)}"></label>
    </div>
    <div class="grid2">
      <label>Use within (days)<input name="shelfDays" type="number" min="0" step="1" value="${esc(d.shelfDays)}"></label>
      <label>Lot / batch<input name="lot" value="${esc(d.lot)}"></label>
    </div>
    <label>Cost <span class="muted small">(optional)</span><input name="cost" type="number" inputmode="decimal" step="any" min="0" value="${esc(d.cost)}"></label>
    <label>Notes<textarea name="notes" rows="2">${esc(d.notes)}</textarea></label>
    <label class="check"><input type="checkbox" name="finished" ${d.finished ? 'checked' : ''}> Finished / thrown out</label>
  `, {
    onSubmit(f, form) {
      store.upsert('vials', {
        ...v, compoundId: f.compoundId, amount: Number(f.amount), unit: f.unit,
        waterMl: f.waterMl === '' ? '' : Number(f.waterMl), mixedOn: f.waterMl === '' ? '' : f.mixedOn,
        shelfDays: Number(f.shelfDays) || 0, lot: f.lot.trim(), cost: f.cost === '' ? '' : Number(f.cost), notes: f.notes.trim(),
        finished: form.finished.checked,
      });
      toast('Vial saved');
    },
    onDelete: isNew ? null : () => { store.remove('vials', v.id); toast('Vial deleted'); },
  });
}

// ---------- Settings ----------

function openSettings() {
  const st = S().settings;
  const s = S();
  openModal('Settings', `
    <div class="grid2">
      <label>Default syringe<select name="syringe">${options(['U-100', 'U-50', 'U-40'], st.syringe)}</select></label>
      <label>Syringe size<select name="syringeMl">${options([['0.3', '0.3 mL'], ['0.5', '0.5 mL'], ['1', '1 mL']], String(st.syringeMl))}</select></label>
    </div>
    <label>Body weight unit<select name="weightUnit">${options(['lb', 'kg'], st.weightUnit)}</select></label>
    <h3>Your data</h3>
    <p class="muted small">Everything is stored only on this device (${s.doses.length} doses, ${s.checkins.length} check-ins, ${s.labs.length} lab panels, ${s.vials.length} vials, ${s.protocols.length} protocols). Back it up now and then.</p>
    <div class="actions wrap">
      <button type="button" class="primary" data-action="summary">Copy summary for Claude</button>
      <button type="button" class="ghost" data-action="export-json">Download backup</button>
      <label class="ghost button">Add entries from file<input type="file" accept="application/json,.json" data-action="merge-json" hidden></label>
      <label class="ghost button">Restore backup (replaces all)<input type="file" accept="application/json,.json" data-action="import-json" hidden></label>
      <button type="button" class="ghost" data-action="export-csv">Export doses CSV</button>
      <button type="button" class="danger" data-action="clear-all">Erase everything</button>
    </div>
    <p class="disclaimer">${APP} is a personal record and calculator. It is not medical advice. Check every calculation before you use it.</p>
  `, {
    submitLabel: 'Save',
    onSubmit(f) {
      store.setSettings({ syringe: f.syringe, syringeMl: Number(f.syringeMl), weightUnit: f.weightUnit });
      ui.calc.syringe = f.syringe;
      ui.calc.syringeMl = f.syringeMl;
      toast('Settings saved');
    },
  });
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function exportCsv() {
  const s = S();
  const head = ['date', 'time', 'compound', 'type', 'amount', 'unit', 'syringe_units', 'route', 'site', 'reaction', 'vial', 'protocol', 'notes'];
  const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const rows = [...s.doses].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((d) => {
    const c = store.byId('compounds', d.compoundId);
    const v = store.byId('vials', d.vialId);
    const p = store.byId('protocols', d.protocolId);
    return [d.date, d.time, c?.name, c?.category, d.amount, d.unit, d.units != null ? fmt(d.units, 2) : '', d.route, d.site, d.reaction && d.reaction !== 'none' ? d.reaction : '',
      v ? `${v.amount} ${v.unit}${v.lot ? ` lot ${v.lot}` : ''}` : '', p ? protocolLabel(p) : '', d.notes].map(q).join(',');
  });
  download(`dialed-in-doses-${today()}.csv`, [head.join(','), ...rows].join('\n'), 'text/csv');
}

// ---------- Modal ----------

let modalHandlers = null;

function openModal(title, body, handlers) {
  const dlg = $('#modal');
  const form = $('#modal-form');
  modalHandlers = handlers;
  form.innerHTML = `
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">
      ${handlers.onDelete ? '<button type="button" class="danger" data-action="modal-delete">Delete</button>' : ''}
      <span class="grow"></span>
      <button type="button" class="ghost" data-action="close-modal">Cancel</button>
      <button type="submit" class="primary">${esc(handlers.submitLabel || 'Save')}</button>
    </div>`;
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  handlers.onLive?.(form, 'init');
  setTimeout(() => $('input:not([type=hidden]), select', form)?.focus({ preventScroll: true }), 30);
}

function closeModal() {
  const dlg = $('#modal');
  if (dlg.open) dlg.close();
  modalHandlers = null;
}

$('#modal-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const h = modalHandlers;
  closeModal();
  h?.onSubmit?.(data, form);
  render();
});

$('#modal-form').addEventListener('input', (e) => {
  if (e.target.dataset.live && modalHandlers?.onLive) modalHandlers.onLive(e.currentTarget, e.target.name);
});

$('#modal').addEventListener('close', () => { modalHandlers = null; });

// ---------- Events ----------

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) return go(tabBtn.dataset.tab);
  if (e.target.closest('#settings-btn')) return openSettings();

  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const { action, id } = el.dataset;

  switch (action) {
    case 'day': {
      const n = Number(el.dataset.n);
      ui.date = n === 0 ? today() : addDays(ui.date, n);
      return render();
    }
    case 'new-dose': return openDoseForm();
    case 'edit-dose': return openDoseForm({ ...store.byId('doses', id) });
    case 'log-scheduled': {
      const p = store.byId('protocols', id);
      const slot = Number(el.dataset.slot);
      const c = store.byId('compounds', p.compoundId);
      return openDoseForm({
        compoundId: p.compoundId, amount: p.dose, unit: p.unit, vialId: p.vialId, protocolId: p.id, slot,
        route: c?.route || 'SubQ', date: ui.date, time: ui.date === today() ? nowTime() : (p.times?.[slot] || ''),
      });
    }
    case 'checkin': return openCheckinForm(el.dataset.date || ui.date);
    case 'body-range': ui.bodyRange = Number(el.dataset.n); return render();
    case 'stack-view': ui.stackView = el.dataset.v; return render();
    case 'new-lab': return openLabForm();
    case 'edit-lab': return openLabForm({ ...store.byId('labs', id) });
    case 'summary': return openSummary();
    case 'share-summary': {
      const text = $('#modal-form textarea[name=text]')?.value || '';
      return shareText(text, () => { store.setSettings({ lastSummaryTo: today() }); closeModal(); toast('Shared'); });
    }
    case 'new-protocol': return openProtocolForm();
    case 'edit-protocol': return openProtocolForm({ ...store.byId('protocols', id) });
    case 'new-vial': return openVialForm();
    case 'edit-vial': return openVialForm({ ...store.byId('vials', id) });
    case 'new-compound': return openCompoundForm();
    case 'edit-compound': return openCompoundForm({ ...store.byId('compounds', id) });
    case 'toggle-finished': ui.showFinished = !ui.showFinished; return render();
    case 'calc-mode': readCalc(); ui.calcMode = el.dataset.mode; return render();
    case 'calc-save-vial': {
      const c = readCalc();
      return openVialForm({ amount: Number(c.vialAmount), unit: c.vialUnit, waterMl: Number(c.waterMl), mixedOn: today(), shelfDays: 28 });
    }
    case 'calc-log': {
      const c = readCalc();
      const match = S().vials.find((v) => !v.finished && Number(v.amount) === Number(c.vialAmount) && v.unit === c.vialUnit && Number(v.waterMl) === Number(c.waterMl));
      return openDoseForm({ amount: Number(c.dose), unit: c.doseUnit, ...(match ? { compoundId: match.compoundId, vialId: match.id } : {}) });
    }
    case 'export-csv': return exportCsv();
    case 'export-json': return download(`dialed-in-backup-${today()}.json`, store.exportJson(), 'application/json');
    case 'clear-all':
      if (confirm('Erase all doses, check-ins, labs, vials, protocols and compounds on this device? This cannot be undone.')) {
        store.clearAll(); closeModal(); render(); toast('Everything erased');
      }
      return;
    case 'close-modal': return closeModal();
    case 'modal-delete': {
      if (!confirm('Delete this?')) return;
      const h = modalHandlers;
      closeModal();
      h?.onDelete?.();
      return render();
    }
    default:
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-action="merge-json"]') && t.files?.[0]) {
    t.files[0].text().then((txt) => {
      try {
        const added = store.mergeJson(txt);
        const parts = Object.entries(added).map(([k, n]) => `${n} ${k}`);
        closeModal(); render(); toast(parts.length ? `Added ${parts.join(', ')}` : 'Nothing new in that file');
      } catch (err) { alert(err.message); }
    });
  }
  if (t.matches('[data-action="import-json"]') && t.files?.[0]) {
    if (!confirm('Restoring replaces everything on this device with the backup. Continue?')) { t.value = ''; return; }
    t.files[0].text().then((txt) => {
      try {
        store.importJson(txt);
        closeModal(); render(); toast('Backup restored');
      } catch (err) { alert(err.message); }
    });
  }
  if (t.matches('[data-filter]')) {
    ui.historyFilter[t.dataset.filter] = t.value;
    if (t.dataset.filter === 'category') ui.historyFilter.compoundId = '';
    render();
  }
  if (t.matches('[data-calc-vial]') && t.value) {
    const v = store.byId('vials', t.value);
    if (v) {
      Object.assign(ui.calc, { vialAmount: v.amount, vialUnit: v.unit, waterMl: v.waterMl });
      const c = store.byId('compounds', v.compoundId);
      if (c?.defaultDose && ['mcg', 'mg', 'IU'].includes(c.defaultUnit)) Object.assign(ui.calc, { dose: c.defaultDose, doseUnit: c.defaultUnit });
      render();
    }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.closest('#calc-form')) updateCalc();
});

// Re-check "today" when the app comes back to the foreground.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ui.tab === 'today') render();
});

// ---------- boot ----------

try {
  const saved = localStorage.getItem('peptide-log-tab');
  const old = { cycles: 'stack', library: 'stack' };
  if (saved && VIEWS[old[saved] || saved]) ui.tab = old[saved] || saved;
} catch { /* ignore */ }
ui.calc.syringe = S().settings.syringe;
ui.calc.syringeMl = String(S().settings.syringeMl);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // When a new version's service worker takes over, reload once so the
  // screen shows the new version instead of the one already on screen.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
}
