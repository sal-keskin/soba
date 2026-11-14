import type { Scenario } from './night';
import type { Controls } from './types';

export type PresetId = 'frost' | 'lodos' | 'banked' | 'soot' | 'ridge';

/** The standard house on an unremarkable night; presets override parts of it. */
export const BASE_CONTROLS: Controls = {
  tOut: 2,
  wind: 3,
  gust: 5,
  windDir: 1,
  align: 1,
  chimneyRel: 0.6,
  cap: 'none',
  soot: 0.1,
  damper: 1,
  inlet: 0.5,
  window: 0,
  door: 0,
  alarm: false,
};

const HOUR = 3600;

export const PRESETS: Record<PresetId, Scenario> = {
  // Cold, still air and a lively fire: strong stack, nothing to oppose it.
  frost: {
    seed: 11,
    controls: { ...BASE_CONTROLS, tOut: -5, wind: 1.5, gust: 2.5, inlet: 0.5, chimneyRel: 0.6 },
  },
  // Warm, gusty south-westerly; the stove is turned down because it is mild,
  // and the pipe ends below the ridge on the side the wind comes from.
  lodos: {
    seed: 23,
    controls: {
      ...BASE_CONTROLS, tOut: 14, wind: 11, gust: 20, windDir: 1, chimneyRel: -1.0,
      inlet: 0.25, damper: 0.7, soot: 0.25, door: 1,
    },
  },
  // A breezy, mild night. The lively evening fire copes; at midnight the stove
  // is topped up and shut down "so it lasts until morning".
  banked: {
    seed: 37,
    controls: {
      ...BASE_CONTROLS, tOut: 8, wind: 8, gust: 14, windDir: 1, chimneyRel: -0.5, inlet: 0.7, door: 1,
    },
    events: [{ t: 2 * HOUR, patch: { inlet: 0.03, damper: 0.3 } }],
    fuelKg: 9,
  },
  // A flue that has not been swept: almost blocked, on an otherwise quiet night.
  soot: {
    seed: 41,
    controls: { ...BASE_CONTROLS, tOut: 3, wind: 3, gust: 6, soot: 0.97, inlet: 0.6, damper: 0.6 },
  },
  // Cold and windy with a good fire, but the pipe ends just above the eaves.
  ridge: {
    seed: 53,
    controls: {
      ...BASE_CONTROLS, tOut: 0, wind: 8, gust: 14, windDir: 1, chimneyRel: -1.6, inlet: 0.35, door: 1,
    },
  },
};

export const PRESET_ORDER: PresetId[] = ['frost', 'lodos', 'banked', 'soot', 'ridge'];
