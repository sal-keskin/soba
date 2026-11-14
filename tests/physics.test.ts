import { describe, expect, it } from 'vitest';
import {
  BASE_CONTROLS, K, PARAM_TABLE, coKgPerM3PerPpm, coYield, damperK, density, facadeCp, flueResistance,
  flueThermal, roofZoneWeight, solveNetwork, stackPressure, stove, terminalCp, winSideCdA,
} from '../src/model';

describe('gas law and stack pressure', () => {
  it('air density at 0 °C is about 1.29 kg/m³', () => {
    expect(density(0)).toBeCloseTo(1.292, 2);
  });

  it('5 m chimney, 150 °C flue, 0 °C outside gives about 22 Pa', () => {
    const dp = stackPressure(5, 0, 150);
    expect(dp).toBeGreaterThan(21.5);
    expect(dp).toBeLessThan(23);
  });

  it('stack pressure is zero without a temperature difference and negative for a cold column', () => {
    expect(stackPressure(5, 10, 10)).toBeCloseTo(0, 10);
    expect(stackPressure(5, 10, 0)).toBeLessThan(0);
  });

  it('1 ppm CO is about 1.165 mg/m³ at 20 °C', () => {
    expect(coKgPerM3PerPpm(20) * 1e6).toBeCloseTo(1.165, 2);
  });
});

describe('stove', () => {
  it('CO yield rises monotonically and sharply as air is restricted', () => {
    const y = [1, 0.75, 0.5, 0.25, 0].map(coYield);
    for (let i = 1; i < y.length; i++) expect(y[i]).toBeGreaterThan(y[i - 1]);
    expect(y[4] / y[0]).toBeGreaterThan(5);
  });

  it('full burn is a few kW and banking reduces heat but raises CO per kg', () => {
    const full = stove(1, 8, 0.01);
    const banked = stove(0.05, 8, 0.01);
    expect(full.heat).toBeGreaterThan(5000);
    expect(full.heat).toBeLessThan(10000);
    expect(banked.heat).toBeLessThan(full.heat / 3);
    expect(banked.coYield).toBeGreaterThan(full.coYield * 5);
  });

  it('burns nothing without fuel', () => {
    expect(stove(1, 0, 0.01).burn).toBe(0);
  });
});

describe('flue', () => {
  it('terminal above the ridge is aspirated by wind from either side', () => {
    for (const windDir of [1, -1] as const) {
      expect(terminalCp({ ...BASE_CONTROLS, chimneyRel: 1, windDir }, 0)).toBeLessThan(0);
    }
  });

  it('terminal below the ridge on the windward slope sees positive pressure; an H cap reduces it', () => {
    const c = { ...BASE_CONTROLS, chimneyRel: -1, windDir: 1 as const };
    const open = terminalCp(c, 0);
    expect(open).toBeGreaterThan(0);
    expect(terminalCp({ ...c, cap: 'h' }, 0)).toBeLessThan(open);
    expect(roofZoneWeight(-1)).toBe(1);
    expect(roofZoneWeight(K.ridgeClearance)).toBe(0);
  });

  it('wind along the ridge loads both walls equally', () => {
    const [a, b] = facadeCp({ ...BASE_CONTROLS, align: 0 });
    expect(a).toBe(b);
  });

  it('closing the damper and soot both raise the resistance', () => {
    expect(damperK(0)).toBeGreaterThan(damperK(0.5));
    expect(damperK(0.5)).toBeGreaterThan(damperK(1));
    const clean = flueResistance({ ...BASE_CONTROLS, soot: 0 }, 100, 60).total;
    const dirty = flueResistance({ ...BASE_CONTROLS, soot: 1 }, 100, 60).total;
    expect(dirty).toBeGreaterThan(clean * 3);
  });

  it('upward gas cools along the flue; reversed flow fills it with tempered outdoor air', () => {
    const up = flueThermal(0.006, 2000, 40, 0, BASE_CONTROLS);
    expect(up.tIn).toBeGreaterThan(up.pipeMean);
    expect(up.pipeMean).toBeGreaterThan(up.chimMean);
    expect(up.toWall).toBeGreaterThan(0);
    const down = flueThermal(-0.006, 2000, 40, 0, BASE_CONTROLS);
    expect(down.chimMean).toBeLessThan(40);
    expect(down.chimMean).toBeGreaterThan(0);
    expect(down.toWall).toBeLessThan(0);
  });
});

describe('air flow network', () => {
  const base = { q: 20, cpChimSide: 0.7, cpWinSide: -0.3, cpTop: -0.4, stack: 10, rFlue: 3e5, tOut: 5 };

  it('closes the mass balance', () => {
    const n = solveNetwork(base, winSideCdA(BASE_CONTROLS));
    expect(n.chimSide + n.winSide - n.flue).toBeCloseTo(0, 12);
    expect(n.flue).toBeGreaterThan(0);
  });

  it('an open leeward window depressurises the room; an open windward window pressurises it', () => {
    const shut = solveNetwork(base, winSideCdA({ ...BASE_CONTROLS, door: 1, window: 0 }));
    const lee = solveNetwork(base, winSideCdA({ ...BASE_CONTROLS, door: 1, window: 1 }));
    expect(lee.p).toBeLessThan(shut.p);
    expect(lee.p).toBeLessThan(0);
    const flipped = { ...base, cpChimSide: -0.3, cpWinSide: 0.7 };
    const windward = solveNetwork(flipped, winSideCdA({ ...BASE_CONTROLS, door: 1, window: 1 }));
    expect(windward.p).toBeGreaterThan(solveNetwork(flipped, winSideCdA({ ...BASE_CONTROLS, door: 1 })).p);
    expect(windward.p).toBeGreaterThan(0);
  });

  it('reverses the flue when the terminal pressure exceeds stack plus room pressure', () => {
    const n = solveNetwork({ ...base, cpTop: 0.4, stack: 1, cpChimSide: -0.3, cpWinSide: -0.3 }, winSideCdA(BASE_CONTROLS));
    expect(n.flue).toBeLessThan(0);
  });

  it('with no wind and no stack nothing moves', () => {
    const n = solveNetwork({ ...base, q: 0, stack: 0 }, winSideCdA(BASE_CONTROLS));
    expect(Math.abs(n.flue)).toBeLessThan(1e-9);
  });
});

describe('parameter table', () => {
  it('every constant has a unit, a source and a finite value', () => {
    for (const [name, prm] of Object.entries(PARAM_TABLE)) {
      expect(Number.isFinite(prm.value), name).toBe(true);
      expect(prm.unit.length, name).toBeGreaterThan(0);
      expect(prm.source.length, name).toBeGreaterThan(5);
    }
  });
});
