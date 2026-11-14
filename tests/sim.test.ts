import { describe, expect, it } from 'vitest';
import {
  BASE_CONTROLS, FAMILY, K, NIGHT_SECONDS, Night, PRESETS, coInRooms, type Scenario,
} from '../src/model';

const run = (sc: Scenario): Night => {
  const n = new Night(sc);
  n.runToEnd();
  return n;
};

const residual = (n: Night): number => {
  const st = n.state.stats;
  return st.coProduced - st.coOutFlue - st.coOutEnvelope - coInRooms(n.state);
};

describe('CO mass balance', () => {
  it('is conserved in every preset: produced = in rooms + up the flue + through the envelope', () => {
    for (const [id, sc] of Object.entries(PRESETS)) {
      const n = run(sc);
      expect(n.state.stats.coProduced, id).toBeGreaterThan(0.05);
      expect(Math.abs(residual(n)) / n.state.stats.coProduced, id).toBeLessThan(1e-9);
    }
  });

  it('is conserved while the player keeps changing things', () => {
    const n = new Night(PRESETS.lodos);
    const moves = [
      { window: 1 }, { door: 0 }, { windDir: -1 as const }, { inlet: 0 }, { damper: 0 }, { window: 0, door: 1 },
      { wind: 18, gust: 30 }, { chimneyRel: 1.2 }, { soot: 1 }, { windDir: 1 as const, chimneyRel: -2 },
    ];
    moves.forEach((patch, i) => {
      n.advanceTo((i + 1) * 2400);
      n.set(patch);
    });
    n.runToEnd();
    expect(n.state.stats.coSpilled).toBeGreaterThan(0);
    expect(Math.abs(residual(n)) / n.state.stats.coProduced).toBeLessThan(1e-9);
    expect(n.state.co[0]).toBeGreaterThanOrEqual(0);
    expect(n.state.co[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('calm cold night with a hot flue', () => {
  it('never reverses and never spills, for any seed', () => {
    for (const seed of [1, 2, 3, 4, 5, 99, 12345]) {
      const n = run({ ...PRESETS.frost, seed });
      expect(n.state.stats.reversedS, `seed ${seed}`).toBe(0);
      expect(n.state.stats.spillS, `seed ${seed}`).toBe(0);
      expect(Math.min(...n.samples.map((s) => s.flow)), `seed ${seed}`).toBeGreaterThan(0);
      expect(Math.max(...n.samples.map((s) => s.ppm0)), `seed ${seed}`).toBe(0);
      for (const p of n.state.people) expect(p.peakPct).toBeLessThan(1);
    }
  });
});

describe('determinism', () => {
  it('the same seed gives the same night', () => {
    const a = run(PRESETS.lodos);
    const b = run(PRESETS.lodos);
    expect(b.samples).toEqual(a.samples);
    expect(b.state).toEqual(a.state);
  });

  it('a different seed gives a different night', () => {
    const a = run(PRESETS.lodos);
    const b = run({ ...PRESETS.lodos, seed: PRESETS.lodos.seed + 1 });
    expect(b.samples).not.toEqual(a.samples);
  });

  it('scrubbing back and forth reproduces the straight run exactly', () => {
    const straight = run(PRESETS.banked);
    const n = new Night(PRESETS.banked);
    n.seek(5 * 3600);
    n.seek(1.5 * 3600);
    n.seek(2 * 3600 + 14);
    n.seek(600);
    n.seek(NIGHT_SECONDS);
    expect(n.state).toEqual(straight.state);
    expect(n.samples).toEqual(straight.samples);
  });

  it('a change made after scrubbing back replaces the recorded future', () => {
    const n = run(PRESETS.lodos);
    const before = n.state.people.map((p) => p.peakPct);
    n.seek(1800);
    n.set({ chimneyRel: 1.2, cap: 'h', inlet: 0.6 });
    n.runToEnd();
    const direct = new Night(PRESETS.lodos);
    direct.advanceTo(1800);
    direct.set({ chimneyRel: 1.2, cap: 'h', inlet: 0.6 });
    direct.runToEnd();
    expect(n.state).toEqual(direct.state);
    n.state.people.forEach((p, i) => expect(p.peakPct).toBeLessThan(before[i]));
  });
});

describe('mechanisms', () => {
  it('lodos with a turned-down stove reverses the flue and raises COHb in everyone', () => {
    const n = run(PRESETS.lodos);
    expect(n.state.stats.reversedS).toBeGreaterThan(3600);
    expect(Math.max(...n.samples.map((s) => s.ppm0))).toBeGreaterThan(200);
    for (const p of n.state.people) expect(p.peakPct).toBeGreaterThan(20);
  });

  it('the same lodos night with the terminal above the ridge does not reverse', () => {
    const n = run({ ...PRESETS.lodos, controls: { ...PRESETS.lodos.controls, chimneyRel: 1 } });
    expect(n.state.stats.reversedS).toBe(0);
  });

  it('banking the stove is what turns a breezy night into spillage', () => {
    const banked = run(PRESETS.banked);
    const lively = run({ ...PRESETS.banked, events: [] });
    expect(banked.state.stats.coSpilled).toBeGreaterThan(lively.state.stats.coSpilled * 5);
    // nearly all of it comes after midnight, when the stove was shut down
    const untilMidnight = banked.samples.filter((s) => s.t <= 7200);
    const after = banked.samples.filter((s) => s.t > 7200);
    expect(Math.max(...after.map((s) => s.ppm0))).toBeGreaterThan(5 * Math.max(...untilMidnight.map((s) => s.ppm0)));
  });

  it('an almost blocked flue leaks combustion gas without ever reversing', () => {
    const n = run(PRESETS.soot);
    expect(n.state.stats.reversedS).toBe(0);
    expect(n.state.stats.throttledS).toBeGreaterThan(3600);
    const swept = run({ ...PRESETS.soot, controls: { ...PRESETS.soot.controls, soot: 0.1 } });
    expect(swept.state.stats.spillS).toBe(0);
  });

  it('opening the window helps on the windward side and hurts on the leeward side', () => {
    const c = { ...PRESETS.lodos.controls, chimneyRel: -0.3 };
    const spilled = (patch: object) => run({ seed: 7, controls: { ...c, ...patch } }).state.stats.coSpilled;
    expect(spilled({ windDir: 1, window: 0.4 })).toBeGreaterThan(spilled({ windDir: 1, window: 0 }));
    expect(spilled({ windDir: -1, window: 0.4 })).toBeLessThanOrEqual(spilled({ windDir: -1, window: 0 }));
  });

  it('a CO alarm wakes the family and their COHb stays far lower', () => {
    const asleep = run(PRESETS.lodos);
    const alarmed = run({ ...PRESETS.lodos, controls: { ...PRESETS.lodos.controls, alarm: true } });
    expect(alarmed.state.alarm.sounded).toBe(true);
    expect(alarmed.state.people.every((p) => p.evacuated)).toBe(true);
    FAMILY.forEach((_, i) => {
      expect(alarmed.state.people[i].peakPct).toBeLessThan(asleep.state.people[i].peakPct / 2);
    });
    // nobody reacts without one
    expect(asleep.state.people.some((p) => p.evacuated)).toBe(false);
  });

  it('no alarm sounds on a night without CO', () => {
    const n = run({ ...PRESETS.frost, controls: { ...PRESETS.frost.controls, alarm: true } });
    expect(n.state.alarm.sounded).toBe(false);
  });
});

describe('numerical health', () => {
  it('produces finite numbers at the corners of the control space', () => {
    const corners = [
      { wind: 0, gust: 0, inlet: 0, damper: 0 },
      { wind: 30, gust: 45, window: 1, door: 1, chimneyRel: K.chimRelMin },
      { tOut: 25, inlet: 0, soot: 1, damper: 0 },
      { tOut: -25, inlet: 1, wind: 25, gust: 40, windDir: -1 as const, window: 1, door: 1 },
      { align: 0, wind: 15, gust: 25, cap: 'rain' as const },
    ];
    for (const patch of corners) {
      const n = run({ seed: 3, controls: { ...BASE_CONTROLS, ...patch } });
      for (const s of n.samples) {
        for (const v of [s.draught, s.collar, s.flow, s.ppm0, s.ppm1, s.stack, ...s.cohb]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(s.ppm0).toBeGreaterThanOrEqual(0);
      }
      expect(Math.abs(residual(n))).toBeLessThan(1e-9);
    }
  });

  it('runs one night in well under a second', () => {
    const t0 = performance.now();
    run(PRESETS.lodos);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
