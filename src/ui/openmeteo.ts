/**
 * Open-Meteo client. Endpoints and parameter names were checked against the
 * documentation source in github.com/open-meteo/open-meteo-website
 * (src/routes/en/docs and docs/geocoding-api) on 2026-11-14:
 *
 *   Geocoding  https://geocoding-api.open-meteo.com/v1/search
 *              name (required), count (default 10, max 100), language (default en),
 *              format (default json), countryCode (ISO-3166-1 alpha2).
 *              Response: { results: [{ id, name, latitude, longitude, elevation,
 *              country_code, country, admin1, timezone, ... }] }; empty fields,
 *              including `results` itself, are omitted.
 *   Forecast   https://api.open-meteo.com/v1/forecast
 *              latitude, longitude, hourly (comma-separated variables),
 *              wind_speed_unit (kmh default; ms, mph, kn), timezone ("auto"
 *              resolves from the coordinates), past_days, forecast_days.
 *              Response: { utc_offset_seconds, timezone, hourly: { time: [...],
 *              <variable>: [...] }, hourly_units }. Errors: HTTP 400 with
 *              { error: true, reason }.
 *              wind_gusts_10m is the maximum of the preceding hour.
 *
 * No key, no cookies. Only the typed place name and the chosen coordinates
 * leave the browser.
 */
import type { ForecastHour } from '../model';

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURLY = ['temperature_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'] as const;

export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  elevation?: number;
}

export interface TonightForecast {
  /** local date on which the night begins, yyyy-mm-dd */
  date: string;
  /** nine hourly points, 22:00 to 06:00 local time */
  hours: ForecastHour[];
}

export function geocodeUrl(name: string, language: string): string {
  const q = new URLSearchParams({ name: name.trim(), count: '8', language, format: 'json' });
  return `${GEOCODING_URL}?${q}`;
}

export function forecastUrl(place: Pick<Place, 'latitude' | 'longitude'>): string {
  const q = new URLSearchParams({
    latitude: place.latitude.toFixed(3),
    longitude: place.longitude.toFixed(3),
    hourly: HOURLY.join(','),
    wind_speed_unit: 'ms',
    timezone: 'auto',
    past_days: '1',
    forecast_days: '2',
  });
  return `${FORECAST_URL}?${q}`;
}

export function parsePlaces(json: unknown): Place[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is Place => typeof r?.latitude === 'number' && typeof r?.longitude === 'number' && typeof r?.name === 'string')
    .map((r) => ({
      id: r.id, name: r.name, latitude: r.latitude, longitude: r.longitude,
      admin1: r.admin1, country: r.country, elevation: r.elevation,
    }));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Pick the 22:00–06:00 window from a forecast response. Before 06:00 local
 * time the night that is under way is used, otherwise the coming one.
 * Returns null when the response does not contain nine complete hours.
 */
export function pickTonight(json: unknown, nowMs: number): TonightForecast | null {
  const j = json as {
    utc_offset_seconds?: number;
    hourly?: { time?: string[] } & Record<string, (number | null)[] | string[] | undefined>;
  };
  const time = j?.hourly?.time;
  if (!Array.isArray(time) || typeof j.utc_offset_seconds !== 'number') return null;
  const local = new Date(nowMs + j.utc_offset_seconds * 1000);
  if (local.getUTCHours() < 6) local.setUTCDate(local.getUTCDate() - 1);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const start = time.indexOf(`${date}T22:00`);
  if (start < 0 || start + 8 >= time.length) return null;
  const col = (name: string): (number | null)[] => (j.hourly?.[name] as (number | null)[] | undefined) ?? [];
  const [temp, wind, dir, gust] = HOURLY.map(col);
  const hours: ForecastHour[] = [];
  for (let i = start; i <= start + 8; i++) {
    const tOut = temp[i];
    const w = wind[i];
    const d = dir[i];
    if (typeof tOut !== 'number' || typeof w !== 'number' || typeof d !== 'number') return null;
    const gRaw = gust[i];
    hours.push({ tOut, wind: Math.max(0, w), gust: Math.max(w, typeof gRaw === 'number' ? gRaw : w), dirDeg: d });
  }
  return { date, hours };
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function searchPlaces(name: string, language: string, signal?: AbortSignal): Promise<Place[]> {
  return parsePlaces(await getJson(geocodeUrl(name, language), signal));
}

export async function fetchTonight(place: Place, signal?: AbortSignal): Promise<TonightForecast | null> {
  return pickTonight(await getJson(forecastUrl(place), signal), Date.now());
}
