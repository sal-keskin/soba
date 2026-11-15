import {
  K, forecastScenario, nightRisk, type ForecastHour, type HourRisk, type Scenario,
} from '../model';
import { getLang, num, onLang, t } from './i18n';
import { fetchTonight, searchPlaces, type Place, type TonightForecast } from './openmeteo';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Arrow showing where the wind blows to, for a direction it comes from. */
function windArrow(fromDeg: number): string {
  return ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'][Math.round(fromDeg / 45) % 8];
}

function compass(deg: number): string {
  return t('compass').split(',')[Math.round(deg / 45) % 8];
}

const hourLabel = (h: number): string => `${String((K.startHour + h) % 24).padStart(2, '0')}:00`;

function isLodos(h: ForecastHour): boolean {
  return h.dirDeg >= 180 && h.dirDeg <= 270 && h.tOut >= 10 && h.gust >= 10;
}

export function initTonight(onPlay: (sc: Scenario) => void): void {
  const form = $<HTMLFormElement>('search-form');
  const input = $<HTMLInputElement>('q');
  const msg = $('tonight-msg');
  const places = $<HTMLUListElement>('places');
  const result = $('tonight-result');
  const facing = $<HTMLSelectElement>('facing');
  let abort: AbortController | null = null;
  let current: { place: Place; forecast: TonightForecast; risk: HourRisk[] } | null = null;

  const say = (key: string): void => {
    msg.textContent = key ? t(key) : '';
    msg.dataset.key = key;
  };

  const facingDeg = (): number | null => (facing.value === '' ? null : Number(facing.value));

  function fillFacing(): void {
    const keep = facing.value;
    facing.replaceChildren(new Option(t('facingUnknown'), ''));
    t('compass').split(',').forEach((name, i) => facing.add(new Option(name, String(i * 45))));
    facing.value = keep;
  }

  function render(): void {
    if (!current) return;
    const { place, forecast, risk } = current;
    const date = new Date(`${forecast.date}T12:00:00Z`).toLocaleDateString(getLang() === 'tr' ? 'tr-TR' : 'en-GB', {
      day: 'numeric', month: 'long', timeZone: 'UTC',
    });
    $('night-title').textContent = t('nightOf', { place: [place.name, place.admin1].filter(Boolean).join(', '), date });

    const top = risk.some((r) => r.level === 'higher') ? 'higher' : risk.some((r) => r.level === 'raised') ? 'raised' : 'lower';
    const hit = risk.filter((r) => r.level === top);
    $('risk-summary').textContent = t(
      top === 'higher' ? 'riskSummaryHigher' : top === 'raised' ? 'riskSummaryRaised' : 'riskSummaryLower',
      { from: hourLabel(hit[0].hour), to: hourLabel(hit[hit.length - 1].hour + 1) },
    );

    const chart = $('risk-chart');
    chart.replaceChildren(
      ...risk.map((r) => {
        const col = document.createElement('div');
        col.className = 'risk-col';
        col.dataset.level = r.level;
        const lvl = document.createElement('span');
        lvl.className = 'lvl';
        lvl.textContent = t(`level_${r.level}`);
        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.style.height = `${6 + r.risk * 70}%`;
        const hr = document.createElement('span');
        hr.className = 'hr';
        hr.textContent = hourLabel(r.hour).slice(0, 2);
        col.append(lvl, fill, hr);
        return col;
      }),
    );
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', risk.map((r) => `${hourLabel(r.hour)} ${t(`level_${r.level}`)}`).join(', '));

    const table = $<HTMLTableElement>('risk-table');
    const head = `<thead><tr>${['hourCol', 'tempCol', 'windCol', 'dirCol', 'riskCol'].map((k) => `<th scope="col">${t(k)}</th>`).join('')}</tr></thead>`;
    const rows = risk
      .map((r) => {
        const h = forecast.hours[r.hour];
        return `<tr><th scope="row">${hourLabel(r.hour)}</th><td>${num(h.tOut)}</td><td>${num(h.wind, 1)} → ${num(h.gust, 1)}</td><td>${windArrow(h.dirDeg)} ${compass(h.dirDeg)}</td><td>${t(`level_${r.level}`)}</td></tr>`;
      })
      .join('');
    table.innerHTML = `${head}<tbody>${rows}</tbody>`;
    $('lodos-note').hidden = !forecast.hours.some(isLodos);
    result.hidden = false;
  }

  function compute(): void {
    if (!current) return;
    say('computing');
    const job = current;
    // let the message paint before the model runs (a few hundred milliseconds)
    setTimeout(() => {
      job.risk = nightRisk(job.forecast.hours, facingDeg());
      if (current !== job) return;
      say('');
      render();
    }, 30);
  }

  async function choose(place: Place): Promise<void> {
    abort?.abort();
    abort = new AbortController();
    places.replaceChildren();
    result.hidden = true;
    say('loadingForecast');
    try {
      const forecast = await fetchTonight(place, abort.signal);
      if (!forecast) return say('badForecast');
      current = { place, forecast, risk: [] };
      compute();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') say('offline');
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) return;
    abort?.abort();
    abort = new AbortController();
    places.replaceChildren();
    say('searching');
    try {
      const found = await searchPlaces(q, getLang(), abort.signal);
      if (!found.length) return say('noResults');
      say('pickPlace');
      places.replaceChildren(
        ...found.map((p) => {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.append(p.name, ' ');
          const sm = document.createElement('small');
          sm.textContent = [p.admin1, p.country].filter(Boolean).join(', ');
          b.append(sm);
          b.addEventListener('click', () => void choose(p));
          li.append(b);
          return li;
        }),
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') say('offline');
    }
  });

  facing.addEventListener('change', compute);

  $('play-tonight').addEventListener('click', () => {
    if (!current) return;
    // with unknown orientation, play the side that scored worse over the night
    const votes = current.risk.reduce((a, r) => a + r.windDir * (r.risk + 0.01), 0);
    onPlay(forecastScenario(current.forecast.hours, facingDeg(), votes >= 0 ? 1 : -1, 1));
  });

  onLang(() => {
    fillFacing();
    input.placeholder = t('searchPlaceholder');
    if (msg.dataset.key) msg.textContent = t(msg.dataset.key);
    render();
  });
  fillFacing();
  input.placeholder = t('searchPlaceholder');
}
