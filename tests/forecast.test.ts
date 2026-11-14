import { describe, expect, it } from 'vitest';
import { nightRisk, riskLevel, type ForecastHour } from '../src/model';

const flat = (h: ForecastHour): ForecastHour[] => Array.from({ length: 9 }, () => ({ ...h }));

describe('Tonight risk index', () => {
  it('a calm frosty night scores lower than a warm gusty one in every hour', () => {
    const calm = nightRisk(flat({ tOut: -4, wind: 1, gust: 2, dirDeg: 0 }));
    const lodos = nightRisk(flat({ tOut: 15, wind: 12, gust: 22, dirDeg: 225 }));
    expect(calm).toHaveLength(8);
    expect(lodos).toHaveLength(8);
    calm.forEach((c, i) => expect(c.risk).toBeLessThan(lodos[i].risk));
    expect(calm.every((h) => h.level === 'lower')).toBe(true);
    expect(lodos.some((h) => h.level === 'higher')).toBe(true);
  });

  it('follows the weather through the night', () => {
    const hours: ForecastHour[] = Array.from({ length: 9 }, (_, i) => ({
      tOut: 12, wind: i < 4 ? 2 : 13, gust: i < 4 ? 3 : 24, dirDeg: 220,
    }));
    const r = nightRisk(hours);
    expect(r[1].risk).toBeLessThan(r[6].risk);
  });

  it('with unknown orientation shows the worse of the two', () => {
    const hours = flat({ tOut: 12, wind: 11, gust: 20, dirDeg: 200 });
    const unknown = nightRisk(hours, null);
    const facingWind = nightRisk(hours, 200);
    const facingAway = nightRisk(hours, 20);
    unknown.forEach((u, i) => {
      expect(u.risk).toBeGreaterThanOrEqual(Math.max(facingWind[i].risk, facingAway[i].risk) - 1e-12);
    });
    expect(facingWind[0].windDir).toBe(1);
    expect(facingAway[0].windDir).toBe(-1);
  });

  it('is deterministic and bounded', () => {
    const hours = flat({ tOut: 9, wind: 7, gust: 14, dirDeg: 250 });
    const a = nightRisk(hours);
    expect(nightRisk(hours)).toEqual(a);
    for (const h of a) {
      expect(h.risk).toBeGreaterThanOrEqual(0);
      expect(h.risk).toBeLessThanOrEqual(1);
    }
  });

  it('never has a level called safe', () => {
    expect([0, 0.1, 0.9].map(riskLevel)).toEqual(['lower', 'raised', 'higher']);
  });

  it('returns nothing for an empty forecast', () => {
    expect(nightRisk([])).toEqual([]);
  });
});
