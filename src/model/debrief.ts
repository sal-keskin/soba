import { FAMILY, K, type PersonKind } from './params';
import { stageOf } from './cfk';
import { coYield } from './stove';
import type { Night } from './night';

/** A sentence of the debrief as a translation key plus values. */
export interface Finding {
  key: string;
  vars?: Record<string, number | string>;
}

export interface Debrief {
  /** 'none' | 'mild' | 'severe' */
  outcome: 'none' | 'mild' | 'severe';
  alarmAt: number;
  people: { kind: PersonKind; peakPct: number; stage: number; evacuated: boolean }[];
  mechanisms: Finding[];
  /** exactly three */
  actions: string[];
}

/**
 * Which mechanism caused what during the recorded night, from the running
 * statistics of the simulation and the final controls.
 */
export function debrief(night: Night): Debrief {
  const st = night.state.stats;
  const c = night.controls;
  const people = night.state.people.map((p, i) => ({
    kind: FAMILY[i].kind,
    peakPct: p.peakPct,
    stage: stageOf(p.peakPct),
    evacuated: p.evacuated,
  }));
  const worst = Math.max(...people.map((p) => p.stage));
  const outcome = worst >= 4 ? 'severe' : worst >= 1 || st.coSpilled > 0.005 ? 'mild' : 'none';
  const mechanisms: Finding[] = [];
  const flags = { wind: false, stack: false, window: false, yield: false, throttle: false };

  if (st.spillS < 60) {
    const min = Math.min(...night.samples.map((s) => s.collar));
    mechanisms.push({ key: 'm_none', vars: { min: Math.max(0, min) } });
  } else {
    const avgTop = st.sumTop / st.spillS; // negative = adverse
    const avgStack = st.sumStack / st.spillS;
    const avgWindow = st.sumWindow / st.spillS;
    if (st.reversedS >= 60) {
      mechanisms.push({ key: 'm_reversed', vars: { min: Math.round(st.reversedS / 60), t: st.firstSpillT } });
    }
    if (avgTop < -1) {
      flags.wind = true;
      mechanisms.push({
        key: 'm_wind',
        vars: { pa: -avgTop, rel: Math.abs(c.chimneyRel), side: c.chimneyRel < 0 ? 'below' : 'above' },
      });
    } else if (st.reversedS >= 60 && c.chimneyRel < K.ridgeClearance && c.windDir === -1 && c.wind > 2) {
      flags.wind = true;
      mechanisms.push({ key: 'm_wake' });
    }
    if (avgWindow < -0.5) {
      flags.window = true;
      mechanisms.push({ key: 'm_window', vars: { pa: -avgWindow } });
    }
    if (avgStack < 0.7 * st.stack0 || avgStack < 6) {
      flags.stack = true;
      mechanisms.push({
        key: 'm_stack',
        vars: { p0: st.stack0, p1: avgStack, why: c.inlet < 0.2 ? 'm_stackBanked' : c.tOut >= 8 ? 'm_stackWarm' : 'm_stackBanked' },
      });
    }
    const y = st.coSpilled > 0 ? st.sumYieldSpilled / st.coSpilled : 0;
    if (y > 0.1) {
      flags.yield = true;
      mechanisms.push({ key: 'm_yield', vars: { g: y * 1000, g0: coYield(1) * 1000 } });
    }
    if (st.throttledS >= 600) {
      flags.throttle = true;
      mechanisms.push({
        key: 'm_throttle',
        vars: {
          min: Math.round(st.throttledS / 60),
          cause: c.soot >= 0.8 ? 'causeSoot' : c.damper <= 0.3 ? 'causeDamper' : 'causeWeak',
        },
      });
    }
    mechanisms.push({
      key: 'm_co',
      vars: {
        g: st.coSpilled * 1000,
        ppm0: Math.max(...night.samples.map((s) => s.ppm0)),
        ppm1: Math.max(...night.samples.map((s) => s.ppm1)),
      },
    });
  }

  // Three actions: the alarm always, then whatever the night pointed at.
  const actions: string[] = [night.state.alarm.sounded ? 'a_alarmWorked' : 'a_alarm'];
  const ranked: [boolean, string][] = [
    [flags.window, 'a_window'],
    [flags.wind, 'a_chimney'],
    [flags.throttle, 'a_sweep'],
    [flags.stack || flags.yield, 'a_bank'],
    [true, 'a_bank'],
    [true, 'a_chimney'],
    [true, 'a_sweep'],
  ];
  for (const [on, key] of ranked) {
    if (actions.length >= 3) break;
    if (on && !actions.includes(key)) actions.push(key);
  }

  return { outcome, alarmAt: night.state.alarm.tSounded, people, mechanisms, actions };
}
