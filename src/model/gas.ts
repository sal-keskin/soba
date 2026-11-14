import { K } from './params';

/** Density of air (or air-like flue gas) from the ideal gas law, kg/m³. */
export function density(tC: number, pressure: number = K.pAtm): number {
  return pressure / (K.rAir * (tC + 273.15));
}

/**
 * Stack pressure of a gas column of height H (m) at mean temperature tFlue
 * against outdoor air at tOut:  Δp = g·H·(ρ_out − ρ_flue), Pa.
 * Positive means the column pulls upward.
 */
export function stackPressure(heightM: number, tOutC: number, tFlueC: number): number {
  return K.g * heightM * (density(tOutC) - density(tFlueC));
}

/** Dynamic pressure of wind, ½·ρ·v², Pa. */
export function dynamicPressure(speed: number, tOutC: number): number {
  return 0.5 * density(tOutC) * speed * speed;
}

/** kg of CO per m³ of air that corresponds to 1 ppm by volume at tC. */
export function coKgPerM3PerPpm(tC: number): number {
  return ((K.mCO / 1000) * K.pAtm) / (K.rGas * (tC + 273.15)) * 1e-6;
}

/** Signed square root: sign(x)·√|x|. */
export function ssqrt(x: number): number {
  return x >= 0 ? Math.sqrt(x) : -Math.sqrt(-x);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
