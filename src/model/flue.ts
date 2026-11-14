import { K } from './params';
import { clamp, density } from './gas';
import type { Controls } from './types';

/** Chimney height from the pipe entry to the terminal, m. */
export function chimneyHeight(c: Controls): number {
  return K.chimBaseToRidge + clamp(c.chimneyRel, K.chimRelMin, K.chimRelMax);
}

/** 0 when the terminal is clear above the ridge, 1 when it is in the roof zone. */
export function roofZoneWeight(chimneyRel: number): number {
  return clamp((K.ridgeClearance - chimneyRel) / K.ridgeBlend, 0, 1);
}

/** Wall pressure coefficients: [chimney side, window side]. */
export function facadeCp(c: Controls): [number, number] {
  const a = clamp(c.align, 0, 1);
  const wind = a * K.cpWallWind + (1 - a) * K.cpCross;
  const lee = a * K.cpWallLee + (1 - a) * K.cpCross;
  return c.windDir === 1 ? [wind, lee] : [lee, wind];
}

/**
 * Pressure coefficient at the chimney terminal. `wake` is a unit-variance
 * noise value; it only acts while the terminal is in the roof zone.
 */
export function terminalCp(c: Controls, wake: number): number {
  const w = roofZoneWeight(c.chimneyRel);
  const a = clamp(c.align, 0, 1);
  const zoneMean = c.windDir === 1 ? K.cpTopWindSlope : K.cpTopLee;
  const zoneSigma = c.windDir === 1 ? K.cpWakeSigmaWind : K.cpWakeSigmaLee;
  const zone = a * (zoneMean + zoneSigma * wake) + (1 - a) * K.cpCross;
  let cp = (1 - w) * K.cpTopFree + w * zone;
  if (cp > 0) {
    if (c.cap === 'rain') cp *= K.capRainAdverse;
    else if (c.cap === 'h') cp *= K.capHAdverse;
  }
  return cp;
}

/** Free-area fraction left by soot. */
function sootArea(soot: number): number {
  return 1 - K.sootAreaLoss * clamp(soot, 0, 1);
}

/** Loss coefficient of the butterfly damper for opening 0–1. */
export function damperK(damper: number): number {
  const phi = K.damperMinOpen + (1 - K.damperMinOpen) * clamp(damper, 0, 1);
  const cc = 0.62 + 0.38 * phi * phi * phi;
  const k = 1 / (cc * phi) - 1;
  return K.kDamperOpen + k * k;
}

/**
 * Flow resistance R of the whole path room → stove → pipe → chimney → terminal,
 * defined by Δp = R·ṁ·|ṁ|  (Pa·s²/kg²).
 */
export function flueResistance(c: Controls, pipeT: number, chimT: number): { total: number; stove: number } {
  const s = sootArea(c.soot);
  const f = K.frictionClean + K.frictionSoot * clamp(c.soot, 0, 1);

  const stoveCdA =
    K.cd * (K.stoveInletArea * clamp(c.inlet, 0, 1) + K.stoveLeakArea);
  const rStove = 1 / (2 * density(K.roomT) * stoveCdA * stoveCdA);

  const aPipe = (Math.PI / 4) * K.pipeDia * K.pipeDia * s;
  const dPipe = K.pipeDia * Math.sqrt(s);
  const kPipe = (f * K.pipeLen) / dPipe + K.nElbows * K.kElbow + damperK(c.damper);
  const rPipe = kPipe / (2 * density(pipeT) * aPipe * aPipe);

  const aChim = (Math.PI / 4) * K.chimDia * K.chimDia * s;
  const dChim = K.chimDia * Math.sqrt(s);
  const kCap = c.cap === 'rain' ? K.kCapRain : c.cap === 'h' ? K.kCapH : 0;
  const kChim = (f * chimneyHeight(c)) / dChim + K.kExit + kCap;
  const rChim = kChim / (2 * density(chimT) * aChim * aChim);

  return { total: rStove + rPipe + rChim, stove: rStove };
}

/**
 * Buoyancy of the hot gas inside the stove body, Pa. Unless the suction at
 * the stove collar exceeds this, the top of the firebox is above room pressure
 * and gas escapes through lid and door gaps.
 */
export function fireboxBuoyancy(): number {
  return K.g * K.fireboxHeight * (density(K.roomT) - density(K.fireboxGasT));
}

export interface FlueThermal {
  /** gas temperature at the stove collar, °C */
  tIn: number;
  /** quasi-steady mean gas temperature of the indoor pipe, °C */
  pipeMean: number;
  /** quasi-steady mean gas temperature of the chimney, °C */
  chimMean: number;
  /** heat flow from the gas into the chimney wall, W (negative cools the wall) */
  toWall: number;
}

/** (1 − e^−n)/n, the mean of an exponential approach over NTU n. */
function meanFactor(n: number): number {
  return n < 1e-6 ? 1 : (1 - Math.exp(-n)) / n;
}

/**
 * Quasi-steady gas temperatures along the flue for a signed mass flow.
 * Upward: hot gas from the stove cools to the room along the pipe, then to
 * the chimney wall. Reversed: outdoor air enters at the top, is tempered by
 * the wall, then by the room.
 */
export function flueThermal(
  flow: number,
  flueHeat: number,
  wallT: number,
  tOut: number,
  c: Controls,
): FlueThermal {
  const m = Math.max(Math.abs(flow), 1e-6);
  const mcp = m * K.cpGas;
  const h = chimneyHeight(c);
  const nPipe = (K.pipeU * Math.PI * K.pipeDia * K.pipeLen) / mcp;
  const nChim = (K.chimHi * Math.PI * K.chimDia * h) / mcp;
  const room = K.roomT;

  if (flow >= 0) {
    const tIn = Math.min(K.flueTinMax, room + flueHeat / mcp);
    const pipeExit = room + (tIn - room) * Math.exp(-nPipe);
    const pipeMean = room + (tIn - room) * meanFactor(nPipe);
    const chimExit = wallT + (pipeExit - wallT) * Math.exp(-nChim);
    const chimMean = wallT + (pipeExit - wallT) * meanFactor(nChim);
    return { tIn, pipeMean, chimMean, toWall: mcp * (pipeExit - chimExit) };
  }
  const chimExit = wallT + (tOut - wallT) * Math.exp(-nChim);
  const chimMean = wallT + (tOut - wallT) * meanFactor(nChim);
  const pipeMean = room + (chimExit - room) * meanFactor(nPipe);
  return { tIn: room, pipeMean, chimMean, toWall: mcp * (tOut - chimExit) };
}

/** Stack pressure of the two vertical sections of the flue, Pa. */
export function flueStack(pipeT: number, chimT: number, tOut: number, c: Controls): number {
  const rhoOut = density(tOut);
  return (
    K.g *
    (K.pipeRise * (rhoOut - density(pipeT)) + chimneyHeight(c) * (rhoOut - density(chimT)))
  );
}
