import { FAMILY, K, PEOPLE } from './params';
import { percent } from './cfk';
import { createState, NIGHT_SECONDS, step } from './sim';
import type { Controls, SimState } from './types';

/** A control change that takes effect at time t (s since 22:00). */
export interface ControlEvent {
  t: number;
  patch: Partial<Controls>;
}

export interface Scenario {
  seed: number;
  controls: Controls;
  events?: ControlEvent[];
  fuelKg?: number;
}

/** One row of the overnight record, taken every SAMPLE_S seconds. */
export interface Sample {
  t: number;
  /** net pressure driving the flue, Pa */
  draught: number;
  /** draught at the stove collar, Pa */
  collar: number;
  flow: number;
  spill: number;
  ppm0: number;
  ppm1: number;
  cohb: number[];
  vRoof: number;
  stack: number;
  pRoom: number;
  pTop: number;
  fuelKg: number;
}

export const SAMPLE_S = 30;
const SNAPSHOT_S = 300;

const clone = (s: SimState): SimState => structuredClone(s);

/**
 * A night that can be played, scrubbed and edited. The whole night is a pure
 * function of (seed, initial controls, control events), so seeking backwards
 * restores a snapshot and re-steps, and changing a control discards the
 * recorded future.
 */
export class Night {
  readonly seed: number;
  readonly initial: Controls;
  readonly fuelKg: number;
  events: ControlEvent[];
  state: SimState;
  controls: Controls;
  samples: Sample[] = [];
  private snapshots: { state: SimState; controls: Controls }[] = [];
  private nextEvent = 0;

  constructor(sc: Scenario) {
    this.seed = sc.seed;
    this.initial = { ...sc.controls };
    this.fuelKg = sc.fuelKg ?? K.fuelLoadKg;
    this.events = [...(sc.events ?? [])].sort((a, b) => a.t - b.t);
    this.controls = { ...this.initial };
    this.state = createState(this.initial, this.seed, this.fuelKg);
    this.record();
  }

  get t(): number {
    return this.state.t;
  }

  get finished(): boolean {
    return this.state.t >= NIGHT_SECONDS;
  }

  /** How far the night has been simulated, s. */
  get simulatedTo(): number {
    return this.samples.length ? this.samples[this.samples.length - 1].t : 0;
  }

  private record(): void {
    const s = this.state;
    if (s.t % SNAPSHOT_S === 0) {
      const i = s.t / SNAPSHOT_S;
      this.snapshots.length = i;
      this.snapshots.push({ state: clone(s), controls: { ...this.controls } });
    }
    if (s.t % SAMPLE_S === 0) {
      const i = s.t / SAMPLE_S;
      this.samples.length = i;
      this.samples.push({
        t: s.t,
        draught: s.diag.draught,
        collar: s.diag.collar,
        flow: s.diag.flueFlow,
        spill: s.diag.spill,
        ppm0: s.diag.ppm[0],
        ppm1: s.diag.ppm[1],
        cohb: s.people.map((p, k) => percent(p.cohb, PEOPLE[FAMILY[k].kind])),
        vRoof: s.diag.vRoof,
        stack: s.diag.stack,
        pRoom: s.diag.pRoom,
        pTop: s.diag.pTop,
        fuelKg: s.fuelKg,
      });
    }
  }

  private stepOnce(): void {
    while (this.nextEvent < this.events.length && this.events[this.nextEvent].t <= this.state.t) {
      Object.assign(this.controls, this.events[this.nextEvent].patch);
      this.nextEvent++;
    }
    step(this.state, this.controls);
    this.record();
  }

  /** Step forward until time t (clamped to the end of the night). */
  advanceTo(t: number): void {
    const end = Math.min(t, NIGHT_SECONDS);
    while (this.state.t + K.dt <= end + 1e-9) this.stepOnce();
  }

  /** Jump to any time of the night, forwards or backwards. */
  seek(t: number): void {
    const target = Math.max(0, Math.min(t, NIGHT_SECONDS));
    if (target < this.state.t) {
      const i = Math.min(Math.floor(target / SNAPSHOT_S), this.snapshots.length - 1);
      const snap = this.snapshots[i];
      this.state = clone(snap.state);
      this.controls = { ...snap.controls };
      // events up to (snapshot time − dt) were applied before the snapshot was taken
      this.nextEvent = this.events.findIndex((e) => e.t > this.state.t - K.dt);
      if (this.nextEvent < 0) this.nextEvent = this.events.length;
      // samples and snapshots after the restore point are rewritten as we re-step
    }
    this.advanceTo(target);
  }

  /** Change controls now. Everything recorded after this moment is discarded. */
  set(patch: Partial<Controls>): void {
    const t = this.state.t;
    this.events = this.events.filter((e) => e.t < t);
    this.events.push({ t, patch: { ...patch } });
    this.nextEvent = this.events.length;
    Object.assign(this.controls, patch);
    this.samples.length = Math.floor(t / SAMPLE_S) + 1;
    this.snapshots.length = Math.floor(t / SNAPSHOT_S) + 1;
    // The snapshot at exactly t (if any) was taken with the old controls.
    if (t % SNAPSHOT_S === 0) this.snapshots[t / SNAPSHOT_S].controls = { ...this.controls };
  }

  /** Run the rest of the night. */
  runToEnd(): void {
    this.advanceTo(NIGHT_SECONDS);
  }
}
