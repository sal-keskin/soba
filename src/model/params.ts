/**
 * Every constant of the Soba model lives here, with unit, source and status.
 *
 * status:
 *   'lit'     value taken from the cited literature or standard
 *   'derived' follows from other entries or from geometry of the standard house
 *   'assumed' engineering guess, NOT calibrated — each of these is listed as an
 *             open question in docs/model.md
 *
 * The parameter table in docs/model.md is generated from this file
 * (npm run docs:params). Do not put model constants anywhere else.
 */

export type Status = 'lit' | 'derived' | 'assumed';

export interface Param {
  value: number;
  unit: string;
  source: string;
  status: Status;
}

const p = (value: number, unit: string, status: Status, source: string): Param => ({
  value,
  unit,
  source,
  status,
});

export const PARAM_TABLE = {
  // ───────────── Physical constants ─────────────
  g: p(9.80665, 'm/s²', 'lit', 'Standard gravity (CGPM 1901)'),
  pAtm: p(101325, 'Pa', 'lit', 'Standard atmosphere; site elevation is ignored (simplification S9)'),
  rAir: p(287.05, 'J/(kg·K)', 'lit', 'Specific gas constant of dry air; also used for flue gas (S3)'),
  cpGas: p(1050, 'J/(kg·K)', 'lit', 'Flue gas near 100–300 °C, air-like mixture (Incropera, Fundamentals of Heat and Mass Transfer, air property tables)'),
  mCO: p(28.01, 'g/mol', 'lit', 'Molar mass of carbon monoxide'),
  rGas: p(8.314462, 'J/(mol·K)', 'lit', 'Molar gas constant (CODATA)'),

  // ───────────── Simulation ─────────────
  dt: p(2, 's', 'derived', 'Fixed time step; much shorter than every time constant in the model'),
  nightHours: p(8, 'h', 'derived', 'One night, 22:00 to 06:00'),
  startHour: p(22, 'h', 'derived', 'Clock hour at t = 0'),
  warmupMin: p(45, 'min', 'assumed', 'Evening fire burned before t = 0 to warm the chimney wall'),
  warmupInlet: p(0.8, '–', 'assumed', 'Air inlet opening during the evening warm-up'),
  warmupGasT: p(120, '°C', 'assumed', 'Flue gas temperature at the start of the warm-up: the fire is taken as already lit and drawing'),

  // ───────────── Stove ─────────────
  fuelLoadKg: p(8, 'kg', 'assumed', 'Coal in the stove at 22:00 (one full evening charge)'),
  burnMax: p(1.6, 'kg/h', 'assumed', 'Burn rate with the inlet fully open; gives about 7.5 kW, typical nameplate order for a room coal stove'),
  inletFloor: p(0.12, '–', 'assumed', 'Fraction of full burn rate that persists with the inlet shut (leak air keeps the bed smouldering)'),
  fuelTaperKg: p(1.5, 'kg', 'assumed', 'Burn rate falls linearly below this much remaining fuel'),
  draughtFloor: p(0.4, '–', 'assumed', 'Fraction of the burn rate that persists when no air moves through the stove in either direction'),
  reversedYieldShift: p(0.5, '–', 'assumed', 'While the flue is reversed the fire breathes its own fumes: the CO yield moves this fraction of the way from its normal value to coYieldMax'),
  lhv: p(17e6, 'J/kg', 'assumed', 'Lower heating value; Turkish lignite spans roughly 8–19 MJ/kg (about 2000–4500 kcal/kg), washed household coal near the top'),
  afr: p(6, 'kg air/kg fuel', 'derived', 'Stoichiometric air, about 0.33 kg per MJ of heating value (standard combustion rule of thumb)'),
  flueHeatFrac: p(0.3, '–', 'assumed', 'Share of the heat release that leaves in the flue gas (stove efficiency about 70 %)'),
  flueTinMax: p(500, '°C', 'assumed', 'Cap on the gas temperature at the stove collar'),
  coYieldMin: p(0.03, 'kg CO/kg fuel', 'assumed', 'CO yield with ample air. Order of magnitude from household coal stove emission factors (Zhang et al. 2000, Atmos. Environ. 34:4537–4549)'),
  coYieldMax: p(0.25, 'kg CO/kg fuel', 'assumed', 'CO yield when smouldering with the inlet shut; corresponds to about 15 % of fuel carbon leaving as CO'),
  coYieldExp: p(2, '–', 'assumed', 'Shape of the rise of CO yield as air is restricted'),
  stoveInletArea: p(20e-4, 'm²', 'assumed', 'Free area of the primary air inlet when fully open'),
  stoveLeakArea: p(4e-4, 'm²', 'assumed', 'Leakage around the door, lid and joints of the stove body'),
  fireboxHeight: p(0.4, 'm', 'derived', 'Height of hot gas inside the stove body above the air inlet'),
  fireboxGasT: p(400, '°C', 'assumed', 'Mean gas temperature inside the stove body'),
  leakSpillShare: p(0.5, '–', 'assumed', 'Largest share of the combustion gas that escapes through lid and door gaps when there is no suction at the stove collar'),

  // ───────────── Flue: geometry ─────────────
  pipeDia: p(0.12, 'm', 'lit', 'Common Turkish stove pipe (soba borusu) nominal diameter, 12 cm'),
  pipeLen: p(2.3, 'm', 'derived', 'Indoor pipe: 1.3 m rise plus 1.0 m run into the chimney'),
  pipeRise: p(1.3, 'm', 'derived', 'Vertical part of the indoor pipe'),
  chimDia: p(0.14, 'm', 'assumed', 'Hydraulic diameter of the chimney'),
  chimBaseToRidge: p(2.9, 'm', 'derived', 'Height from the pipe entry (2.1 m) to the ridge (5.0 m) of the standard house'),
  chimRelMin: p(-2.0, 'm', 'derived', 'Lowest terminal: just above the eaves'),
  chimRelMax: p(1.2, 'm', 'derived', 'Highest terminal above the ridge'),

  // ───────────── Flue: flow resistance ─────────────
  cd: p(0.61, '–', 'lit', 'Discharge coefficient of a sharp-edged orifice (ASHRAE Handbook of Fundamentals, ventilation and infiltration chapter)'),
  frictionClean: p(0.03, '–', 'assumed', 'Darcy friction factor of a clean pipe at low Reynolds number'),
  frictionSoot: p(0.05, '–', 'assumed', 'Extra friction factor of a fully sooted flue'),
  sootAreaLoss: p(0.9, '–', 'assumed', 'Fraction of the cross-section lost when soot = 1 (nearly blocked)'),
  kElbow: p(1.2, '–', 'lit', 'Loss coefficient of a sharp 90° elbow (Idelchik, Handbook of Hydraulic Resistance)'),
  nElbows: p(2, '–', 'derived', 'Elbows between the stove and the chimney'),
  kExit: p(1.0, '–', 'lit', 'Exit loss: one velocity head'),
  kDamperOpen: p(0.2, '–', 'assumed', 'Loss of the fully open butterfly damper'),
  damperMinOpen: p(0.1, '–', 'assumed', 'Free area that remains with the damper shut (stove dampers do not seal)'),
  kCapRain: p(1.0, '–', 'assumed', 'Extra loss of a flat rain cap'),
  kCapH: p(1.5, '–', 'assumed', 'Extra loss of an H-shaped cap'),

  // ───────────── Flue: heat transfer ─────────────
  pipeU: p(6, 'W/(m²·K)', 'assumed', 'Overall coefficient, gas to room, of a bare sheet-steel pipe'),
  chimHi: p(6, 'W/(m²·K)', 'assumed', 'Gas-to-wall coefficient inside the chimney at about 1 m/s'),
  chimUo: p(2.6, 'W/(m·K)', 'assumed', 'Wall-to-outdoors loss per metre of chimney height'),
  chimWallCap: p(40e3, 'J/(m·K)', 'assumed', 'Heat capacity of the thermally active inner wall layer per metre of height'),
  gasLag: p(10, 's', 'derived', 'Relaxation time of the gas column temperature, about the transit time of the flue'),

  // ───────────── Wind ─────────────
  roofWindFactor: p(0.6, '–', 'assumed', 'Wind speed at roof height divided by the 10 m meteorological wind, low-rise built-up terrain'),
  gustPeakFactor: p(3, '–', 'assumed', 'Gust speed is taken as mean + 3 standard deviations'),
  gustTauFast: p(8, 's', 'assumed', 'Correlation time of fast gusts'),
  gustTauSlow: p(300, 's', 'assumed', 'Correlation time of slow squalls and lulls'),
  gustFastShare: p(0.7, '–', 'assumed', 'Share of gust variance in the fast component'),
  cpWallWind: p(0.7, '–', 'lit', 'Windward wall of a low-rise building (EN 1991-1-4 Table 7.1, zone D, h/d ≤ 0.25)'),
  cpWallLee: p(-0.3, '–', 'lit', 'Leeward wall (EN 1991-1-4 Table 7.1, zone E, h/d ≤ 0.25)'),
  cpCross: p(-0.5, '–', 'assumed', 'All surfaces when the wind blows along the ridge'),
  cpTopFree: p(-0.4, '–', 'assumed', 'Open terminal in free flow above the ridge: wind across the opening aspirates'),
  cpTopWindSlope: p(0.4, '–', 'lit', 'Terminal below the ridge above the windward roof slope (EN 1991-1-4 Table 7.4a, 30° pitch, zone H upper value)'),
  cpTopLee: p(-0.3, '–', 'assumed', 'Terminal below the ridge in the lee wake, mean value'),
  cpWakeSigmaLee: p(0.35, '–', 'assumed', 'Standard deviation of the terminal Cp in the lee wake (downwash eddies)'),
  cpWakeSigmaWind: p(0.15, '–', 'assumed', 'Standard deviation of the terminal Cp on the windward slope'),
  wakeTau: p(5, 's', 'assumed', 'Correlation time of wake fluctuations'),
  ridgeClearance: p(0.4, 'm', 'lit', 'Terminal counts as clear of the roof when at least 0.4 m above the ridge (EN 13384-1 adverse-pressure-zone criterion)'),
  ridgeBlend: p(0.8, 'm', 'assumed', 'Height range over which the terminal passes from free flow to the roof zone'),
  capRainAdverse: p(0.7, '–', 'assumed', 'Factor on positive (adverse) terminal Cp with a rain cap'),
  capHAdverse: p(0.3, '–', 'assumed', 'Factor on positive (adverse) terminal Cp with an H cap'),

  // ───────────── Rooms ─────────────
  roomT: p(18, '°C', 'assumed', 'Indoor air temperature, held constant (simplification S6)'),
  volStove: p(36, 'm³', 'derived', 'Stove room 4.0 × 3.6 × 2.5 m'),
  volBed: p(30, 'm³', 'derived', 'Bedroom 3.3 × 3.6 × 2.5 m'),
  leakCdA: p(60e-4, 'm²', 'assumed', 'Effective leakage area (Cd·A) of each room envelope; about 0.5 air changes per hour at 2 Pa'),
  windowMaxArea: p(0.5, 'm²', 'assumed', 'Free area of the bedroom window fully open'),
  doorGapArea: p(0.016, 'm²', 'derived', 'Undercut of the closed inner door, 0.8 m × 2 cm'),
  doorArea: p(1.6, 'm²', 'derived', 'Open doorway 0.8 × 2.0 m'),
  doorExchangeOpen: p(0.05, 'm³/s', 'assumed', 'Two-way buoyant exchange through the open doorway'),
  doorExchangeClosed: p(0.002, 'm³/s', 'assumed', 'Two-way exchange through the gaps of the closed door'),
  achStack: p(0.15, '1/h', 'assumed', 'Background stack-driven air change at 20 K indoor-outdoor difference; scales with the square root of the difference'),

  // ───────────── People: Coburn–Forster–Kane ─────────────
  haldaneM: p(218, '–', 'lit', 'Haldane affinity ratio (Peterson & Stewart 1970, Arch. Environ. Health 21:165–171)'),
  hufner: p(1.38, 'mL O₂/g Hb', 'lit', 'Oxygen capacity of haemoglobin (Peterson & Stewart 1975, J. Appl. Physiol. 39:633–638)'),
  pB: p(760, 'mmHg', 'lit', 'Barometric pressure at sea level'),
  pH2O: p(47, 'mmHg', 'lit', 'Water vapour pressure at 37 °C'),
  pcO2: p(100, 'mmHg', 'lit', 'Mean pulmonary capillary oxygen pressure (Coburn, Forster & Kane 1965, J. Clin. Invest. 44:1899–1910)'),
  vcoEndo: p(0.007, 'mL/min', 'lit', 'Endogenous CO production of an adult (Coburn, Forster & Kane 1965); scaled with blood volume for the others'),

  // ───────────── CO alarm (EN 50291-1 response limits) ─────────────
  alarm50Min: p(90, 'min', 'lit', 'Must alarm within 60–90 min at 50 ppm (EN 50291-1); the latest allowed time is used'),
  alarm100Min: p(40, 'min', 'lit', 'Must alarm within 10–40 min at 100 ppm (EN 50291-1); the latest allowed time is used'),
  alarm300Min: p(3, 'min', 'lit', 'Must alarm within 3 min at 300 ppm (EN 50291-1)'),

  // ───────────── Symptom stages (lower %COHb bounds) ─────────────
  stage1: p(10, '% COHb', 'lit', 'Headache begins (WHO Environmental Health Criteria 213, Carbon Monoxide, 1999, symptom table)'),
  stage2: p(20, '% COHb', 'lit', 'Throbbing headache, dizziness, nausea (WHO EHC 213)'),
  stage3: p(30, '% COHb', 'lit', 'Confusion, vomiting, impaired judgement (WHO EHC 213)'),
  stage4: p(40, '% COHb', 'lit', 'Collapse, loss of consciousness (WHO EHC 213)'),
  stage5: p(50, '% COHb', 'lit', 'Coma, convulsions, risk of death (WHO EHC 213)'),

  // ───────────── Tonight mode ─────────────
  weakDraughtPa: p(2, 'Pa', 'assumed', 'Net draught below this counts as weak'),
  riskLow: p(0.05, '–', 'assumed', 'Risk index below this is shown as "lower"'),
  riskHigh: p(0.3, '–', 'assumed', 'Risk index at or above this is shown as "higher"'),
} as const satisfies Record<string, Param>;

type Keys = keyof typeof PARAM_TABLE;

/** Plain numeric view of the table for use in the equations. */
export const K = Object.fromEntries(
  Object.entries(PARAM_TABLE).map(([k, v]) => [k, v.value]),
) as { readonly [k in Keys]: number };

// ───────────── People ─────────────

export type PersonKind = 'adult' | 'older' | 'child' | 'infant';

export interface PersonParams {
  kind: PersonKind;
  /** body mass, kg */
  massKg: number;
  /** blood volume, mL */
  vb: number;
  /** haemoglobin, g/mL */
  hb: number;
  /** alveolar ventilation at rest, mL/min */
  va: number;
  /** lung diffusing capacity for CO, mL/(min·mmHg) */
  dl: number;
  source: string;
  status: Status;
}

/**
 * Per-person CFK inputs. Only the adult set is the published standard set.
 * The older adult, child and infant are scaled by body size from general
 * physiology ranges and are open question Q6.
 */
export const PEOPLE: Record<PersonKind, PersonParams> = {
  adult: {
    kind: 'adult',
    massKg: 70,
    vb: 5500,
    hb: 0.15,
    va: 6000,
    dl: 30,
    status: 'lit',
    source: 'Standard resting adult of Peterson & Stewart 1975 (J. Appl. Physiol. 39:633–638)',
  },
  older: {
    kind: 'older',
    massKg: 70,
    vb: 5000,
    hb: 0.135,
    va: 5500,
    dl: 22,
    status: 'assumed',
    source: 'Adult set with lower haemoglobin and diffusing capacity for age; assumed',
  },
  child: {
    kind: 'child',
    massKg: 20,
    vb: 1500,
    hb: 0.125,
    va: 2800,
    dl: 11,
    status: 'assumed',
    source: 'About 6 years: 75 mL blood/kg, about 140 mL/(kg·min) alveolar ventilation; assumed scaling',
  },
  infant: {
    kind: 'infant',
    massKg: 7,
    vb: 560,
    hb: 0.115,
    va: 1180,
    dl: 3.5,
    status: 'assumed',
    source: 'About 6 months: 80 mL blood/kg, tidal 7 mL/kg, dead space 2.2 mL/kg, 35 breaths/min; assumed scaling. Fetal haemoglobin ignored',
  },
};

/** Who sleeps where in the standard house: zone 0 = stove room, 1 = bedroom. */
export const FAMILY: { kind: PersonKind; zone: 0 | 1 }[] = [
  { kind: 'older', zone: 0 },
  { kind: 'child', zone: 0 },
  { kind: 'adult', zone: 1 },
  { kind: 'infant', zone: 1 },
];
