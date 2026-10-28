// Pure calculation helpers. No DOM, no storage, so they can be unit tested.

// Convert an amount to a base unit. Mass goes to mcg; IU stays IU.
export function toBase(amount, unit) {
  const n = Number(amount);
  switch (unit) {
    case 'mcg': return n;
    case 'mg': return n * 1000;
    case 'g': return n * 1_000_000;
    case 'IU': return n;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

export function fromBase(base, unit) {
  switch (unit) {
    case 'mcg': return base;
    case 'mg': return base / 1000;
    case 'g': return base / 1_000_000;
    case 'IU': return base;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

export const isMass = (unit) => unit === 'mcg' || unit === 'mg' || unit === 'g';

export function sameKind(a, b) {
  return (isMass(a) && isMass(b)) || (a === 'IU' && b === 'IU');
}

// Units per mL on an insulin syringe. U-100 is the common one.
export function unitsPerMl(syringeType = 'U-100') {
  const map = { 'U-100': 100, 'U-50': 50, 'U-40': 40 };
  return map[syringeType] ?? 100;
}

const positive = (n) => Number.isFinite(n) && n > 0;

/**
 * Reconstitution: how strong is the vial, and how much to draw for one dose.
 * vialAmount + vialUnit: what's in the vial (e.g. 5 mg, or 10 IU)
 * waterMl: bacteriostatic water added
 * dose + doseUnit: desired dose (e.g. 250 mcg)
 */
export function reconstitute({ vialAmount, vialUnit = 'mg', waterMl, dose, doseUnit = 'mcg', syringe = 'U-100', syringeMl = 1 }) {
  const vialBase = toBase(vialAmount, vialUnit);
  const water = Number(waterMl);
  if (!positive(vialBase)) return { error: 'Enter the amount in the vial.' };
  if (!positive(water)) return { error: 'Enter how much water you add.' };

  const concBasePerMl = vialBase / water; // mcg/mL or IU/mL
  const upm = unitsPerMl(syringe);
  const result = {
    concentrationPerMl: concBasePerMl,
    concentrationPerUnit: concBasePerMl / upm,
    baseUnit: isMass(vialUnit) ? 'mcg' : 'IU',
    unitsPerMl: upm,
  };

  if (dose !== undefined && dose !== '' && dose !== null) {
    if (!sameKind(vialUnit, doseUnit)) return { ...result, error: 'Vial and dose units must both be mass or both be IU.' };
    const doseBase = toBase(dose, doseUnit);
    if (!positive(doseBase)) return { ...result, error: 'Enter a dose.' };
    const volumeMl = doseBase / concBasePerMl;
    const units = volumeMl * upm;
    result.volumeMl = volumeMl;
    result.units = units;
    result.dosesPerVial = vialBase / doseBase;
    result.syringeCapacityUnits = Number(syringeMl) * upm;
    result.exceedsSyringe = units > result.syringeCapacityUnits + 1e-9;
    if (volumeMl > water + 1e-9) result.error = 'That dose is more than the whole vial.';
  }
  return result;
}

/**
 * Dose from a draw: "I pulled X units, how much is that?"
 */
export function doseFromUnits({ vialAmount, vialUnit = 'mg', waterMl, units, syringe = 'U-100', outUnit }) {
  const vialBase = toBase(vialAmount, vialUnit);
  const water = Number(waterMl);
  const u = Number(units);
  if (!positive(vialBase) || !positive(water) || !positive(u)) return { error: 'Enter vial amount, water and units drawn.' };
  const volumeMl = u / unitsPerMl(syringe);
  const base = (vialBase / water) * volumeMl;
  const unit = outUnit ?? (isMass(vialUnit) ? 'mcg' : 'IU');
  return { volumeMl, dose: fromBase(base, unit), unit };
}

/**
 * Water needed so a dose lands on a target number of syringe units.
 * e.g. 5 mg vial, 250 mcg dose, want 10 units per dose -> 2 mL water.
 */
export function waterForTarget({ vialAmount, vialUnit = 'mg', dose, doseUnit = 'mcg', targetUnits, syringe = 'U-100' }) {
  if (!sameKind(vialUnit, doseUnit)) return { error: 'Vial and dose units must both be mass or both be IU.' };
  const vialBase = toBase(vialAmount, vialUnit);
  const doseBase = toBase(dose, doseUnit);
  const t = Number(targetUnits);
  if (!positive(vialBase) || !positive(doseBase) || !positive(t)) return { error: 'Enter vial amount, dose and target units.' };
  const volumePerDoseMl = t / unitsPerMl(syringe);
  const waterMl = (vialBase / doseBase) * volumePerDoseMl;
  return { waterMl, dosesPerVial: vialBase / doseBase };
}

/**
 * Body-weight based dose, e.g. 2 mcg/kg.
 */
export function weightBasedDose({ perKg, perKgUnit = 'mcg', weight, weightUnit = 'kg' }) {
  const w = Number(weight);
  const p = Number(perKg);
  if (!positive(w) || !positive(p)) return { error: 'Enter body weight and dose per kg.' };
  const kg = weightUnit === 'lb' ? w * 0.45359237 : w;
  return { kg, dose: p * kg, unit: perKgUnit };
}

/**
 * How long a vial lasts on a schedule.
 */
export function vialDuration({ vialAmount, vialUnit = 'mg', dose, doseUnit = 'mcg', dosesPerWeek }) {
  if (!sameKind(vialUnit, doseUnit)) return { error: 'Units do not match.' };
  const doses = toBase(vialAmount, vialUnit) / toBase(dose, doseUnit);
  const perWeek = Number(dosesPerWeek);
  if (!positive(doses) || !positive(perWeek)) return { error: 'Enter vial, dose and doses per week.' };
  return { doses, days: (doses / perWeek) * 7 };
}

// ---------- Schedules ----------

// Local YYYY-MM-DD for a Date.
export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86_400_000);
}

/**
 * Is a protocol scheduled on a date (YYYY-MM-DD)?
 * protocol: { startDate, endDate?, frequency: 'daily'|'everyN'|'weekdays', everyN?, weekdays?: [0..6],
 *             weeksOn?, weeksOff? }
 */
export function isScheduledOn(protocol, date) {
  if (!protocol.startDate || date < protocol.startDate) return false;
  if (protocol.endDate && date > protocol.endDate) return false;
  const offset = daysBetween(protocol.startDate, date);

  const on = Number(protocol.weeksOn) || 0;
  const off = Number(protocol.weeksOff) || 0;
  if (on > 0 && off > 0) {
    const cycleDays = (on + off) * 7;
    if (offset % cycleDays >= on * 7) return false;
  }

  switch (protocol.frequency) {
    case 'daily': return true;
    case 'everyN': {
      const n = Math.max(1, Number(protocol.everyN) || 1);
      return offset % n === 0;
    }
    case 'weekdays': return (protocol.weekdays || []).includes(parseYmd(date).getDay());
    default: return false;
  }
}

// Where a protocol is in its on/off cycle on a date.
export function cyclePhase(protocol, date) {
  if (!protocol.startDate || date < protocol.startDate) return { phase: 'not started' };
  if (protocol.endDate && date > protocol.endDate) return { phase: 'ended' };
  const offset = daysBetween(protocol.startDate, date);
  const on = Number(protocol.weeksOn) || 0;
  const off = Number(protocol.weeksOff) || 0;
  if (!(on > 0 && off > 0)) return { phase: 'on', day: offset + 1 };
  const cycleDays = (on + off) * 7;
  const inCycle = offset % cycleDays;
  const cycleNumber = Math.floor(offset / cycleDays) + 1;
  if (inCycle < on * 7) return { phase: 'on', day: inCycle + 1, of: on * 7, cycleNumber };
  return { phase: 'off', day: inCycle - on * 7 + 1, of: off * 7, cycleNumber };
}

export function dosesPerWeek(protocol) {
  const times = Math.max(1, (protocol.times || []).length || 1);
  switch (protocol.frequency) {
    case 'daily': return 7 * times;
    case 'everyN': return (7 / Math.max(1, Number(protocol.everyN) || 1)) * times;
    case 'weekdays': return (protocol.weekdays || []).length * times;
    default: return 0;
  }
}

// ---------- Vials ----------

// Amount left in a vial, in its base unit, after logged doses drawn from it.
export function vialRemaining(vial, doses) {
  const total = toBase(vial.amount, vial.unit);
  const used = doses
    .filter((d) => d.vialId === vial.id && sameKind(d.unit, vial.unit))
    .reduce((sum, d) => sum + toBase(d.amount, d.unit), 0);
  return { total, used, left: Math.max(0, total - used), baseUnit: isMass(vial.unit) ? 'mcg' : 'IU' };
}

// Days since mixing, and whether it's past its use-by window.
export function vialAge(vial, today) {
  if (!vial.mixedOn) return null;
  const age = daysBetween(vial.mixedOn, today);
  const limit = Number(vial.shelfDays) || 0;
  return { age, limit, expired: limit > 0 && age > limit, daysLeft: limit > 0 ? limit - age : null };
}

// Nice number formatting for the UI.
export function fmt(n, max = 2) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '–';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: max });
}

// Pick a readable mass unit for a mcg value.
export function fmtMass(mcg) {
  if (!Number.isFinite(mcg)) return '–';
  if (Math.abs(mcg) >= 1000) return `${fmt(mcg / 1000, 3)} mg`;
  return `${fmt(mcg, 1)} mcg`;
}

export function fmtBase(value, baseUnit) {
  return baseUnit === 'IU' ? `${fmt(value, 2)} IU` : fmtMass(value);
}
