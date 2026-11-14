import { K } from './params';
import { clamp, density, ssqrt } from './gas';
import type { Controls } from './types';

export interface NetworkIn {
  /** dynamic wind pressure at roof height, Pa */
  q: number;
  cpChimSide: number;
  cpWinSide: number;
  cpTop: number;
  /** flue stack pressure, Pa */
  stack: number;
  /** flue resistance, Pa·s²/kg² */
  rFlue: number;
  tOut: number;
}

export interface NetworkOut {
  /** stove room pressure relative to outdoors, Pa */
  p: number;
  /** flue flow, kg/s, positive = room → terminal */
  flue: number;
  /** flow through the stove-room leaks, kg/s, positive = inward */
  chimSide: number;
  /** flow through bedroom leaks + window (and so through the door), kg/s, positive = inward */
  winSide: number;
}

/** Two orifices in series behave like one with this Cd·A. */
function series(a: number, b: number): number {
  return 1 / Math.sqrt(1 / (a * a) + 1 / (b * b));
}

/** Effective Cd·A of the path outdoors → bedroom → door → stove room. */
export function winSideCdA(c: Controls, windowOpen: number = c.window): number {
  const ext = K.leakCdA + K.cd * K.windowMaxArea * clamp(windowOpen, 0, 1);
  const door = K.cd * (K.doorGapArea + K.doorArea * clamp(c.door, 0, 1));
  return series(ext, door);
}

/**
 * One pressure node (the stove room) connected to three paths. Solves the
 * mass balance  ṁ_chimSide + ṁ_winSide − ṁ_flue = 0  for the room pressure by
 * bisection; the balance is strictly decreasing in p, so the root is unique.
 */
export function solveNetwork(n: NetworkIn, cdaWinSide: number): NetworkOut {
  const rho2 = Math.sqrt(2 * density(n.tOut));
  const kL = K.leakCdA * rho2;
  const kR = cdaWinSide * rho2;
  const kF = 1 / Math.sqrt(n.rFlue);
  const pL = n.cpChimSide * n.q;
  const pR = n.cpWinSide * n.q;
  const pF = n.cpTop * n.q - n.stack;

  let lo = Math.min(pL, pR, pF);
  let hi = Math.max(pL, pR, pF);
  if (hi - lo > 1e-12) {
    for (let i = 0; i < 48; i++) {
      const mid = 0.5 * (lo + hi);
      const f = kL * ssqrt(pL - mid) + kR * ssqrt(pR - mid) - kF * ssqrt(mid - pF);
      if (f > 0) lo = mid;
      else hi = mid;
    }
  }
  const p = 0.5 * (lo + hi);
  const chimSide = kL * ssqrt(pL - p);
  const winSide = kR * ssqrt(pR - p);
  // Take the flue flow from the balance so that mass is conserved exactly.
  return { p, flue: chimSide + winSide, chimSide, winSide };
}

export interface CoFluxes {
  /** kg CO leaving through the flue with room air this step */
  outFlue: number;
  /** kg CO leaving through the envelope this step */
  outEnvelope: number;
}

/**
 * Advance the CO mass in the two well-mixed zones by dt. `co` is modified in
 * place. Every kilogram that leaves a zone is either added to the other zone
 * or returned in the fluxes, so the ledger closes exactly.
 */
export function stepRooms(
  co: [number, number],
  net: NetworkOut,
  spillKg: number,
  c: Controls,
  tOut: number,
  dt: number,
): CoFluxes {
  const rho = density(K.roomT);
  const v0 = K.volStove;
  const v1 = K.volBed;
  // volumes of room air moved along each path during dt, m³
  const flueOut = (Math.max(net.flue, 0) / rho) * dt;
  const leak0Out = (Math.max(-net.chimSide, 0) / rho) * dt;
  const leak1Out = (Math.max(-net.winSide, 0) / rho) * dt;
  const door10 = (Math.max(net.winSide, 0) / rho) * dt; // bedroom → stove room
  const door01 = (Math.max(-net.winSide, 0) / rho) * dt; // stove room → bedroom
  const door = clamp(c.door, 0, 1);
  const exch = (K.doorExchangeClosed + (K.doorExchangeOpen - K.doorExchangeClosed) * door) * dt;
  const bg = (K.achStack / 3600) * Math.sqrt(Math.abs(K.roomT - tOut) / 20) * dt;

  // Removal volumes may not exceed what an explicit step can take stably.
  const scale0 = Math.min(1, (0.5 * v0) / (flueOut + leak0Out + door01 + exch + bg * v0 + 1e-12));
  const scale1 = Math.min(1, (0.5 * v1) / (leak1Out + door10 + exch + bg * v1 + 1e-12));
  const c0 = (co[0] / v0) * scale0;
  const c1 = (co[1] / v1) * scale1;

  const outFlue = c0 * flueOut;
  const outEnv0 = c0 * (leak0Out + bg * v0);
  const outEnv1 = c1 * (leak1Out + bg * v1);
  const from0to1 = c0 * (door01 + exch);
  const from1to0 = c1 * (door10 + exch);

  co[0] += spillKg - outFlue - outEnv0 - from0to1 + from1to0;
  co[1] += from0to1 - from1to0 - outEnv1;
  if (co[0] < 0) co[0] = 0;
  if (co[1] < 0) co[1] = 0;
  return { outFlue, outEnvelope: outEnv0 + outEnv1 };
}
