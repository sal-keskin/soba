import { K } from './params';
import { BASE_CONTROLS } from './presets';
import { createState, NIGHT_SECONDS, step } from './sim';
import type { ControlEvent, Scenario } from './night';
import type { Controls } from './types';

/** One hourly forecast point. Wind values are at 10 m, in m/s. */
export interface ForecastHour {
  /** outdoor temperature, °C */
  tOut: number;
  /** mean wind speed, m/s */
  wind: number;
  /** gust speed, m/s */
  gust: number;
  /** direction the wind comes FROM, degrees clockwise from north */
  dirDeg: number;
}

export type RiskLevel = 'lower' | 'raised' | 'higher';

export interface HourRisk {
  /** index of the hour within the night, 0 = 22:00–23:00 */
  hour: number;
  /** relative draught-failure risk index, 0–1 */
  risk: number;
  level: RiskLevel;
  /** fraction of the hour with net draught below the weak-draught threshold */
  weakFrac: number;
  /** fraction of the hour with any spillage */
  spillFrac: number;
  /** mean net pressure driving the flue, Pa */
  meanDraught: number;
  /** which side the wind came from in the orientation that was used */
  windDir: 1 | -1;
}

/**
 * The standard house of Tonight mode. It is deliberately a common at-risk
 * installation, because a well-built one shows no difference between nights:
 * stove turned down for the night, pipe ending 1 m below the ridge without a
 * cap, a flue that is due for sweeping, window shut, inner door open.
 */
export const TONIGHT_HOUSE: Controls = {
  ...BASE_CONTROLS,
  inlet: 0.25,
  damper: 0.7,
  chimneyRel: -1,
  cap: 'none',
  soot: 0.3,
  window: 0,
  door: 1,
  alarm: false,
};

export function riskLevel(risk: number): RiskLevel {
  return risk >= K.riskHigh ? 'higher' : risk >= K.riskLow ? 'raised' : 'lower';
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/** Interpolate a wind direction the short way round the compass. */
function lerpDir(a: number, b: number, f: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

/** Controls of the house at time t (s) of a forecast night. */
export function controlsAt(
  hours: ForecastHour[],
  facingDeg: number | null,
  forcedDir: 1 | -1,
  house: Controls,
  t: number,
): Controls {
  const n = hours.length - 1;
  const x = Math.min(Math.max(t, 0) / 3600, n - 1e-9);
  const i = Math.floor(x);
  const f = x - i;
  const a = hours[i];
  const b = hours[i + 1];
  const wind = Math.max(0, lerp(a.wind, b.wind, f));
  const c: Controls = {
    ...house,
    tOut: lerp(a.tOut, b.tOut, f),
    wind,
    gust: Math.max(wind, lerp(a.gust, b.gust, f)),
    windDir: forcedDir,
    align: 1,
  };
  if (facingDeg !== null) {
    const along = Math.cos(((lerpDir(a.dirDeg, b.dirDeg, f) - facingDeg) * Math.PI) / 180);
    c.windDir = along >= 0 ? 1 : -1;
    c.align = Math.abs(along);
  }
  return c;
}

/** A playable scenario that follows the forecast in ten-minute steps. */
export function forecastScenario(
  hours: ForecastHour[],
  facingDeg: number | null,
  forcedDir: 1 | -1,
  seed = 1,
  house: Controls = TONIGHT_HOUSE,
): Scenario {
  const pts = hours.slice(0, NIGHT_SECONDS / 3600 + 1);
  const round = (c: Controls): Partial<Controls> => ({
    tOut: Math.round(c.tOut * 10) / 10,
    wind: Math.round(c.wind * 10) / 10,
    gust: Math.round(c.gust * 10) / 10,
    windDir: c.windDir,
    align: Math.round(c.align * 100) / 100,
  });
  const events: ControlEvent[] = [];
  for (let t = 600; t < (pts.length - 1) * 3600; t += 600) {
    events.push({ t, patch: round(controlsAt(pts, facingDeg, forcedDir, house, t)) });
  }
  const first = controlsAt(pts, facingDeg, forcedDir, house, 0);
  return { seed, controls: { ...first, ...round(first) }, events };
}

function runOnce(
  hours: ForecastHour[],
  facingDeg: number | null,
  forcedDir: 1 | -1,
  seed: number,
  house: Controls,
): { weak: number[]; spill: number[]; draught: number[] } {
  const n = hours.length - 1;
  const weak = new Array<number>(n).fill(0);
  const spill = new Array<number>(n).fill(0);
  const draught = new Array<number>(n).fill(0);
  const at = (t: number): Controls => controlsAt(hours, facingDeg, forcedDir, house, t);
  const s = createState(at(0), seed);
  const steps = (n * 3600) / K.dt;
  const perHour = 3600 / K.dt;
  for (let k = 0; k < steps; k++) {
    step(s, at(s.t));
    const h = Math.min(Math.floor(k / perHour), n - 1);
    if (s.diag.draught < K.weakDraughtPa) weak[h]++;
    if (s.diag.spill > 0) spill[h]++;
    draught[h] += s.diag.draught;
  }
  for (let h = 0; h < n; h++) {
    weak[h] /= perHour;
    spill[h] /= perHour;
    draught[h] /= perHour;
  }
  return { weak, spill, draught };
}

/**
 * Relative draught-failure risk for each hour of a night.
 *
 * @param hours     forecast points one hour apart; N+1 points give N hours
 *                  (9 points for 22:00–06:00)
 * @param facingDeg compass direction the chimney side of the house faces, or
 *                  null if unknown (both orientations are run, the worse shown)
 * @param seeds     gust realisations to average over
 */
export function nightRisk(
  hours: ForecastHour[],
  facingDeg: number | null = null,
  seeds: number[] = [1, 2, 3],
  house: Controls = TONIGHT_HOUSE,
): HourRisk[] {
  if (hours.length < 2) return [];
  const n = Math.min(hours.length - 1, NIGHT_SECONDS / 3600);
  const pts = hours.slice(0, n + 1);
  const dirs: (1 | -1)[] = facingDeg === null ? [1, -1] : [1];
  const out: HourRisk[] = [];
  const perDir = dirs.map((dir) => {
    const acc = { weak: new Array<number>(n).fill(0), spill: new Array<number>(n).fill(0), draught: new Array<number>(n).fill(0) };
    for (const seed of seeds) {
      const r = runOnce(pts, facingDeg, dir, seed, house);
      for (let h = 0; h < n; h++) {
        acc.weak[h] += r.weak[h] / seeds.length;
        acc.spill[h] += r.spill[h] / seeds.length;
        acc.draught[h] += r.draught[h] / seeds.length;
      }
    }
    return acc;
  });
  for (let h = 0; h < n; h++) {
    let best: HourRisk | null = null;
    perDir.forEach((acc, i) => {
      const risk = 0.5 * acc.weak[h] + 0.5 * acc.spill[h];
      if (!best || risk > best.risk) {
        let windDir: 1 | -1 = dirs[i];
        if (facingDeg !== null) {
          const mid = lerpDir(pts[h].dirDeg, pts[h + 1].dirDeg, 0.5);
          windDir = Math.cos(((mid - facingDeg) * Math.PI) / 180) >= 0 ? 1 : -1;
        }
        best = {
          hour: h, risk, level: riskLevel(risk), weakFrac: acc.weak[h], spillFrac: acc.spill[h],
          meanDraught: acc.draught[h], windDir,
        };
      }
    });
    out.push(best!);
  }
  return out;
}
