/**
 * Headless run of one night, printed as CSV for sanity checks.
 *
 *   npm run night -- [preset] [--seed N] [--every SECONDS] [--summary]
 *
 * preset: frost | lodos | banked | soot | ridge   (default: lodos)
 */
import { FAMILY, K, Night, PRESETS, PRESET_ORDER, SAMPLE_S, coInRooms, type PresetId } from '../src/model';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = (args.find((a) => !a.startsWith('--') && (PRESET_ORDER as string[]).includes(a)) ?? 'lodos') as PresetId;
const seed = flag('--seed');
const every = Math.max(SAMPLE_S, Number(flag('--every') ?? 300));
const summaryOnly = args.includes('--summary');

const scenario = { ...PRESETS[id], ...(seed !== undefined ? { seed: Number(seed) } : {}) };
const night = new Night(scenario);
night.runToEnd();

const clock = (t: number): string => {
  const m = Math.round(t / 60) + K.startHour * 60;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

if (!summaryOnly) {
  const head = [
    'clock', 't_s', 'wind_roof_m_s', 'stack_Pa', 'room_Pa', 'terminal_Pa', 'net_Pa', 'collar_Pa', 'flue_g_s',
    'spill_frac', 'fuel_kg', 'ppm_stove_room', 'ppm_bedroom',
    ...FAMILY.map((f) => `cohb_${f.kind}_pct`),
  ];
  console.log(head.join(','));
  for (const s of night.samples) {
    if (s.t % every !== 0) continue;
    console.log(
      [
        clock(s.t), s.t, s.vRoof.toFixed(2), s.stack.toFixed(2), s.pRoom.toFixed(2), s.pTop.toFixed(2),
        s.draught.toFixed(2), s.collar.toFixed(2), (s.flow * 1000).toFixed(3), s.spill.toFixed(3), s.fuelKg.toFixed(2),
        s.ppm0.toFixed(1), s.ppm1.toFixed(1), ...s.cohb.map((x) => x.toFixed(2)),
      ].join(','),
    );
  }
}

const st = night.state.stats;
const residual = st.coProduced - st.coOutFlue - st.coOutEnvelope - coInRooms(night.state);
console.error(
  [
    `# preset=${id} seed=${scenario.seed}`,
    `# reversed ${(st.reversedS / 60).toFixed(0)} min, spilling ${(st.spillS / 60).toFixed(0)} min` +
      (st.firstSpillT >= 0 ? `, first at ${clock(st.firstSpillT)}` : ''),
    `# CO produced ${(st.coProduced * 1000).toFixed(1)} g, spilled indoors ${(st.coSpilled * 1000).toFixed(1)} g, mass-balance residual ${residual.toExponential(2)} kg`,
    `# peak %COHb: ${FAMILY.map((f, i) => `${f.kind} ${night.state.people[i].peakPct.toFixed(1)}`).join(', ')}`,
  ].join('\n'),
);
