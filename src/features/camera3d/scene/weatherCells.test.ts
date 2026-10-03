import { describe, expect, it } from 'vitest';
import { bucketCells, claimSlots, nextPhases, parseCellHash, phaseOf, stormCells, strikeFrame, weatherBlend, weatherModeOf } from './weatherCells';

// Live game VS excerpt (build 1381, weather-pattern-pass-vertex).
const LIVE_HASH = 'float hashCell(vec2 cell) {\n  float n =\n    sin(dot(cell, vec2(12.9898, 78.233))) *\n    43758.5453;\n\n  return fract(abs(n));\n}\n';
const H = { kx: 12.9898, ky: 78.233, scale: 43758.5453 };

describe('weatherModeOf', () => {
  it('stands rain and frost, bolts the storm, keeps everything else flat', () => {
    expect(weatherModeOf('weather/RainAnimation')).toBe('stand');
    expect(weatherModeOf('weather/FrostAnimation')).toBe('stand');
    expect(weatherModeOf('weather/ThunderstormAnimation')).toBe('bolts');
    expect(weatherModeOf('weather/DawnAnimation')).toBe('flat');
    expect(weatherModeOf('weather/SomethingNew')).toBe('flat');
    expect(weatherModeOf(null)).toBe('flat');
  });
});

describe('parseCellHash', () => {
  it('reads the constants from the game shader', () => { expect(parseCellHash(LIVE_HASH)).toEqual(H); });
  it('returns null when the hash changed shape', () => { expect(parseCellHash('float hashCell(vec2 c) { return fract(c.x); }')).toBeNull(); });
});

describe('phaseOf', () => {
  it('matches the game CPU formula and stays in range', () => {
    const pts: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [3, 7], [50, 10], [100, 59]];
    expect(pts.map(([x, y]) => phaseOf(H, x, y, 50))).toEqual([0, 46, 9, 27, 12, 31]);
  });
});

describe('strikeFrame (storm: 9 frames, 50 phases, 9 + 1300 rest slots)', () => {
  it('shows frames 0..7 and rests on the last frame', () => {
    expect(strikeFrame(0, 0, 50, 1309, 9)).toBe(0);
    expect(strikeFrame(5, 0, 50, 1309, 9)).toBe(5);
    expect(strikeFrame(8, 0, 50, 1309, 9)).toBe(-1);
    expect(strikeFrame(1308, 0, 50, 1309, 9)).toBe(-1);
  });
  it('offsets each phase bucket and wraps the cycle', () => {
    expect(strikeFrame(0, 1, 50, 1309, 9)).toBe(-1);
    expect(strikeFrame(1283, 1, 50, 1309, 9)).toBe(0);
    expect(strikeFrame(1290, 1, 50, 1309, 9)).toBe(7);
  });
  it('is inert on a cleared pass', () => {
    expect(strikeFrame(3, 0, 1, 1, 1)).toBe(-1);
    expect(strikeFrame(3, 0, 0, 0, 9)).toBe(-1);
  });
});

describe('weatherBlend', () => {
  // Review Focus 6: straight down every mode must be the exact 2D pattern (s = 0 handoff in any weather).
  it('draws the exact 2D pattern for every mode straight down', () => {
    for (const mode of ['flat', 'stand', 'bolts'] as const) {
      expect(weatherBlend(mode, 0, true)).toEqual({ stand: 0, flatAlpha: 1, boltAlpha: 0, overWorld: true });
    }
  });
  it('stands rain over World and hands the storm to the bolts below 60°', () => {
    expect(weatherBlend('stand', 1, false)).toEqual({ stand: 1, flatAlpha: 1, boltAlpha: 0, overWorld: true });
    expect(weatherBlend('bolts', 1, false)).toEqual({ stand: 0, flatAlpha: 0, boltAlpha: 1, overWorld: false });
    expect(weatherBlend('flat', 1, false)).toEqual({ stand: 0, flatAlpha: 1, boltAlpha: 0, overWorld: false });
  });
  it('cross-fades the storm halfway through the tilt', () => {
    expect(weatherBlend('bolts', 0.5, false)).toEqual({ stand: 0, flatAlpha: 0.5, boltAlpha: 0.5, overWorld: false });
  });
});

describe('stormCells / bucketCells', () => {
  it('stands each cell on its foot row and groups by phase within the radius', () => {
    const aCell = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0]); // cells (0,0) and (1,0), 4 vertices each
    const cells = stormCells(aCell, 256, 1413, 1279, (x, y) => phaseOf(H, x, y, 50));
    expect(cells).toEqual([{ gx: 128, gy: 1279, phase: 0 }, { gx: 384, gy: 1279, phase: 46 }]);
    const b = bucketCells(cells, 128, 1279, 200, 50);
    expect(b.length).toBe(50);
    expect(b[0]).toEqual([cells[0]]);
    expect(b[46]).toEqual([]);
  });
});

describe('claimSlots', () => {
  const none = (): string[][] => [];
  it('keeps a strike in its slot while an earlier strike ends, and frees idle slots only when it must re-key', () => {
    const owners: Array<string | null> = [null, null, null];
    const slots: number[] = [];
    expect(claimSlots(owners, ['A', 'B'], slots, none, false)).toBe(0);
    expect(slots).toEqual([0, 1]);
    claimSlots(owners, ['B'], slots, none, false);
    expect(slots).toEqual([1]);
    expect(owners).toEqual(['A', 'B', null]);
    claimSlots(owners, ['C', 'B'], slots, none, false);
    expect(slots).toEqual([0, 1]);
    expect(owners).toEqual(['C', 'B', null]);
  });
  it('drops strikes beyond the pool', () => {
    const owners: Array<string | null> = [null];
    const slots: number[] = [];
    expect(claimSlots(owners, ['A', 'B'], slots, none, false)).toBe(1);
    expect(slots).toEqual([0, -1]);
    claimSlots(owners, [], slots, none, false);
    expect(slots).toEqual([]);
  });
  it('reserves whole upcoming groups on a re-key frame, so a reserved strike starts without one', () => {
    const owners: Array<string | null> = [null, null, null, null];
    const slots: number[] = [];
    let asked = 0;
    const upcoming = (): string[][] => { asked++; return [['B', 'C'], ['D', 'E']]; };
    claimSlots(owners, ['A'], slots, upcoming, false);
    expect(owners).toEqual(['A', 'B', 'C', null]);
    claimSlots(owners, ['B', 'C'], slots, upcoming, false);
    expect(slots).toEqual([1, 2]);
    expect(asked).toBe(1);
    claimSlots(owners, [], slots, () => [['D', 'E']], true);
    expect(owners).toEqual(['D', 'E', null, null]);
  });
});

describe('nextPhases (storm: 50 phases, 1309 slots, 9 frames)', () => {
  it('lists resting phases in the order their strikes start', () => {
    expect(nextPhases(0, 50, 1309, 9, 3)).toEqual([49, 48, 47]);
    expect(nextPhases(0, 50, 1309, 9, 100)).not.toContain(0);
    expect(nextPhases(3, 0, 0, 9, 3)).toEqual([]);
  });
});
