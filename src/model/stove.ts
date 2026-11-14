import { K } from './params';
import { clamp } from './gas';

export interface StoveOut {
  /** burn rate, kg/s */
  burn: number;
  /** heat release, W */
  heat: number;
  /** kg CO per kg fuel */
  coYield: number;
  /** CO produced, kg/s */
  coRate: number;
  /** minimum gas flow the flue must carry to take all combustion products, kg/s */
  products: number;
}

/** CO yield as a function of the air inlet opening (0–1). */
export function coYield(inlet: number): number {
  const a = clamp(inlet, 0, 1);
  return K.coYieldMin + (K.coYieldMax - K.coYieldMin) * Math.pow(1 - a, K.coYieldExp);
}

/**
 * Burn rate for the given inlet opening, remaining fuel and signed flue flow
 * (kg/s; negative when reversed). Air passes through the fuel bed in either
 * direction, so the burn rate depends on the size of the flow; a reversed flue
 * feeds the fire with vitiated air, which raises the CO yield.
 */
export function stove(inlet: number, fuelKg: number, flueFlow: number): StoveOut {
  const a = clamp(inlet, 0, 1);
  const air = K.inletFloor + (1 - K.inletFloor) * a;
  const fuel = clamp(fuelKg / K.fuelTaperKg, 0, 1);
  const nominal = (K.burnMax / 3600) * air * fuel;
  const need = nominal * (1 + K.afr);
  const d = need > 0 ? clamp(Math.abs(flueFlow) / need, K.draughtFloor, 1) : 1;
  const burn = nominal * d;
  let y = coYield(a);
  if (flueFlow < 0) y += (K.coYieldMax - y) * K.reversedYieldShift;
  return {
    burn,
    heat: burn * K.lhv,
    coYield: y,
    coRate: burn * y,
    products: burn * (1 + K.afr),
  };
}
