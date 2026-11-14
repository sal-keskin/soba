export type Cap = 'none' | 'rain' | 'h';

/** Everything the player (or the forecast) can set. */
export interface Controls {
  /** outdoor air temperature, °C */
  tOut: number;
  /** mean wind speed at 10 m, m/s */
  wind: number;
  /** gust speed at 10 m, m/s (≥ wind) */
  gust: number;
  /** +1: wind blows from the chimney side of the house; −1: from the window side */
  windDir: 1 | -1;
  /** 1 = wind square to the ridge, 0 = along the ridge */
  align: number;
  /** chimney terminal height relative to the roof ridge, m (negative = below) */
  chimneyRel: number;
  cap: Cap;
  /** 0 = clean flue, 1 = heavily sooted */
  soot: number;
  /** flue damper, 0 = shut, 1 = open */
  damper: number;
  /** stove air inlet, 0 = shut, 1 = open */
  inlet: number;
  /** bedroom window, 0 = shut, 1 = open */
  window: number;
  /** door between the rooms, 0 = shut, 1 = open */
  door: number;
  /** is a CO alarm installed */
  alarm: boolean;
}

export interface PersonState {
  /** [COHb], mL CO per mL blood */
  cohb: number;
  /** highest %COHb so far */
  peakPct: number;
  /** woken by the alarm and gone out to fresh air */
  evacuated: boolean;
}

/** Diagnostics of the last step; everything the interface draws comes from here. */
export interface Diag {
  /** gusting wind speed at roof height, m/s */
  vRoof: number;
  /** dynamic pressure at roof height, Pa */
  q: number;
  cpTop: number;
  /** stove room pressure relative to outdoors, Pa */
  pRoom: number;
  /** stack pressure of the flue column, Pa */
  stack: number;
  /** wind pressure at the terminal, Pa (positive pushes down the flue) */
  pTop: number;
  /** net pressure driving the flue, Pa (positive = up) */
  draught: number;
  /**
   * draught at the stove collar, Pa: the suction a chimney sweep's gauge would
   * read on the pipe just above the stove (positive = pulling, negative = pushing back)
   */
  collar: number;
  /** flue mass flow, kg/s (positive = up, negative = reversed) */
  flueFlow: number;
  /** gas temperature at the stove collar, °C */
  flueTin: number;
  /** mean gas temperature in the indoor pipe, °C */
  pipeT: number;
  /** mean gas temperature in the chimney, °C */
  chimT: number;
  /** burn rate, kg/s */
  burn: number;
  /** heat release, W */
  heat: number;
  /** CO yield, kg CO per kg fuel */
  coYield: number;
  /** CO produced by the fire, kg/s */
  coRate: number;
  /** fraction of the combustion gas that spills into the room, 0–1 */
  spill: number;
  /** CO concentration, ppm: [stove room, bedroom] */
  ppm: [number, number];
  /** envelope flows, kg/s, positive = into the house */
  flowChimSide: number;
  flowWinSide: number;
  /** room pressure change caused by the open window, Pa (0 when shut) */
  windowEffect: number;
}

/** Running totals used by the debrief and the mass-balance test. */
export interface Stats {
  /** kg CO produced by the fire */
  coProduced: number;
  /** kg CO carried up the flue (captured gas and room air drawn through the stove) */
  coOutFlue: number;
  /** kg CO leaving through leaks, window and background air change */
  coOutEnvelope: number;
  /** kg CO spilled into the stove room */
  coSpilled: number;
  /** seconds with reversed flue flow */
  reversedS: number;
  /** seconds with any spillage */
  spillS: number;
  /** seconds spilling while the flue still flowed upward (throttled flue) */
  throttledS: number;
  /** time of the first spillage, s, or −1 */
  firstSpillT: number;
  /** time-integrals over spilling periods, Pa·s */
  sumStack: number;
  sumRoom: number;
  sumTop: number;
  sumWindow: number;
  /** integral of CO yield × spilled CO, for the mean yield of what was spilled */
  sumYieldSpilled: number;
  /** stack pressure at the start of the night, Pa */
  stack0: number;
}

export interface AlarmState {
  s50: number;
  s100: number;
  s300: number;
  sounded: boolean;
  tSounded: number;
}

/** Complete, serialisable state. A copy of it is a snapshot. */
export interface SimState {
  /** seconds since 22:00 */
  t: number;
  rng: { s: number };
  gustFast: number;
  gustSlow: number;
  wake: number;
  fuelKg: number;
  /** chimney wall temperature, °C */
  wallT: number;
  /** relaxed mean gas temperatures, °C */
  pipeT: number;
  chimT: number;
  /** flue flow of the previous step, kg/s */
  flow: number;
  /** kg of CO in [stove room, bedroom] */
  co: [number, number];
  people: PersonState[];
  alarm: AlarmState;
  stats: Stats;
  diag: Diag;
}
