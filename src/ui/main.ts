import './style.css';
import {
  FAMILY, K, NIGHT_SECONDS, Night, PEOPLE, PRESETS, PRESET_ORDER, debrief, percent, stageOf,
  type Controls, type PresetId, type Scenario,
} from '../model';
import { getLang, initLang, num, onLang, setLang, t } from './i18n';
import { Scene, flowState } from './scene';
import { clock, drawTimeline } from './timeline';
import { initTonight } from './tonight';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Simulated seconds per real second at 1×: eight hours in two minutes. */
const RATE = NIGHT_SECONDS / 120;

initLang();

const canvas = $<HTMLCanvasElement>('scene');
const tl = $<HTMLCanvasElement>('timeline');
const scrub = $<HTMLInputElement>('scrub');
const playBtn = $<HTMLButtonElement>('play');
const speedSel = $<HTMLSelectElement>('speed');
const dialog = $<HTMLDialogElement>('debrief');
const scene = new Scene(canvas);
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let scenario: Scenario = PRESETS.lodos;
let presetId: PresetId | 'tonight' = 'lodos';
let tonightScenario: Scenario | null = null;
let night = new Night(scenario);
let playing = !reducedQuery.matches;
let debriefShown = false;

// ───────────── controls panel (keyboard and screen-reader path) ─────────────

interface RangeSpec { key: keyof Controls; min: number; max: number; step: number; fmt: (c: Controls) => string }
const pct = (v: number): string => `%${num(v * 100)}`;
const RANGES: RangeSpec[] = [
  { key: 'tOut', min: -20, max: 25, step: 1, fmt: (c) => `${num(c.tOut)} °C` },
  { key: 'wind', min: 0, max: 20, step: 0.5, fmt: (c) => `${num(c.wind, 1)} m/s` },
  { key: 'gust', min: 0, max: 35, step: 0.5, fmt: (c) => `${num(c.gust, 1)} m/s` },
  {
    key: 'chimneyRel', min: K.chimRelMin, max: K.chimRelMax, step: 0.1,
    fmt: (c) => `${num(Math.abs(c.chimneyRel), 1)} m ${t(c.chimneyRel < 0 ? 'below' : 'above')}`,
  },
  { key: 'soot', min: 0, max: 1, step: 0.05, fmt: (c) => pct(c.soot) },
  { key: 'damper', min: 0, max: 1, step: 0.05, fmt: (c) => `${pct(c.damper)} ${t('open')}` },
  { key: 'inlet', min: 0, max: 1, step: 0.05, fmt: (c) => `${pct(c.inlet)} ${t('open')}` },
  { key: 'window', min: 0, max: 1, step: 0.05, fmt: (c) => `${pct(c.window)} ${t('open')}` },
  { key: 'door', min: 0, max: 1, step: 0.1, fmt: (c) => `${pct(c.door)} ${t('open')}` },
];
const inputs = new Map<string, { input: HTMLInputElement | HTMLSelectElement; out?: HTMLOutputElement; spec?: RangeSpec }>();

function apply(patch: Partial<Controls>): void {
  if (patch.wind !== undefined && patch.gust === undefined && night.controls.gust < patch.wind) patch.gust = patch.wind;
  if (patch.gust !== undefined && patch.gust < (patch.wind ?? night.controls.wind)) patch.gust = patch.wind ?? night.controls.wind;
  night.set(patch);
  debriefShown = false;
}

function buildControls(): void {
  const host = $('controls');
  host.replaceChildren();
  inputs.clear();
  const select = (key: 'windDir' | 'cap', options: [string, string][]): void => {
    const label = document.createElement('label');
    label.append(t(`c_${key}`));
    const sel = document.createElement('select');
    for (const [v, text] of options) sel.add(new Option(text, v));
    sel.addEventListener('change', () =>
      apply(key === 'windDir' ? { windDir: Number(sel.value) as 1 | -1 } : { cap: sel.value as Controls['cap'] }),
    );
    label.append(sel);
    host.append(label);
    inputs.set(key, { input: sel });
  };
  for (const spec of RANGES) {
    const label = document.createElement('label');
    const head = document.createElement('span');
    head.className = 'head';
    const out = document.createElement('output');
    head.append(t(`c_${spec.key}`), out);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.addEventListener('input', () => apply({ [spec.key]: Number(input.value) } as Partial<Controls>));
    label.append(head, input);
    host.append(label);
    inputs.set(spec.key, { input, out, spec });
    if (spec.key === 'gust') select('windDir', [['1', t('windFromChimney')], ['-1', t('windFromWindow')]]);
    if (spec.key === 'chimneyRel') select('cap', [['none', t('cap_none')], ['rain', t('cap_rain')], ['h', t('cap_h')]]);
  }
  const check = document.createElement('label');
  check.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.addEventListener('change', () => apply({ alarm: box.checked }));
  check.append(box, t('c_alarm'));
  host.append(check);
  inputs.set('alarm', { input: box });
}

function syncControls(): void {
  const c = night.controls;
  for (const [key, { input, out, spec }] of inputs) {
    const v = c[key as keyof Controls];
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(v);
    else if (document.activeElement !== input) input.value = String(v);
    if (out && spec) {
      const text = spec.fmt(c);
      if (out.textContent !== text) {
        out.textContent = text;
        input.setAttribute('aria-valuetext', text);
      }
    }
  }
}

// ───────────── presets, transport ─────────────

function load(sc: Scenario, id: PresetId | 'tonight'): void {
  scenario = sc;
  presetId = id;
  night = new Night(sc);
  debriefShown = false;
  playing = !reducedQuery.matches;
  buildPresets();
  refresh(true);
}

function buildPresets(): void {
  const host = $('preset-list');
  const ids: (PresetId | 'tonight')[] = [...PRESET_ORDER];
  if (tonightScenario) ids.push('tonight');
  host.replaceChildren(
    ...ids.map((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t(`preset_${id}`);
      b.setAttribute('aria-pressed', String(id === presetId));
      b.addEventListener('click', () => load(id === 'tonight' ? tonightScenario! : PRESETS[id], id));
      return b;
    }),
  );
}

playBtn.addEventListener('click', () => {
  if (night.finished) night.seek(0);
  playing = !playing;
  refresh(true);
});
$('restart').addEventListener('click', () => load(scenario, presetId));
scrub.addEventListener('input', () => {
  night.seek(Number(scrub.value));
  refresh(true);
});

// ───────────── drawing-surface interaction ─────────────

const point = (e: { clientX: number; clientY: number }): [number, number] => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
let downAt: [number, number] | null = null;
let moved = false;

canvas.addEventListener(
  'touchstart',
  (e) => {
    // keep the page from scrolling only when the touch lands on a handle
    const [x, y] = point(e.touches[0]);
    if (scene.handleAt(x, y, night.controls)) e.preventDefault();
  },
  { passive: false },
);
canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = point(e);
  const id = scene.handleAt(x, y, night.controls);
  if (!id) return;
  canvas.setPointerCapture(e.pointerId);
  scene.beginDrag(id, x, y, night.controls);
  downAt = [x, y];
  moved = false;
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = point(e);
  if (!scene.active) {
    canvas.style.cursor = scene.handleAt(x, y, night.controls) ? 'grab' : 'default';
    return;
  }
  if (downAt && Math.hypot(x - downAt[0], y - downAt[1]) > 6) moved = true;
  if (!moved) return;
  const patch = scene.dragTo(x, y, night.controls);
  if (patch) apply(patch);
  canvas.style.cursor = 'grabbing';
  if (!playing) refresh(true);
});
const release = (): void => {
  if (scene.active && !moved) {
    const patch = scene.tap(scene.active, night.controls);
    if (patch) apply(patch);
  }
  scene.endDrag();
  downAt = null;
  canvas.style.cursor = 'default';
  if (!playing) refresh(true);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// ───────────── readouts ─────────────

function buildPeople(): void {
  const names = ['who_older', 'who_child', 'who_adult', 'who_infant'];
  $('people').replaceChildren(
    ...FAMILY.map((f, i) => {
      const li = document.createElement('li');
      const ticks = [10, 20, 30, 40, 50].map((p) => `<b style="left:${(p / 60) * 100}%"></b>`).join('');
      li.innerHTML = `<div class="who"><span>${t(names[i])} · ${t(f.zone === 0 ? 'stoveRoom' : 'bedroom')}</span><span class="pct"></span></div><div class="bar"><i></i>${ticks}</div><div class="stage-text"></div>`;
      return li;
    }),
  );
}

function syncPeople(): void {
  const items = $('people').children;
  FAMILY.forEach((f, i) => {
    const who = night.state.people[i];
    const p = percent(who.cohb, PEOPLE[f.kind]);
    const stage = stageOf(p);
    const li = items[i] as HTMLElement;
    li.querySelector('.pct')!.textContent = `COHb %${num(p, 1)}`;
    const bar = li.querySelector<HTMLElement>('.bar')!;
    bar.dataset.stage = String(stage);
    bar.querySelector<HTMLElement>('i')!.style.width = `${Math.min(100, (p / 60) * 100)}%`;
    li.querySelector('.stage-text')!.textContent = `${stage}/5 · ${t(`stage${stage}`)}${who.evacuated ? ` · ${t('outside')}` : ''}`;
  });
}

function statusText(): string {
  const d = night.state.diag;
  return t('status', {
    clock: clock(night.t),
    pa: `${d.collar >= 0 ? '+' : '−'}${num(Math.abs(d.collar), 1)}`,
    flow: t(flowState(night)),
    ppm0: num(d.ppm[0]),
    ppm1: num(d.ppm[1]),
  });
}

function showDebrief(): void {
  const r = debrief(night);
  const names: Record<string, string> = { older: 'who_older', child: 'who_child', adult: 'who_adult', infant: 'who_infant' };
  const body = $('debrief-body');
  const lead = document.createElement('p');
  lead.className = 'lead';
  lead.textContent = t(r.outcome === 'severe' ? 'debriefSevere' : r.outcome === 'mild' ? 'debriefMild' : 'debriefNone');
  const parts: HTMLElement[] = [lead];
  if (r.alarmAt >= 0) {
    const p = document.createElement('p');
    p.textContent = t('debriefAlarm', { clock: clock(r.alarmAt) });
    parts.push(p);
  }
  const table = document.createElement('table');
  table.innerHTML = r.people
    .map((p) => `<tr><th scope="row">${t(names[p.kind])}</th><td>COHb %${num(p.peakPct, 1)}</td><td>${p.stage}/5 · ${t(`stage${p.stage}`)}</td></tr>`)
    .join('');
  parts.push(table);
  const h1 = document.createElement('h3');
  h1.textContent = t('whatHappened');
  const ul = document.createElement('ul');
  for (const m of r.mechanisms) {
    const v: Record<string, string | number> = {};
    for (const [k, val] of Object.entries(m.vars ?? {})) {
      if (k === 't') v.clock = clock(Number(val));
      else if (typeof val === 'string') v[k] = t(val);
      else v[k] = num(val, Math.abs(val) < 20 && !Number.isInteger(val) ? 1 : 0);
    }
    const li = document.createElement('li');
    li.textContent = t(m.key, v);
    ul.append(li);
  }
  const h2 = document.createElement('h3');
  h2.textContent = t('actions');
  const ol = document.createElement('ol');
  for (const a of r.actions) {
    const li = document.createElement('li');
    li.textContent = t(a);
    ol.append(li);
  }
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = t('note');
  body.replaceChildren(...parts, h1, ul, h2, ol, note);
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('close', () => {
  const again = dialog.returnValue === 'again';
  dialog.returnValue = '';
  if (again) load(scenario, presetId);
});
// click-outside fallback where <dialog closedby> is not supported
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e: PointerEvent): boolean => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e); });
  dialog.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e)) dialog.close(); });
}

// ───────────── frame loop ─────────────

let last = performance.now();
let slowTick = 0;
let lastDraw = 0;

function refresh(force = false): void {
  const now = performance.now();
  if (force || now - slowTick > 250) {
    slowTick = now;
    syncControls();
    syncPeople();
    const text = statusText();
    $('status').textContent = text;
    canvas.setAttribute('aria-label', `${t('sceneLabel')} ${text}`);
    $('clock').textContent = clock(night.t);
    playBtn.textContent = t(playing ? 'pause' : 'play');
    scrub.value = String(Math.round(night.t / 60) * 60);
    scrub.setAttribute('aria-valuetext', clock(night.t));
    drawTimeline(tl, night);
  }
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const visible = !$('view-play').hidden;
  if (playing && visible && !dialog.open) {
    night.advanceTo(night.t + RATE * Number(speedSel.value) * dt);
    if (night.finished) {
      playing = false;
      refresh(true);
      if (!debriefShown) {
        debriefShown = true;
        showDebrief();
      }
    }
  }
  const reduced = reducedQuery.matches;
  if (visible && (!reduced || now - lastDraw > 250 || scene.active)) {
    lastDraw = now;
    scene.draw(night, dt, playing, reduced);
  }
  refresh();
  requestAnimationFrame(frame);
}

// ───────────── language, tabs, start ─────────────

function translatePage(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = t(el.dataset.t!);
  const lang = $('lang');
  lang.textContent = t('langButton');
  lang.setAttribute('aria-label', t('langLabel'));
  scrub.setAttribute('aria-label', t('scrub'));
  speedSel.setAttribute('aria-label', t('speed'));
  buildControls();
  buildPresets();
  buildPeople();
  refresh(true);
  if (dialog.open) showDebrief();
}
$('lang').addEventListener('click', () => setLang(getLang() === 'tr' ? 'en' : 'tr'));
onLang(translatePage);

function showTab(which: 'play' | 'tonight'): void {
  $('view-play').hidden = which !== 'play';
  $('view-tonight').hidden = which !== 'tonight';
  $('tab-play').setAttribute('aria-pressed', String(which === 'play'));
  $('tab-tonight').setAttribute('aria-pressed', String(which === 'tonight'));
  if (which === 'play') {
    scene.resize();
    refresh(true);
  }
}
$('tab-play').addEventListener('click', () => showTab('play'));
$('tab-tonight').addEventListener('click', () => showTab('tonight'));

initTonight((sc) => {
  tonightScenario = sc;
  showTab('play');
  load(sc, 'tonight');
});

new ResizeObserver(() => {
  scene.resize();
  if (!$('view-play').hidden) scene.draw(night, 0, false, reducedQuery.matches);
  refresh(true);
}).observe(canvas);

translatePage();
scene.resize();
requestAnimationFrame(frame);
