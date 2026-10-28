import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconstitute, doseFromUnits, waterForTarget, weightBasedDose, vialDuration,
  isScheduledOn, cyclePhase, dosesPerWeek, vialRemaining, vialAge,
} from '../js/calc.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('5 mg vial + 2 mL water, 250 mcg dose = 10 units on U-100', () => {
  const r = reconstitute({ vialAmount: 5, vialUnit: 'mg', waterMl: 2, dose: 250, doseUnit: 'mcg' });
  close(r.concentrationPerMl, 2500);
  close(r.concentrationPerUnit, 25);
  close(r.volumeMl, 0.1);
  close(r.units, 10);
  close(r.dosesPerVial, 20);
  assert.equal(r.exceedsSyringe, false);
  assert.equal(r.error, undefined);
});

test('10 mg vial + 1 mL, 2.5 mg dose = 25 units', () => {
  const r = reconstitute({ vialAmount: 10, vialUnit: 'mg', waterMl: 1, dose: 2.5, doseUnit: 'mg' });
  close(r.units, 25);
});

test('IU vials work (10 IU in 1 mL, 2 IU dose = 20 units)', () => {
  const r = reconstitute({ vialAmount: 10, vialUnit: 'IU', waterMl: 1, dose: 2, doseUnit: 'IU' });
  close(r.units, 20);
  assert.equal(r.baseUnit, 'IU');
});

test('mixing IU and mass is rejected', () => {
  const r = reconstitute({ vialAmount: 10, vialUnit: 'IU', waterMl: 1, dose: 2, doseUnit: 'mg' });
  assert.ok(r.error);
});

test('flags dose bigger than a 0.3 mL syringe', () => {
  const r = reconstitute({ vialAmount: 5, vialUnit: 'mg', waterMl: 2, dose: 1, doseUnit: 'mg', syringeMl: 0.3 });
  close(r.units, 40);
  assert.equal(r.exceedsSyringe, true);
});

test('U-40 syringe changes units', () => {
  const r = reconstitute({ vialAmount: 5, vialUnit: 'mg', waterMl: 2, dose: 250, doseUnit: 'mcg', syringe: 'U-40' });
  close(r.units, 4);
});

test('missing water returns an error', () => {
  assert.ok(reconstitute({ vialAmount: 5, waterMl: 0 }).error);
});

test('dose from units drawn', () => {
  const r = doseFromUnits({ vialAmount: 5, vialUnit: 'mg', waterMl: 2, units: 10 });
  close(r.dose, 250);
  assert.equal(r.unit, 'mcg');
});

test('water needed for target units', () => {
  const r = waterForTarget({ vialAmount: 5, vialUnit: 'mg', dose: 250, doseUnit: 'mcg', targetUnits: 10 });
  close(r.waterMl, 2);
});

test('weight based dose in lb', () => {
  const r = weightBasedDose({ perKg: 2, weight: 220, weightUnit: 'lb' });
  close(r.dose, 2 * 220 * 0.45359237);
});

test('vial duration', () => {
  const r = vialDuration({ vialAmount: 5, vialUnit: 'mg', dose: 250, doseUnit: 'mcg', dosesPerWeek: 7 });
  close(r.days, 20);
});

test('daily schedule with 1 week on / 1 week off', () => {
  const p = { startDate: '2026-01-01', frequency: 'daily', weeksOn: 1, weeksOff: 1 };
  assert.equal(isScheduledOn(p, '2025-12-31'), false);
  assert.equal(isScheduledOn(p, '2026-01-01'), true);
  assert.equal(isScheduledOn(p, '2026-01-07'), true);
  assert.equal(isScheduledOn(p, '2026-01-08'), false);
  assert.equal(isScheduledOn(p, '2026-01-15'), true);
  assert.deepEqual(cyclePhase(p, '2026-01-09'), { phase: 'off', day: 2, of: 7, cycleNumber: 1 });
});

test('every N days', () => {
  const p = { startDate: '2026-01-01', frequency: 'everyN', everyN: 3 };
  assert.equal(isScheduledOn(p, '2026-01-04'), true);
  assert.equal(isScheduledOn(p, '2026-01-05'), false);
});

test('weekdays (Mon/Wed/Fri)', () => {
  const p = { startDate: '2026-01-01', frequency: 'weekdays', weekdays: [1, 3, 5] };
  assert.equal(isScheduledOn(p, '2026-01-05'), true); // Monday
  assert.equal(isScheduledOn(p, '2026-01-06'), false); // Tuesday
  assert.equal(dosesPerWeek(p), 3);
});

test('end date stops a schedule', () => {
  const p = { startDate: '2026-01-01', endDate: '2026-01-10', frequency: 'daily' };
  assert.equal(isScheduledOn(p, '2026-01-11'), false);
});

test('vial remaining subtracts logged doses', () => {
  const vial = { id: 'v1', amount: 5, unit: 'mg' };
  const doses = [
    { vialId: 'v1', amount: 250, unit: 'mcg' },
    { vialId: 'v1', amount: 0.5, unit: 'mg' },
    { vialId: 'v2', amount: 1, unit: 'mg' },
  ];
  const r = vialRemaining(vial, doses);
  close(r.used, 750);
  close(r.left, 4250);
});

test('vial age and expiry', () => {
  const r = vialAge({ mixedOn: '2026-01-01', shelfDays: 28 }, '2026-02-05');
  assert.equal(r.age, 35);
  assert.equal(r.expired, true);
});
