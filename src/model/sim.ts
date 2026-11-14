import { FAMILY, K, PEOPLE } from './params';
import { cfkEquilibrium, cfkStep, percent } from './cfk';
import { clamp, coKgPerM3PerPpm, density, dynamicPressure } from './gas';
import { facadeCp, fireboxBuoyancy, flueResistance, flueStack, flueThermal, terminalCp, chimneyHeight } from './flue';
import { solveNetwork, stepRooms, winSideCdA } from './rooms';
import { ouStep } from './rng';
import { stove } from './stove';
import type { Controls, Diag, SimState, Stats } from './types';

export const NIGHT_SECONDS = K.nightHours * 3600;

const emptyDiag = (): Diag => ({
  vRoof: 0, q: 0, cpTop: 0, pRoom: 0, stack: 0, pTop: 0, draught: 0, collar: 0, flueFlow: 0,
  flueTin: K.roomT, pipeT: K.roomT, chimT: K.roomT, burn: 0, heat: 0, coYield: 0,
  coRate: 0, spill: 0, ppm: [0, 0], flowChimSide: 0, flowWinSide: 0, windowEffect: 0,
});

const emptyStats = (): Stats => ({
  coProduced: 0, coOutFlue: 0, coOutEnvelope: 0, coSpilled: 0, reversedS: 0, spillS: 0,
  throttledS: 0, firstSpillT: -1, sumStack: 0, sumRoom: 0, sumTop: 0, sumWindow: 0,
  sumYieldSpilled: 0, stack0: 0,
});

/**
 * State at 22:00. The evening fire is burned for a warm-up period without
 * wind noise so that the chimney wall starts warm; room CO, fuel, people and
 * statistics are then reset.
 */
export function createState(controls: Controls, seed: number, fuelKg: number = K.fuelLoadKg): SimState {
  const s: SimState = {
    t: 0,
    rng: { s: seed | 0 },
    gustFast: 0,
    gustSlow: 0,
    wake: 0,
    fuelKg,
    wallT: 0.5 * (controls.tOut + K.warmupGasT),
    pipeT: K.warmupGasT,
    chimT: K.warmupGasT,
    flow: 0.005,
    co: [0, 0],
    people: FAMILY.map((f) => {
      const cohb = cfkEquilibrium(0, PEOPLE[f.kind]);
      return { cohb, peakPct: percent(cohb, PEOPLE[f.kind]), evacuated: false };
    }),
    alarm: { s50: 0, s100: 0, s300: 0, sounded: false, tSounded: -1 },
    stats: emptyStats(),
    diag: emptyDiag(),
  };

  const evening: Controls = {
    ...controls,
    inlet: Math.max(controls.inlet, K.warmupInlet),
    damper: Math.max(controls.damper, 0.8),
    gust: controls.wind,
    alarm: false,
  };
  const steps = Math.round((K.warmupMin * 60) / K.dt);
  for (let i = 0; i < steps; i++) step(s, evening, false);

  s.t = 0;
  s.rng = { s: seed | 0 };
  s.gustFast = 0;
  s.gustSlow = 0;
  s.wake = 0;
  s.fuelKg = fuelKg;
  s.co = [0, 0];
  s.stats = emptyStats();
  s.alarm = { s50: 0, s100: 0, s300: 0, sounded: false, tSounded: -1 };
  for (let i = 0; i < s.people.length; i++) {
    const person = PEOPLE[FAMILY[i].kind];
    const cohb = cfkEquilibrium(0, person);
    s.people[i] = { cohb, peakPct: percent(cohb, person), evacuated: false };
  }
  s.diag.ppm = [0, 0];
  s.diag.spill = 0;
  s.stats.stack0 = flueStack(s.pipeT, s.chimT, controls.tOut, controls);
  return s;
}

/** Advance the state by one fixed time step. */
export function step(s: SimState, c: Controls, noise = true): void {
  const dt = K.dt;

  // 1. Wind: mean plus two Ornstein–Uhlenbeck gust components.
  if (noise) {
    s.gustFast = ouStep(s.gustFast, dt, K.gustTauFast, s.rng);
    s.gustSlow = ouStep(s.gustSlow, dt, K.gustTauSlow, s.rng);
    s.wake = ouStep(s.wake, dt, K.wakeTau, s.rng);
  }
  const sigma = Math.max(c.gust - c.wind, 0) / K.gustPeakFactor;
  const n = Math.sqrt(K.gustFastShare) * s.gustFast + Math.sqrt(1 - K.gustFastShare) * s.gustSlow;
  const v10 = Math.max(0, c.wind + sigma * n);
  const vRoof = K.roofWindFactor * v10;
  const q = dynamicPressure(vRoof, c.tOut);
  const [cpChimSide, cpWinSide] = facadeCp(c);
  const cpTop = terminalCp(c, s.wake);

  // 2. Stove, using the flue flow of the previous step.
  const fire = stove(c.inlet, s.fuelKg, s.flow);
  s.fuelKg = Math.max(0, s.fuelKg - fire.burn * dt);

  // 3. Flue pressures and resistance from the relaxed gas temperatures.
  const stack = flueStack(s.pipeT, s.chimT, c.tOut, c);
  const res = flueResistance(c, s.pipeT, s.chimT);
  const rFlue = res.total;

  // 4. Air flow network.
  const netIn = { q, cpChimSide, cpWinSide, cpTop, stack, rFlue, tOut: c.tOut };
  const net = solveNetwork(netIn, winSideCdA(c));
  let windowEffect = 0;
  if (c.window > 0) {
    windowEffect = net.p - solveNetwork(netIn, winSideCdA(c, 0)).p;
  }
  const flow = net.flue;
  const draught = net.p + stack - cpTop * q;

  // 5. Flue heat transfer for this flow; gas relaxes, wall integrates.
  const th = flueThermal(flow, K.flueHeatFrac * fire.heat, s.wallT, c.tOut, c);
  const relax = 1 - Math.exp(-dt / K.gasLag);
  s.pipeT += (th.pipeMean - s.pipeT) * relax;
  s.chimT += (th.chimMean - s.chimT) * relax;
  const h = chimneyHeight(c);
  s.wallT += ((th.toWall - K.chimUo * h * (s.wallT - c.tOut)) / (K.chimWallCap * h)) * dt;
  s.flow = flow;

  // 6. Spillage: whatever the flue does not carry away enters the stove room.
  //    (a) reversed flow: everything; (b) the flue carries less than the fire
  //    produces: the excess; (c) too little suction at the stove collar to hold
  //    the buoyant gas inside the stove body: a share leaks from lid and door.
  let spill = 0;
  if (fire.burn > 0) {
    if (flow <= 0) spill = 1;
    else {
      const excess = 1 - clamp(flow / fire.products, 0, 1);
      const suction = res.stove * flow * flow;
      const leak = K.leakSpillShare * clamp(1 - suction / fireboxBuoyancy(), 0, 1);
      spill = Math.max(excess, leak);
    }
  }
  const coMade = fire.coRate * dt;
  const coSpilled = coMade * spill;
  const fluxes = stepRooms(s.co, net, coSpilled, c, c.tOut, dt);

  // 7. People and alarm.
  const perPpm = coKgPerM3PerPpm(K.roomT);
  const ppm: [number, number] = [s.co[0] / K.volStove / perPpm, s.co[1] / K.volBed / perPpm];
  for (let i = 0; i < s.people.length; i++) {
    const who = s.people[i];
    const person = PEOPLE[FAMILY[i].kind];
    who.cohb = cfkStep(who.cohb, who.evacuated ? 0 : ppm[FAMILY[i].zone], person, dt);
    const pct = percent(who.cohb, person);
    if (pct > who.peakPct) who.peakPct = pct;
  }
  if (c.alarm && !s.alarm.sounded) {
    // The alarm hangs in the stove room. Each counter resets when the level drops.
    const a = s.alarm;
    a.s50 = ppm[0] >= 50 ? a.s50 + dt : 0;
    a.s100 = ppm[0] >= 100 ? a.s100 + dt : 0;
    a.s300 = ppm[0] >= 300 ? a.s300 + dt : 0;
    if (a.s50 >= K.alarm50Min * 60 || a.s100 >= K.alarm100Min * 60 || a.s300 >= K.alarm300Min * 60) {
      a.sounded = true;
      a.tSounded = s.t + dt;
      for (const who of s.people) who.evacuated = true;
    }
  }

  // 8. Ledgers.
  const st = s.stats;
  st.coProduced += coMade;
  st.coOutFlue += coMade - coSpilled + fluxes.outFlue;
  st.coOutEnvelope += fluxes.outEnvelope;
  st.coSpilled += coSpilled;
  if (flow < 0) st.reversedS += dt;
  if (spill > 0) {
    st.spillS += dt;
    if (flow > 0) st.throttledS += dt;
    if (st.firstSpillT < 0) st.firstSpillT = s.t;
    st.sumStack += stack * dt;
    st.sumRoom += net.p * dt;
    st.sumTop += -cpTop * q * dt;
    st.sumWindow += windowEffect * dt;
    st.sumYieldSpilled += fire.coYield * coSpilled;
  }

  const d = s.diag;
  d.vRoof = vRoof; d.q = q; d.cpTop = cpTop; d.pRoom = net.p; d.stack = stack;
  d.pTop = cpTop * q; d.draught = draught; d.collar = res.stove * flow * Math.abs(flow); d.flueFlow = flow; d.flueTin = th.tIn;
  d.pipeT = s.pipeT; d.chimT = s.chimT; d.burn = fire.burn; d.heat = fire.heat;
  d.coYield = fire.coYield; d.coRate = fire.coRate; d.spill = spill; d.ppm = ppm;
  d.flowChimSide = net.chimSide; d.flowWinSide = net.winSide; d.windowEffect = windowEffect;

  s.t += dt;
}

/** kg of CO currently in the two rooms. */
export function coInRooms(s: SimState): number {
  return s.co[0] + s.co[1];
}

/** Air density helper re-exported for callers that only import the sim. */
export { density };
