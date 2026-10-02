// @vitest-environment jsdom
// jsdom needed because ./restock transitively imports store/shopRegistry → utils/game/weatherDetection → utils/dom/dom, which reads document at module load.

import { describe, expect, it } from 'vitest';
import { restockUrgency } from './restock';
import { pityUrgency } from './pity';
import { forecastUrgency } from './weather';

describe('urgency curves', () => {
  it('restock: 1 at now, 0.5 at the 15 min edge, 0.2 beyond', () => {
    expect(restockUrgency(0)).toBe(1);
    expect(restockUrgency(15 * 60000)).toBe(0.5);
    expect(restockUrgency(16 * 60000)).toBe(0.2);
  });
  it('weather: 1 at now, 0.5 at the 10 min edge, 0.2 beyond', () => {
    expect(forecastUrgency(0)).toBe(1);
    expect(forecastUrgency(10 * 60000)).toBe(0.5);
    expect(forecastUrgency(11 * 60000)).toBe(0.2);
  });
  it('pity: 0.5 at ratio 0.8, 1 at ratio 1, 0.2 below', () => {
    expect(pityUrgency(0.8)).toBe(0.5);
    expect(pityUrgency(1)).toBe(1);
    expect(pityUrgency(0.5)).toBe(0.2);
  });
});
