/**
 * Seeded randomness. The generator state is a single 32-bit integer that is
 * stored in the simulation state, so a snapshot of the state fully determines
 * the rest of the night.
 */

export interface Rng {
  s: number;
}

/** mulberry32: returns a uniform number in [0, 1) and advances the state. */
export function uniform(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Standard normal by Box–Muller (two uniforms per call, nothing cached). */
export function gaussian(r: Rng): number {
  const u = Math.max(uniform(r), 1e-12);
  const v = uniform(r);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Exact discrete update of a unit-variance Ornstein–Uhlenbeck process with
 * correlation time tau over a step dt.
 */
export function ouStep(x: number, dt: number, tau: number, r: Rng): number {
  const a = Math.exp(-dt / tau);
  return x * a + Math.sqrt(1 - a * a) * gaussian(r);
}
