import { describe, expect, it } from 'vitest';
import { createEggSchedule, walkEggs, type EggEntry } from './schedule';
import type { GardenSnapshot } from '../bridge';

const egg = (maturedAt: number, plantedAt = 0, eggId = 'CommonEgg') =>
  ({ objectType: 'egg', eggId, plantedAt, maturedAt });

function garden(dirt: Record<string, unknown>, boardwalk: Record<string, unknown> = {}): GardenSnapshot {
  return { tileObjects: dirt, boardwalkTileObjects: boardwalk };
}

const keys = (batch: EggEntry[]): string[] => batch.map((e) => e.key);

describe('walkEggs (ALR-11.1)', () => {
  it('reads eggs from both tile maps and skips plants and malformed eggs', () => {
    const eggs = walkEggs(garden(
      { 3: egg(5_000, 100), 4: { objectType: 'plant', slots: [] }, 5: { objectType: 'egg', eggId: 'X' } },
      { 7: egg(9_000, 200, 'RareEgg') },
    ));
    expect(eggs.map((e) => [e.key, e.eggId, e.maturedAt])).toEqual([
      ['g:3|100', 'CommonEgg', 5_000],
      ['b:7|200', 'RareEgg', 9_000],
    ]);
  });
});

describe('egg schedule (ALR-11.1)', () => {
  it('an egg already ready at load is recorded silently', () => {
    const s = createEggSchedule();
    const r = s.step(walkEggs(garden({ 1: egg(1_000) })), 5_000, 0);
    expect(r).toEqual({ batch: [], nextFireAt: null });
    expect(s.entries()[0]?.state).toBe('silent');
  });

  it('one egg matures: armed for maturedAt, fires once at it', () => {
    const s = createEggSchedule();
    const g = walkEggs(garden({ 1: egg(10_000) }));
    expect(s.step(g, 1_000, 0)).toEqual({ batch: [], nextFireAt: 10_000 });
    expect(keys(s.step(g, 10_050, 0).batch)).toEqual(['g:1|0']);
    expect(s.step(g, 11_000, 0).batch).toEqual([]);
  });

  it('eggs due within the 2 s window form one batch; a later one waits', () => {
    const s = createEggSchedule();
    const g = walkEggs(garden({ 1: egg(10_000), 2: egg(11_500), 3: egg(20_000) }));
    s.step(g, 1_000, 0);
    const r = s.step(g, 10_000, 0);
    expect(keys(r.batch)).toEqual(['g:1|0', 'g:2|0']);
    expect(r.nextFireAt).toBe(20_000);
  });

  it('an earlier maturedAt (growth boost) reschedules', () => {
    const s = createEggSchedule();
    s.step(walkEggs(garden({ 1: egg(60_000) })), 1_000, 0);
    expect(s.step(walkEggs(garden({ 1: egg(30_000) })), 2_000, 0).nextFireAt).toBe(30_000);
  });

  it('a hatched egg is dropped; the same tile planted again is a new egg', () => {
    const s = createEggSchedule();
    s.step(walkEggs(garden({ 1: egg(10_000) })), 1_000, 0);
    expect(s.step(walkEggs(garden({})), 2_000, 0)).toEqual({ batch: [], nextFireAt: null });
    expect(s.entries()).toEqual([]);
    expect(s.step(walkEggs(garden({ 1: egg(50_000, 3_000) })), 3_000, 0).nextFireAt).toBe(50_000);
  });

  it('a boardwalk egg is counted', () => {
    const s = createEggSchedule();
    const g = walkEggs(garden({}, { 4: egg(10_000) }));
    s.step(g, 1_000, 0);
    expect(keys(s.step(g, 10_000, 0).batch)).toEqual(['b:4|0']);
  });

  it('the lead moves the fire time earlier; first sight inside the lead is silent', () => {
    const s = createEggSchedule();
    const g = walkEggs(garden({ 1: egg(200_000), 2: egg(100_000) }));
    const r = s.step(g, 50_000, 60_000);
    expect(r.nextFireAt).toBe(140_000);
    expect(s.entries().find((e) => e.key === 'g:2|0')?.state).toBe('silent');
    expect(keys(s.step(g, 140_000, 60_000).batch)).toEqual(['g:1|0']);
  });
});
