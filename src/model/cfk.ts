import { K, PersonParams } from './params';

/**
 * Coburn–Forster–Kane equation (Coburn, Forster & Kane 1965), nonlinear form:
 *
 *   d[COHb]/dt = V̇co/Vb − [COHb]·PcO2 / (M·B·Vb·[O2Hb]) + PiCO / (B·Vb)
 *   B = 1/DL + PL/V̇A,   PL = PB − 47 mmHg,   [O2Hb] = cap − [COHb]
 *
 * [COHb] and [O2Hb] are in mL gas per mL blood, time in minutes, pressures in
 * mmHg, volumes in mL. cap = 1.38·Hb is the oxygen capacity of the blood.
 */

/** Oxygen (and CO) capacity of blood, mL gas per mL blood. */
export function capacity(person: PersonParams): number {
  return K.hufner * person.hb;
}

function resistanceB(person: PersonParams): number {
  return 1 / person.dl + (K.pB - K.pH2O) / person.va;
}

/** Endogenous CO production scaled with blood volume, mL/min. */
function vco(person: PersonParams): number {
  return (K.vcoEndo * person.vb) / 5500;
}

/** Rate of change of [COHb], mL/mL per minute. */
export function cfkRate(cohb: number, ppm: number, person: PersonParams): number {
  const cap = capacity(person);
  const b = resistanceB(person);
  const piCO = ppm * 1e-6 * (K.pB - K.pH2O);
  const o2hb = Math.max(cap - cohb, cap * 1e-6);
  return (
    vco(person) / person.vb -
    (cohb * K.pcO2) / (K.haldaneM * b * person.vb * o2hb) +
    piCO / (b * person.vb)
  );
}

/** Advance [COHb] by dtSeconds at a constant inspired concentration (RK2). */
export function cfkStep(cohb: number, ppm: number, person: PersonParams, dtSeconds: number): number {
  const h = dtSeconds / 60;
  const k1 = cfkRate(cohb, ppm, person);
  const k2 = cfkRate(cohb + 0.5 * h * k1, ppm, person);
  const next = cohb + h * k2;
  const cap = capacity(person);
  return next < 0 ? 0 : next > cap ? cap : next;
}

/** Equilibrium [COHb] for a constant inspired concentration (Haldane limit). */
export function cfkEquilibrium(ppm: number, person: PersonParams): number {
  const cap = capacity(person);
  const piCO = ppm * 1e-6 * (K.pB - K.pH2O);
  const ratio = (K.haldaneM * (piCO + vco(person) * resistanceB(person))) / K.pcO2;
  return (cap * ratio) / (1 + ratio);
}

/** Per cent of haemoglobin bound to CO. */
export function percent(cohb: number, person: PersonParams): number {
  return (100 * cohb) / capacity(person);
}

/** Symptom stage 0–5 from %COHb (see params: stage1…stage5). */
export function stageOf(pct: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (pct >= K.stage5) return 5;
  if (pct >= K.stage4) return 4;
  if (pct >= K.stage3) return 3;
  if (pct >= K.stage2) return 2;
  if (pct >= K.stage1) return 1;
  return 0;
}
