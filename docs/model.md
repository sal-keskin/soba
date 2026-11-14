# Soba model

This document describes the physical model behind Soba: its equations, units,
constants, simplifications and open questions. The code is in `src/model/`
(pure TypeScript, no DOM). Every constant is in `src/model/params.ts`; the
table in section 7 is generated from that file.

**Status: educational and uncalibrated.** The model has the right mechanisms
and the right orders of magnitude, but it has not been fitted to measurements
in real houses. More than half of its constants (54 of 98) are engineering
guesses (section 7 marks
them "assumed", section 9 lists them as open questions). It can show *why* and
*in which direction* risk changes. It cannot say whether a particular house is
free of risk on a particular night, and it never should be used that way.

## 1. Overview

```
weather ──► wind pressure on walls and chimney terminal ─┐
                                                          ▼
stove ──► heat, CO ──► flue gas temperature ──► stack pressure ──► air-flow network ──► flue flow (up or reversed)
                                                                          │
                                                 spilled CO ◄─────────────┘
                                                      ▼
                             two well-mixed rooms (CO mass balance) ──► ppm ──► CFK per sleeper ──► %COHb, stage
```

- Fixed time step `dt` = 2 s; one night is 8 h (22:00–06:00), 14 400 steps.
- State is a plain object (`SimState`); a copy of it is a snapshot.
- Randomness (gusts) comes from a seeded generator whose state is part of the
  simulation state. A night is a pure function of (seed, initial controls,
  control changes), which is what makes scrubbing and the "same seed, same
  night" test possible.
- The standard house in cross-section: stove room (36 m³) on the chimney
  side, bedroom (30 m³) on the window side, a door between them, a pitched
  roof with the ridge 5.0 m above the floor. The flue is a 12 cm sheet-steel
  pipe (1.3 m rise, 1.0 m run) entering a chimney at 2.1 m.

Sign conventions: flue flow is positive upward. Pressures are relative to
outdoor air at stove level. `windDir = +1` means the wind comes from the
chimney side of the house.

## 2. Stove (`stove.ts`)

Inputs: air inlet opening *a* ∈ [0, 1], remaining fuel *m_f* (kg), flue mass
flow *ṁ* (kg/s) from the previous step.

| Quantity | Equation | Unit |
|---|---|---|
| Nominal burn rate | ṁ_b,nom = ṁ_b,max · (a₀ + (1 − a₀)·a) · min(1, m_f / m_taper) | kg/s |
| Air needed | ṁ_need = ṁ_b,nom · (1 + AFR) | kg/s |
| Air-supply factor | d = clamp(\|ṁ\| / ṁ_need, d_min, 1) | – |
| Burn rate | ṁ_b = ṁ_b,nom · d | kg/s |
| Heat release | Q = ṁ_b · LHV | W |
| CO yield | y = y_min + (y_max − y_min)·(1 − a)ⁿ ; if ṁ < 0: y ← y + (y_max − y)·φ_rev | kg CO / kg fuel |
| CO production | Ṡ = ṁ_b · y | kg/s |
| Flue heat | Q_flue = f_flue · Q | W |

The burn rate follows the inlet opening. The CO yield rises steeply as the
inlet closes (smouldering). Air passes through the fuel bed whichever way the
flue flows, so the size of the flow, not its sign, limits the fire; when the
flue is reversed the fire breathes its own fumes and the yield rises further.

## 3. Flue (`flue.ts`)

### 3.1 Gas temperatures

Gas properties are those of air (ideal gas, ρ = p / (R·T)). For an upward
flow ṁ the gas leaves the stove at

T_in = min(T_max, T_room + Q_flue / (ṁ·c_p))

and cools exponentially, first to the room along the bare pipe, then to the
chimney wall:

T(x) = T_amb + (T_start − T_amb)·e^(−N·x/L),  N = U·P·L / (ṁ·c_p)

with mean (1 − e^(−N))/N over the section. For reversed flow outdoor air
enters at the terminal at T_out, is tempered by the chimney wall, then by the
room. The mean gas temperatures of the pipe and of the chimney relax toward
these quasi-steady values with a time constant of 10 s (about one transit
time of the flue).

The chimney wall is one lumped temperature T_w per metre of height:

C_w · dT_w/dt = q_gas→wall − U_o·(T_w − T_out)

This thermal mass is why a chimney keeps drawing for a while after the fire
is turned down, and why a flue that has gone cold tends to stay reversed.

### 3.2 Stack pressure

Δp_stack = g · [ H_pipe·(ρ_out − ρ(T̄_pipe)) + H_chim·(ρ_out − ρ(T̄_chim)) ]   (Pa)

H_chim = 2.9 m + h_rel, where h_rel is the terminal height relative to the
ridge (−2.0 … +1.2 m). Check value: 5 m at 150 °C against 0 °C outdoors gives
22.5 Pa.

### 3.3 Wind

Wind speed at roof height:

v = k_roof · max(0, v₁₀ + σ·(√s·x_fast + √(1 − s)·x_slow)),  σ = (v_gust − v₁₀) / 3

x_fast and x_slow are unit-variance Ornstein–Uhlenbeck processes with
correlation times 8 s and 300 s. Dynamic pressure q = ½·ρ_out·v².

Pressure at the chimney terminal: p_top = C_p,top · q, with

C_p,top = (1 − w)·C_free + w·[ A·(C_zone + σ_zone·x_wake) + (1 − A)·C_cross ]
w = clamp((0.4 m − h_rel) / 0.8 m, 0, 1)

- w = 0: terminal at least 0.4 m above the ridge, in free flow; wind across
  the opening aspirates (C_free < 0, helps the draught).
- w = 1: terminal in the roof zone. With the wind coming from the chimney
  side it sits above the windward slope (C_zone > 0, opposes the draught);
  with the wind from the other side it sits in the lee wake (mean slightly
  negative, but strongly fluctuating: x_wake is a third OU process).
- A ∈ [0, 1] is the alignment of the wind with the cross-section
  (1 = square to the ridge).
- A cap multiplies only positive (adverse) C_p,top: rain cap ×0.7, H cap ×0.3,
  and adds flow resistance.

Wall pressures: C_p = +0.7 windward, −0.3 leeward, blended toward −0.5 for
wind along the ridge.

### 3.4 Flow resistance

The path room → stove → pipe → chimney → terminal has resistance R defined by
Δp = R·ṁ·|ṁ|:

R = 1 / (2·ρ_room·(C_d·A_stove)²) + K_pipe / (2·ρ_pipe·A_pipe²) + K_chim / (2·ρ_chim·A_chim²)

- A_stove = A_inlet·a + A_leak (the air inlet is the main resistance, as in a real stove).
- K_pipe = f·L/D + 2·K_elbow + K_damper(θ); K_chim = f·H/D + K_exit + K_cap.
- Damper opening θ ∈ [0, 1]: free fraction φ = φ_min + (1 − φ_min)·θ,
  K_damper = K_open + (1/(C_c·φ) − 1)², C_c = 0.62 + 0.38·φ³ (Weisbach-type contraction).
- Soot s ∈ [0, 1]: area × (1 − 0.9·s), diameter × √(1 − 0.9·s), friction factor + 0.05·s.

## 4. Rooms (`rooms.ts`)

### 4.1 Air-flow network

One pressure node p (the stove room) and three paths, each an orifice
(ṁ = C_d·A·√(2·ρ·|Δp|), signed):

1. stove-room leaks to the chimney-side wall, driven by C_p,chim-side·q − p;
2. bedroom leaks plus window, in series with the inner door, driven by
   C_p,window-side·q − p (two orifices in series: (C_d A)⁻² adds);
3. the flue, driven by p + Δp_stack − C_p,top·q.

The mass balance ṁ₁ + ṁ₂ − ṁ_flue = 0 is strictly decreasing in p and is
solved by bisection every step. The flue flow is taken from the balance, so
air mass is conserved exactly. This is how an open window on the leeward side
pulls the house below outdoor pressure and can reverse the flue, while the
same window on the windward side pushes the flue upward.

Two gauges are reported: the **net pressure** driving the flue (path 3), and
the **collar draught** R_stove·ṁ·|ṁ|, the suction a manometer on the pipe
just above the stove would read.

### 4.2 Spillage

The fraction of combustion gas entering the stove room is

- 1 if ṁ ≤ 0 (reversal);
- otherwise max( 1 − ṁ/ṁ_products , λ·clamp(1 − collar/Δp_fb, 0, 1) ), where
  ṁ_products = ṁ_b·(1 + AFR) and Δp_fb = g·h_fb·(ρ_room − ρ_firebox) ≈ 2.7 Pa
  is the buoyancy of the hot gas inside the stove body. Without at least that
  much suction at the collar the top of the firebox is above room pressure
  and gas leaks from lid and door gaps. This is the mechanism by which a shut
  damper or a nearly blocked flue leaks fumes without any reversal.

### 4.3 CO mass balance

For each zone, with m the CO mass, V the volume and c = m/V:

dm₀/dt = Ṡ·spill − c₀·(Q_flue,up + Q_leak0,out + Q_door,0→1 + Q_x + n_bg·V₀) + c₁·(Q_door,1→0 + Q_x)
dm₁/dt = c₀·(Q_door,0→1 + Q_x) − c₁·(Q_leak1,out + Q_door,1→0 + Q_x + n_bg·V₁)

- Q_door,net is path 2 of the network; Q_x is a two-way exchange through the
  doorway (0.002 m³/s closed, 0.05 m³/s open).
- n_bg = 0.15 h⁻¹·√(|T_room − T_out| / 20 K) is background stack-driven air
  change, which does not enter the pressure network.
- Explicit Euler; removal per step is limited to half the zone content.
- Ledger: CO produced = CO in rooms + CO up the flue + CO through the envelope.
  The test suite checks that this closes to 10⁻⁹ relative.
- ppm = c / (M_CO·p / (R·T)) · 10⁶; 1 ppm = 1.165 mg/m³ at 20 °C.

## 5. People (`cfk.ts`)

Coburn–Forster–Kane equation, nonlinear form, integrated per person (RK2):

d[COHb]/dt = V̇_CO/V_b − [COHb]·P_cO₂ / (M·B·V_b·[O₂Hb]) + P_iCO / (B·V_b)

B = 1/D_L + P_L/V̇_A,  P_L = P_B − 47 mmHg,  P_iCO = ppm·10⁻⁶·P_L,
[O₂Hb] = 1.38·Hb − [COHb]

Units: mL gas per mL blood, minutes, mmHg, mL. %COHb = 100·[COHb]/(1.38·Hb).

Check values with the standard adult set: equilibrium at 100 ppm is 13.6 %;
clean-air washout half-time is 4.0–4.3 h from saturations up to 10 % (it
shortens at higher saturation because the equation is nonlinear: 3.7 h from
20 %, 3.1 h from 40 %).

Blood volume, haemoglobin, alveolar ventilation and diffusing capacity are set
per person. The equilibrium does not depend on body size; the *speed* does.
With the assumed scaling the child and infant approach equilibrium about twice
as fast as the adult.

Symptom stage from %COHb: 0 (<10), 1 (10–20), 2 (20–30), 3 (30–40), 4 (40–50),
5 (≥50). The relation between COHb and symptoms is loose in real patients;
people with heart disease, pregnant women and the unborn child are affected at
much lower levels than these bands suggest.

Sleepers do nothing. If a CO alarm is installed (in the stove room) it sounds
at the latest response times allowed by EN 50291-1 (300 ppm for 3 min, 100 ppm
for 40 min, 50 ppm for 90 min); everyone then goes out to fresh air and their
COHb washes out.

## 6. Tonight mode (`forecast.ts`)

The standard house is deliberately a common at-risk installation, because a
well-built one shows no difference between nights: stove turned down for the
night, pipe ending 1 m below the ridge, no cap, some soot, window shut, inner
door open. It is run through the forecast hours of
the coming night with hourly temperature, wind speed, gust speed and wind
direction, linearly interpolated, for several seeds. For each hour:

risk = ½·(fraction of time with net draught below 2 Pa) + ½·(fraction of time with spillage)

shown as "lower" (< 0.05), "raised" or "higher" (≥ 0.3) **in this model**.
If the direction the chimney side of the house faces is unknown, both
orientations are run and the worse one is shown.

## 7. Parameters

<!-- PARAMS:START (generated by npm run docs:params; edit src/model/params.ts instead) -->

| Name | Value | Unit | Status | Source or reasoning |
|---|---|---|---|---|
| `g` | 9.80665 | m/s² | literature | Standard gravity (CGPM 1901) |
| `pAtm` | 1.01e+5 | Pa | literature | Standard atmosphere; site elevation is ignored (simplification S9) |
| `rAir` | 287.05 | J/(kg·K) | literature | Specific gas constant of dry air; also used for flue gas (S3) |
| `cpGas` | 1050 | J/(kg·K) | literature | Flue gas near 100–300 °C, air-like mixture (Incropera, Fundamentals of Heat and Mass Transfer, air property tables) |
| `mCO` | 28.01 | g/mol | literature | Molar mass of carbon monoxide |
| `rGas` | 8.314462 | J/(mol·K) | literature | Molar gas constant (CODATA) |
| `dt` | 2 | s | derived | Fixed time step; much shorter than every time constant in the model |
| `nightHours` | 8 | h | derived | One night, 22:00 to 06:00 |
| `startHour` | 22 | h | derived | Clock hour at t = 0 |
| `warmupMin` | 45 | min | **assumed** | Evening fire burned before t = 0 to warm the chimney wall |
| `warmupInlet` | 0.8 | – | **assumed** | Air inlet opening during the evening warm-up |
| `warmupGasT` | 120 | °C | **assumed** | Flue gas temperature at the start of the warm-up: the fire is taken as already lit and drawing |
| `fuelLoadKg` | 8 | kg | **assumed** | Coal in the stove at 22:00 (one full evening charge) |
| `burnMax` | 1.6 | kg/h | **assumed** | Burn rate with the inlet fully open; gives about 7.5 kW, typical nameplate order for a room coal stove |
| `inletFloor` | 0.12 | – | **assumed** | Fraction of full burn rate that persists with the inlet shut (leak air keeps the bed smouldering) |
| `fuelTaperKg` | 1.5 | kg | **assumed** | Burn rate falls linearly below this much remaining fuel |
| `draughtFloor` | 0.4 | – | **assumed** | Fraction of the burn rate that persists when no air moves through the stove in either direction |
| `reversedYieldShift` | 0.5 | – | **assumed** | While the flue is reversed the fire breathes its own fumes: the CO yield moves this fraction of the way from its normal value to coYieldMax |
| `lhv` | 1.7e+7 | J/kg | **assumed** | Lower heating value; Turkish lignite spans roughly 8–19 MJ/kg (about 2000–4500 kcal/kg), washed household coal near the top |
| `afr` | 6 | kg air/kg fuel | derived | Stoichiometric air, about 0.33 kg per MJ of heating value (standard combustion rule of thumb) |
| `flueHeatFrac` | 0.3 | – | **assumed** | Share of the heat release that leaves in the flue gas (stove efficiency about 70 %) |
| `flueTinMax` | 500 | °C | **assumed** | Cap on the gas temperature at the stove collar |
| `coYieldMin` | 0.03 | kg CO/kg fuel | **assumed** | CO yield with ample air. Order of magnitude from household coal stove emission factors (Zhang et al. 2000, Atmos. Environ. 34:4537–4549) |
| `coYieldMax` | 0.25 | kg CO/kg fuel | **assumed** | CO yield when smouldering with the inlet shut; corresponds to about 15 % of fuel carbon leaving as CO |
| `coYieldExp` | 2 | – | **assumed** | Shape of the rise of CO yield as air is restricted |
| `stoveInletArea` | 2e-3 | m² | **assumed** | Free area of the primary air inlet when fully open |
| `stoveLeakArea` | 4e-4 | m² | **assumed** | Leakage around the door, lid and joints of the stove body |
| `fireboxHeight` | 0.4 | m | derived | Height of hot gas inside the stove body above the air inlet |
| `fireboxGasT` | 400 | °C | **assumed** | Mean gas temperature inside the stove body |
| `leakSpillShare` | 0.5 | – | **assumed** | Largest share of the combustion gas that escapes through lid and door gaps when there is no suction at the stove collar |
| `pipeDia` | 0.12 | m | literature | Common Turkish stove pipe (soba borusu) nominal diameter, 12 cm |
| `pipeLen` | 2.3 | m | derived | Indoor pipe: 1.3 m rise plus 1.0 m run into the chimney |
| `pipeRise` | 1.3 | m | derived | Vertical part of the indoor pipe |
| `chimDia` | 0.14 | m | **assumed** | Hydraulic diameter of the chimney |
| `chimBaseToRidge` | 2.9 | m | derived | Height from the pipe entry (2.1 m) to the ridge (5.0 m) of the standard house |
| `chimRelMin` | -2 | m | derived | Lowest terminal: just above the eaves |
| `chimRelMax` | 1.2 | m | derived | Highest terminal above the ridge |
| `cd` | 0.61 | – | literature | Discharge coefficient of a sharp-edged orifice (ASHRAE Handbook of Fundamentals, ventilation and infiltration chapter) |
| `frictionClean` | 0.03 | – | **assumed** | Darcy friction factor of a clean pipe at low Reynolds number |
| `frictionSoot` | 0.05 | – | **assumed** | Extra friction factor of a fully sooted flue |
| `sootAreaLoss` | 0.9 | – | **assumed** | Fraction of the cross-section lost when soot = 1 (nearly blocked) |
| `kElbow` | 1.2 | – | literature | Loss coefficient of a sharp 90° elbow (Idelchik, Handbook of Hydraulic Resistance) |
| `nElbows` | 2 | – | derived | Elbows between the stove and the chimney |
| `kExit` | 1 | – | literature | Exit loss: one velocity head |
| `kDamperOpen` | 0.2 | – | **assumed** | Loss of the fully open butterfly damper |
| `damperMinOpen` | 0.1 | – | **assumed** | Free area that remains with the damper shut (stove dampers do not seal) |
| `kCapRain` | 1 | – | **assumed** | Extra loss of a flat rain cap |
| `kCapH` | 1.5 | – | **assumed** | Extra loss of an H-shaped cap |
| `pipeU` | 6 | W/(m²·K) | **assumed** | Overall coefficient, gas to room, of a bare sheet-steel pipe |
| `chimHi` | 6 | W/(m²·K) | **assumed** | Gas-to-wall coefficient inside the chimney at about 1 m/s |
| `chimUo` | 2.6 | W/(m·K) | **assumed** | Wall-to-outdoors loss per metre of chimney height |
| `chimWallCap` | 40000 | J/(m·K) | **assumed** | Heat capacity of the thermally active inner wall layer per metre of height |
| `gasLag` | 10 | s | derived | Relaxation time of the gas column temperature, about the transit time of the flue |
| `roofWindFactor` | 0.6 | – | **assumed** | Wind speed at roof height divided by the 10 m meteorological wind, low-rise built-up terrain |
| `gustPeakFactor` | 3 | – | **assumed** | Gust speed is taken as mean + 3 standard deviations |
| `gustTauFast` | 8 | s | **assumed** | Correlation time of fast gusts |
| `gustTauSlow` | 300 | s | **assumed** | Correlation time of slow squalls and lulls |
| `gustFastShare` | 0.7 | – | **assumed** | Share of gust variance in the fast component |
| `cpWallWind` | 0.7 | – | literature | Windward wall of a low-rise building (EN 1991-1-4 Table 7.1, zone D, h/d ≤ 0.25) |
| `cpWallLee` | -0.3 | – | literature | Leeward wall (EN 1991-1-4 Table 7.1, zone E, h/d ≤ 0.25) |
| `cpCross` | -0.5 | – | **assumed** | All surfaces when the wind blows along the ridge |
| `cpTopFree` | -0.4 | – | **assumed** | Open terminal in free flow above the ridge: wind across the opening aspirates |
| `cpTopWindSlope` | 0.4 | – | literature | Terminal below the ridge above the windward roof slope (EN 1991-1-4 Table 7.4a, 30° pitch, zone H upper value) |
| `cpTopLee` | -0.3 | – | **assumed** | Terminal below the ridge in the lee wake, mean value |
| `cpWakeSigmaLee` | 0.35 | – | **assumed** | Standard deviation of the terminal Cp in the lee wake (downwash eddies) |
| `cpWakeSigmaWind` | 0.15 | – | **assumed** | Standard deviation of the terminal Cp on the windward slope |
| `wakeTau` | 5 | s | **assumed** | Correlation time of wake fluctuations |
| `ridgeClearance` | 0.4 | m | literature | Terminal counts as clear of the roof when at least 0.4 m above the ridge (EN 13384-1 adverse-pressure-zone criterion) |
| `ridgeBlend` | 0.8 | m | **assumed** | Height range over which the terminal passes from free flow to the roof zone |
| `capRainAdverse` | 0.7 | – | **assumed** | Factor on positive (adverse) terminal Cp with a rain cap |
| `capHAdverse` | 0.3 | – | **assumed** | Factor on positive (adverse) terminal Cp with an H cap |
| `roomT` | 18 | °C | **assumed** | Indoor air temperature, held constant (simplification S6) |
| `volStove` | 36 | m³ | derived | Stove room 4.0 × 3.6 × 2.5 m |
| `volBed` | 30 | m³ | derived | Bedroom 3.3 × 3.6 × 2.5 m |
| `leakCdA` | 6e-3 | m² | **assumed** | Effective leakage area (Cd·A) of each room envelope; about 0.5 air changes per hour at 2 Pa |
| `windowMaxArea` | 0.5 | m² | **assumed** | Free area of the bedroom window fully open |
| `doorGapArea` | 0.016 | m² | derived | Undercut of the closed inner door, 0.8 m × 2 cm |
| `doorArea` | 1.6 | m² | derived | Open doorway 0.8 × 2.0 m |
| `doorExchangeOpen` | 0.05 | m³/s | **assumed** | Two-way buoyant exchange through the open doorway |
| `doorExchangeClosed` | 2e-3 | m³/s | **assumed** | Two-way exchange through the gaps of the closed door |
| `achStack` | 0.15 | 1/h | **assumed** | Background stack-driven air change at 20 K indoor-outdoor difference; scales with the square root of the difference |
| `haldaneM` | 218 | – | literature | Haldane affinity ratio (Peterson & Stewart 1970, Arch. Environ. Health 21:165–171) |
| `hufner` | 1.38 | mL O₂/g Hb | literature | Oxygen capacity of haemoglobin (Peterson & Stewart 1975, J. Appl. Physiol. 39:633–638) |
| `pB` | 760 | mmHg | literature | Barometric pressure at sea level |
| `pH2O` | 47 | mmHg | literature | Water vapour pressure at 37 °C |
| `pcO2` | 100 | mmHg | literature | Mean pulmonary capillary oxygen pressure (Coburn, Forster & Kane 1965, J. Clin. Invest. 44:1899–1910) |
| `vcoEndo` | 7e-3 | mL/min | literature | Endogenous CO production of an adult (Coburn, Forster & Kane 1965); scaled with blood volume for the others |
| `alarm50Min` | 90 | min | literature | Must alarm within 60–90 min at 50 ppm (EN 50291-1); the latest allowed time is used |
| `alarm100Min` | 40 | min | literature | Must alarm within 10–40 min at 100 ppm (EN 50291-1); the latest allowed time is used |
| `alarm300Min` | 3 | min | literature | Must alarm within 3 min at 300 ppm (EN 50291-1) |
| `stage1` | 10 | % COHb | literature | Headache begins (WHO Environmental Health Criteria 213, Carbon Monoxide, 1999, symptom table) |
| `stage2` | 20 | % COHb | literature | Throbbing headache, dizziness, nausea (WHO EHC 213) |
| `stage3` | 30 | % COHb | literature | Confusion, vomiting, impaired judgement (WHO EHC 213) |
| `stage4` | 40 | % COHb | literature | Collapse, loss of consciousness (WHO EHC 213) |
| `stage5` | 50 | % COHb | literature | Coma, convulsions, risk of death (WHO EHC 213) |
| `weakDraughtPa` | 2 | Pa | **assumed** | Net draught below this counts as weak |
| `riskLow` | 0.05 | – | **assumed** | Risk index below this is shown as "lower" |
| `riskHigh` | 0.3 | – | **assumed** | Risk index at or above this is shown as "higher" |

**People (CFK inputs)**

| Person | Mass kg | Blood volume mL | Hb g/mL | Alveolar ventilation mL/min | DL mL/(min·mmHg) | Status | Source or reasoning |
|---|---|---|---|---|---|---|---|
| adult | 70 | 5500 | 0.15 | 6000 | 30 | literature | Standard resting adult of Peterson & Stewart 1975 (J. Appl. Physiol. 39:633–638) |
| older | 70 | 5000 | 0.135 | 5500 | 22 | **assumed** | Adult set with lower haemoglobin and diffusing capacity for age; assumed |
| child | 20 | 1500 | 0.125 | 2800 | 11 | **assumed** | About 6 years: 75 mL blood/kg, about 140 mL/(kg·min) alveolar ventilation; assumed scaling |
| infant | 7 | 560 | 0.115 | 1180 | 3.5 | **assumed** | About 6 months: 80 mL blood/kg, tidal 7 mL/kg, dead space 2.2 mL/kg, 35 breaths/min; assumed scaling. Fetal haemoglobin ignored |

<!-- PARAMS:END -->

## 8. Simplifications

- **S1 Well-mixed rooms.** No stratification; CO leaving the stove is mixed instantly through the room. Real plumes rise and layer, so someone sleeping high or near the stove can be exposed earlier.
- **S2 Quasi-steady flow.** No inertia of the gas column; the flow follows the pressures instantly. Gas temperature has a 10 s lag only.
- **S3 Flue gas is air.** Same gas constant and heat capacity; water vapour and CO₂ content ignored.
- **S4 Lumped chimney wall.** One temperature for the whole wall; the pipe has no thermal mass.
- **S5 Empirical fire.** Burn rate and CO yield are algebraic functions of the inlet opening, not a combustion model. No ignition, no volatiles phase after refuelling (when real CO peaks occur), no ash build-up.
- **S6 Constant indoor temperature** (18 °C). The room does not cool when the stove is turned down, and the stack effect of the house itself is represented only by the background air change.
- **S7 Two-dimensional wind.** The house is a cross-section; wind either comes from the chimney side or the window side, scaled by an alignment factor. Neighbouring buildings, trees and terrain are ignored, although in reality they often decide where the downwash falls.
- **S8 Pressure coefficients are constants** for a 30° roof; the terminal's horizontal distance from the ridge is ignored.
- **S9 Sea level.** Air density and barometric pressure are not corrected for elevation (many stove-heated towns in Türkiye lie above 1000 m).
- **S10 People.** Resting ventilation all night; no CO uptake term in the room balance (negligible); no effect of COHb on breathing; no pre-existing illness, smoking, pregnancy or anaemia.
- **S11 One fuel.** A lignite-like coal. Wood burns faster with a different CO profile.
- **S12 Alarm.** Sounds at the latest time the standard allows, hangs in the stove room, and everyone leaves immediately.

## 9. Open questions

These are the values I could not anchor to a source and did not want to
present as known. Each is marked "assumed" in the table.

- **Q1 CO yield curve** (`coYieldMin`, `coYieldMax`, `coYieldExp`, `reversedYieldShift`). The end points bracket published emission factors for household coal stoves, but the shape between them, and the rise under vitiated air, are guesses. Needs emission measurements on Turkish stoves and lignite at reduced air.
- **Q2 Burn law** (`burnMax`, `inletFloor`, `draughtFloor`, `fuelLoadKg`, `lhv`, `flueHeatFrac`). How fast does a banked soba actually burn, and how hot is its flue gas?
- **Q3 Stove tightness** (`stoveInletArea`, `stoveLeakArea`, `leakSpillShare`, `fireboxGasT`). Decides the flue flow and when fumes leak from the stove body.
- **Q4 Wind at the roof** (`roofWindFactor`) and **gust statistics** (`gustPeakFactor`, correlation times). The factor 0.6 scales every wind effect with its square.
- **Q5 Terminal pressure coefficients** (`cpTopFree`, `cpTopLee`, wake fluctuation, cap factors, `ridgeBlend`). The windward-slope value comes from a structural code, which gives surface pressures, not the pressure at a pipe opening. Wind-tunnel data for chimney terminals near ridges is needed.
- **Q6 CFK inputs for the older adult, child and infant.** Scaled from general physiology; fetal haemoglobin and sleep-related changes in ventilation are ignored.
- **Q7 Chimney heat transfer** (`chimHi`, `chimUo`, `chimWallCap`, `pipeU`). Sets how quickly the draught fades after the stove is turned down. A bare steel pipe run outdoors (common in practice) would cool much faster than the masonry-like chimney assumed here.
- **Q8 House leakage** (`leakCdA`, `achStack`, door exchange). Wind-driven air change dilutes CO strongly in the model; tightly sealed winter rooms would reach higher concentrations than shown.
- **Q9 Symptom bands and vulnerable people.** The bands are textbook values for healthy adults. Should the older adult and the infant have lower bands?
- **Q10 Risk index of Tonight mode** (`weakDraughtPa`, `riskLow`, `riskHigh`). The index is relative; the thresholds for the three words are arbitrary and unvalidated against poisoning records.
- **Q11 EN 13384-1 and EN 50291-1 values** (`ridgeClearance`, alarm times) and the EN 1991-1-4 coefficients were entered from memory of the standards and should be checked against the current editions.

## 10. References

- Coburn RF, Forster RE, Kane PB. Considerations of the physiological variables that determine the blood carboxyhemoglobin concentration in man. *J Clin Invest* 1965;44:1899–1910.
- Peterson JE, Stewart RD. Absorption and elimination of carbon monoxide by inactive young men. *Arch Environ Health* 1970;21:165–171.
- Peterson JE, Stewart RD. Predicting the carboxyhemoglobin levels resulting from carbon monoxide exposures. *J Appl Physiol* 1975;39:633–638.
- World Health Organization. *Carbon Monoxide*, Environmental Health Criteria 213, 2nd ed. Geneva, 1999.
- Zhang J, Smith KR, Ma Y, et al. Greenhouse gases and other airborne pollutants from household stoves in China: a database for emission factors. *Atmos Environ* 2000;34:4537–4549.
- EN 13384-1. Chimneys — Thermal and fluid dynamic calculation methods — Part 1: Chimneys serving one heating appliance.
- EN 1991-1-4. Eurocode 1: Actions on structures — Part 1-4: Wind actions.
- EN 50291-1. Gas detectors — Electrical apparatus for the detection of carbon monoxide in domestic premises.
- Idelchik IE. *Handbook of Hydraulic Resistance*.
- ASHRAE. *Handbook of Fundamentals*, chapters on ventilation and infiltration, and on airflow around buildings.

The bibliographic details above were written from memory without access to
the sources during development; please verify them before citing this model.
