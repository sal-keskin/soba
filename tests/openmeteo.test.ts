import { describe, expect, it } from 'vitest';
import { forecastUrl, geocodeUrl, parsePlaces, pickTonight } from '../src/ui/openmeteo';
import { DICTS } from '../src/ui/i18n';

/** A response in the documented shape: hourly rows from yesterday 00:00 for three days. */
function response(offsetSeconds: number, startDate: string, patch?: (h: Record<string, (number | null)[]>) => void) {
  const time: string[] = [];
  const base = Date.parse(`${startDate}T00:00:00Z`);
  for (let i = 0; i < 72; i++) time.push(new Date(base + i * 3600e3).toISOString().slice(0, 16));
  const hourly: Record<string, (number | null)[]> = {
    temperature_2m: time.map((_, i) => 10 - i * 0.1),
    wind_speed_10m: time.map((_, i) => i * 0.1),
    wind_direction_10m: time.map(() => 225),
    wind_gusts_10m: time.map((_, i) => i * 0.2),
  };
  patch?.(hourly);
  return { utc_offset_seconds: offsetSeconds, timezone: 'Europe/Istanbul', hourly: { time, ...hourly } };
}

describe('Open-Meteo requests', () => {
  it('builds the documented geocoding request', () => {
    const u = new URL(geocodeUrl(' Erzurum ', 'tr'));
    expect(u.origin + u.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(u.searchParams.get('name')).toBe('Erzurum');
    expect(u.searchParams.get('language')).toBe('tr');
    expect(u.searchParams.get('format')).toBe('json');
  });

  it('builds the documented forecast request in m/s and local time', () => {
    const u = new URL(forecastUrl({ latitude: 39.9087, longitude: 41.2769 }));
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(u.searchParams.get('hourly')).toBe('temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m');
    expect(u.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(u.searchParams.get('timezone')).toBe('auto');
    expect(u.searchParams.get('latitude')).toBe('39.909');
    expect([...u.searchParams.keys()].some((k) => /key|token/i.test(k))).toBe(false);
  });
});

describe('Open-Meteo responses', () => {
  it('parses places and tolerates a missing results field', () => {
    expect(parsePlaces({})).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
    const p = parsePlaces({ results: [{ id: 1, name: 'İzmir', latitude: 38.4, longitude: 27.1, admin1: 'İzmir', country: 'Türkiye' }, { name: 'broken' }] });
    expect(p).toHaveLength(1);
    expect(p[0].name).toBe('İzmir');
  });

  it('in the evening picks the coming night, 22:00 to 06:00 local', () => {
    const now = Date.parse('2026-11-14T15:00:00Z'); // 18:00 in UTC+3
    const f = pickTonight(response(10800, '2026-11-13'), now)!;
    expect(f.date).toBe('2026-11-14');
    expect(f.hours).toHaveLength(9);
    expect(f.hours[0].tOut).toBeCloseTo(10 - 46 * 0.1, 6); // row 46 = second day 22:00
    expect(f.hours[0].dirDeg).toBe(225);
  });

  it('after midnight picks the night that is under way', () => {
    const now = Date.parse('2026-11-14T23:30:00Z'); // 02:30 on the 15th in UTC+3
    expect(pickTonight(response(10800, '2026-11-13'), now)!.date).toBe('2026-11-14');
  });

  it('never lets gusts fall below the mean wind and fills missing gusts', () => {
    const now = Date.parse('2026-11-14T15:00:00Z');
    const f = pickTonight(response(10800, '2026-11-13', (h) => { h.wind_gusts_10m[46] = null; h.wind_gusts_10m[47] = 0; }), now)!;
    expect(f.hours[0].gust).toBe(f.hours[0].wind);
    expect(f.hours[1].gust).toBe(f.hours[1].wind);
  });

  it('returns null for incomplete or malformed data', () => {
    const now = Date.parse('2026-11-14T15:00:00Z');
    expect(pickTonight({}, now)).toBeNull();
    expect(pickTonight({ error: true, reason: 'x' }, now)).toBeNull();
    expect(pickTonight(response(10800, '2026-11-13', (h) => { h.temperature_2m[50] = null; }), now)).toBeNull();
    expect(pickTonight(response(10800, '2026-11-01'), now)).toBeNull();
  });
});

describe('interface text', () => {
  it('has the same keys in Turkish and English', () => {
    expect(Object.keys(DICTS.tr).sort()).toEqual(Object.keys(DICTS.en).sort());
  });

  it('never calls anything safe', () => {
    for (const s of Object.values(DICTS.en)) expect(s).not.toMatch(/\bsafe(ly|ty)?\b/i);
    for (const s of Object.values(DICTS.tr)) expect(s.toLocaleLowerCase('tr')).not.toMatch(/güvenli|emniyetli|tehlikesiz|risksiz(?! olduğu anlamına gelmez)/);
  });

  it('carries the emergency number in both languages', () => {
    expect(DICTS.tr.note).toContain('112');
    expect(DICTS.en.note).toContain('112');
  });
});
