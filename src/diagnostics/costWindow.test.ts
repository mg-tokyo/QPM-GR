import { describe, it, expect } from 'vitest';

import { COST_WINDOW_MIN_MS, formatTopShare, takeCostWindow } from './costWindow';

interface Row { label: string; windowMs: number }

const rows = (...ms: number[]): Row[] => ms.map((v, i) => ({ label: `r${i}`, windowMs: v }));

describe('takeCostWindow', () => {
  it('picks the max and resets every entry', () => {
    const list = rows(1, 3, 0.5);
    const top = takeCostWindow(list, (r) => r.label);
    expect(top).toEqual({ label: 'r1', ms: 3, windowTotalMs: 4.5 });
    expect(list.map((r) => r.windowMs)).toEqual([0, 0, 0]);
  });

  it('returns null when total is below the min-window floor and still resets', () => {
    const list = rows(0.3, 0.4);
    const top = takeCostWindow(list, (r) => r.label);
    expect(top).toBeNull();
    expect(list.map((r) => r.windowMs)).toEqual([0, 0]);
    expect(0.3 + 0.4).toBeLessThan(COST_WINDOW_MIN_MS);
  });

  it('returns null when nothing has any windowMs', () => {
    const list = rows(0, 0, 0);
    expect(takeCostWindow(list, (r) => r.label)).toBeNull();
  });

  it('consumes a one-shot Map.values() iterator', () => {
    const map = new Map<string, Row>([
      ['a', { label: 'a', windowMs: 2 }],
      ['b', { label: 'b', windowMs: 5 }],
    ]);
    const top = takeCostWindow(map.values(), (r) => r.label);
    expect(top).toEqual({ label: 'b', ms: 5, windowTotalMs: 7 });
    for (const r of map.values()) expect(r.windowMs).toBe(0);
  });
});

describe('formatTopShare', () => {
  it('rounds the share to a whole percent', () => {
    expect(formatTopShare({ label: 'x', ms: 1, windowTotalMs: 3 })).toBe('top x 33%');
    expect(formatTopShare({ label: 'y', ms: 2, windowTotalMs: 2 })).toBe('top y 100%');
  });

  it('returns null for null input', () => {
    expect(formatTopShare(null)).toBeNull();
  });
});
