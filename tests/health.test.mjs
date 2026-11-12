import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bpAverage, weightTrend, siteRotation, parseLabLines, labMatrix, buildSummary,
} from '../js/health.js';

test('two back-to-back BP readings are averaged', () => {
  const a = bpAverage([
    { period: 'am', sys: 120, dia: 80, hr: 70 },
    { period: 'am', sys: 118, dia: 78, hr: 74 },
    { period: 'pm', sys: 140, dia: 90, hr: 90 },
  ], 'am');
  assert.deepEqual(a, { sys: 119, dia: 79, hr: 72, n: 2 });
});

test('BP ignores blank readings and returns null when none', () => {
  assert.equal(bpAverage([{ period: 'am', sys: '', dia: '' }], 'am'), null);
  assert.equal(bpAverage([{ period: 'am', sys: 120, dia: 70 }]).hr, null);
});

test('weight trend uses fasted weights only, with rolling average', () => {
  const t = weightTrend([
    { date: '2026-11-07', weight: 180, fasted: true },
    { date: '2026-11-08', weight: 185, fasted: false },
    { date: '2026-11-10', weight: 182.6, fasted: true },
    { date: '2026-11-20', weight: 178, fasted: true },
  ]);
  assert.equal(t.length, 3);
  assert.ok(Math.abs(t[1].avg - 181.3) < 1e-9);
  assert.equal(t[2].avg, 178); // older points fall out of the 7-day window
});

test('site rotation suggests the site rested longest, never-used first', () => {
  const sites = ['A', 'B', 'C'];
  const doses = [{ date: '2026-11-10', site: 'A' }, { date: '2026-11-08', site: 'B' }];
  const r = siteRotation(doses, sites, '2026-11-12');
  assert.equal(r.suggest, 'C');
  assert.equal(r.rows[0].days, 2);
  doses.push({ date: '2026-11-11', site: 'C' });
  assert.equal(siteRotation(doses, sites, '2026-11-12').suggest, 'B');
});

test('lab lines parse values, units, flags and paired markers', () => {
  const r = parseLabLines('Hct 50.2 %\nCreatinine: 1.5 mg/dL H\nAST/ALT 30/35 U/L\nVit D 55 ng/mL\neGFR 90\nPSA <0.1 ng/mL\nnonsense');
  assert.deepEqual(r[0], { marker: 'Hct', value: 50.2, unit: '%', flag: '' });
  assert.deepEqual(r[1], { marker: 'Creatinine', value: 1.5, unit: 'mg/dL', flag: 'H' });
  assert.equal(r[2].marker, 'AST');
  assert.equal(r[3].value, 35);
  assert.equal(r[3].marker, 'ALT');
  assert.equal(r[4].marker, 'Vit D');
  assert.equal(r[5].value, 90);
  assert.equal(r[6].cmp, '<');
  assert.equal(r[7].value, '');
});

test('lab matrix lines up markers across panels, oldest first', () => {
  const m = labMatrix([
    { date: '2026-11-05', results: [{ marker: 'Hct', value: 46, unit: '%' }] },
    { date: '2026-10-01', results: [{ marker: 'Hct', value: 44, unit: '%' }, { marker: 'TSH', value: 2 }] },
  ]);
  assert.equal(m.panels[0].date, '2026-10-01');
  assert.equal(m.rows.length, 2);
  assert.equal(m.rows[0].values[1].value, 46);
  assert.equal(m.rows[1].values[1], null);
});

test('summary lists check-ins and doses in range', () => {
  const state = {
    settings: { weightUnit: 'lb' },
    compounds: [{ id: 'y', name: 'BPC-157' }],
    checkins: [{ date: '2026-11-12', weight: 180, fasted: true, readings: [
      { period: 'am', sys: 120, dia: 80, hr: 70, time: '07:00' },
      { period: 'am', sys: 118, dia: 78, hr: 74, time: '07:00' },
    ], sweat: 'dry' }],
    doses: [{ date: '2026-11-12', time: '18:00', compoundId: 'y', amount: 250, unit: 'mcg', route: 'SubQ', site: 'Abdomen upper R', reaction: 'none' }],
    labs: [],
  };
  const txt = buildSummary(state, { from: '2026-11-11', to: '2026-11-12' });
  assert.match(txt, /Weight: 180 lb \(fasted\)/);
  assert.match(txt, /120\/80\/70 and 118\/78\/74 \(avg 119\/79 · 72 bpm\)/);
  assert.match(txt, /Night sweats \(last night\): dry/);
  assert.match(txt, /BPC-157 250 mcg, SubQ, Abdomen upper R, no reaction/);
  assert.doesNotMatch(txt, /2026-11-11\)/);
});
