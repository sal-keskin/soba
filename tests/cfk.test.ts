import { describe, expect, it } from 'vitest';
import { PEOPLE, capacity, cfkEquilibrium, cfkStep, percent, stageOf } from '../src/model';

const adult = PEOPLE.adult;

/** Hold a constant concentration for a number of hours; returns %COHb. */
function expose(startPct: number, ppm: number, hours: number, person = adult, dt = 2): number {
  let x = (startPct / 100) * capacity(person);
  for (let t = 0; t < hours * 3600; t += dt) x = cfkStep(x, ppm, person, dt);
  return percent(x, person);
}

describe('Coburn–Forster–Kane', () => {
  it('constant 100 ppm approaches about 13–14 % COHb (Haldane equilibrium)', () => {
    const eq = percent(cfkEquilibrium(100, adult), adult);
    expect(eq).toBeGreaterThan(13);
    expect(eq).toBeLessThan(14);
    // integrating long enough lands on the same value
    expect(expose(0.5, 100, 72)).toBeCloseTo(eq, 1);
  });

  it('the approach to equilibrium takes hours, not minutes', () => {
    const after1h = expose(0.5, 100, 1);
    const after8h = expose(0.5, 100, 8);
    expect(after1h).toBeLessThan(3.5);
    expect(after8h).toBeGreaterThan(9);
    expect(after8h).toBeLessThan(13);
  });

  /** Hours for the excess over the clean-air baseline to halve, starting from startPct. */
  function washoutHalfTime(startPct: number): number {
    const base = percent(cfkEquilibrium(0, adult), adult);
    const half = base + (startPct - base) / 2;
    let x = (startPct / 100) * capacity(adult);
    let t = 0;
    while (percent(x, adult) > half) {
      x = cfkStep(x, 0, adult, 2);
      t += 2;
    }
    return t / 3600;
  }

  it('clean-air washout half-time is about 4–5 h for a resting adult', () => {
    // Measured half-times come from volunteers at mild saturations (up to ~10 %).
    for (const start of [2, 5, 10]) {
      expect(washoutHalfTime(start)).toBeGreaterThan(4);
      expect(washoutHalfTime(start)).toBeLessThan(5);
    }
  });

  it('washout is faster from higher saturation (the equation is nonlinear)', () => {
    expect(washoutHalfTime(40)).toBeLessThan(washoutHalfTime(20));
    expect(washoutHalfTime(20)).toBeLessThan(washoutHalfTime(5));
    expect(washoutHalfTime(40)).toBeGreaterThan(2.5);
  });

  it('endogenous baseline in clean air is well under 1 %', () => {
    const base = percent(cfkEquilibrium(0, adult), adult);
    expect(base).toBeGreaterThan(0.1);
    expect(base).toBeLessThan(1);
  });

  it('equilibrium does not depend on body size, but children and infants get there faster', () => {
    for (const kind of ['older', 'child', 'infant'] as const) {
      const eq = percent(cfkEquilibrium(200, PEOPLE[kind]), PEOPLE[kind]);
      expect(eq).toBeCloseTo(percent(cfkEquilibrium(200, adult), adult), 0);
    }
    const a = expose(0.3, 200, 1, adult);
    expect(expose(0.3, 200, 1, PEOPLE.child)).toBeGreaterThan(a * 1.3);
    expect(expose(0.3, 200, 1, PEOPLE.infant)).toBeGreaterThan(a * 1.3);
  });

  it('the result does not depend on the step size', () => {
    expect(expose(0.5, 400, 3, adult, 2)).toBeCloseTo(expose(0.5, 400, 3, adult, 30), 2);
  });

  it('stays within physical bounds at extreme concentrations', () => {
    const pct = expose(0.5, 50000, 8);
    expect(pct).toBeGreaterThan(90);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('maps %COHb to symptom stages', () => {
    expect([5, 12, 25, 35, 45, 60].map(stageOf)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
