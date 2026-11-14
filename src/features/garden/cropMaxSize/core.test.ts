import { describe, expect, it, vi } from 'vitest';
import type { WalkedSlot } from '../slotWalk';
import type { GardenSnapshot } from '../bridge';
import type { Journal } from '../../journal/checker';

let gardenCb: ((s: GardenSnapshot) => void) | null = null;
let journal: Journal | null = null;
vi.mock('../bridge', () => ({
  onGardenSnapshot: (cb: (s: GardenSnapshot) => void) => { gardenCb = cb; return () => { gardenCb = null; }; },
}));
vi.mock('../../journal/checker', () => ({ getJournal: () => Promise.resolve(journal) }));

const { createSizeEdgeTracker, edgeQualifies } = await import('./core');
const cms = await import('./index');

const slot = (over: Partial<WalkedSlot> = {}): WalkedSlot => ({
  tileKey: 'g:1', slotId: 0, startTime: 1000, species: 'Carrot', mutations: [], size: 90, ...over,
});
const logged = (species: string): Journal => ({ produce: { [species]: { variantsLogged: [{ variant: 'Max Weight' }] } } });
const filter = { unloggedJournal: true, species: [] as string[] };

describe('crop max-size edge core (ALR-15.1)', () => {
  it('a boost taking a crop to 100 is one edge; staying at 100 is not another', () => {
    const t = createSizeEdgeTracker();
    expect(t.step([slot({ size: 96 })])).toEqual([]);
    expect(t.step([slot({ size: 100 })])).toEqual([{ tileKey: 'g:1', slotId: 0, species: 'Carrot', size: 100 }]);
    expect(t.step([slot({ size: 100 })])).toEqual([]);
  });

  it('already at 100 on the first snapshot is silent', () => {
    const t = createSizeEdgeTracker();
    expect(t.step([slot({ size: 100 })])).toEqual([]);
  });

  it('a new slot already at 100 is an edge (PD1); a replant (later startTime) at 100 is a new slot', () => {
    const t = createSizeEdgeTracker();
    t.step([slot({ size: 100 })]);
    expect(t.step([slot({ size: 100 }), slot({ tileKey: 'g:2', size: 100 })]).map((e) => e.tileKey)).toEqual(['g:2']);
    expect(t.step([slot({ startTime: 5000, size: 100 }), slot({ tileKey: 'g:2', size: 100 })]).map((e) => e.tileKey)).toEqual(['g:1']);
  });

  it('a harvested slot is dropped, watering (earlier startTime) keeps the slot, unknown size never crosses', () => {
    const t = createSizeEdgeTracker();
    t.step([slot({ size: 90 })]);
    expect(t.step([])).toEqual([]);
    expect(t.step([slot({ size: 100 })])).toHaveLength(1);
    const w = createSizeEdgeTracker();
    w.step([slot({ size: 100 })]);
    expect(w.step([slot({ startTime: 400, size: 100 })])).toEqual([]);
    const u = createSizeEdgeTracker();
    u.step([slot({ size: null })]);
    expect(u.step([slot({ size: 100 })])).toEqual([]);
  });

  it('two crops in one snapshot form one batch, boardwalk included', () => {
    const t = createSizeEdgeTracker();
    t.step([slot({ size: 99 }), slot({ tileKey: 'b:7', species: 'Tulip', size: 98 })]);
    expect(t.step([slot({ size: 100 }), slot({ tileKey: 'b:7', species: 'Tulip', size: 100 })]).map((e) => e.tileKey)).toEqual(['g:1', 'b:7']);
  });

  it('filter: picked species always; unlogged journal mode needs an unlogged Max Weight and a readable journal', () => {
    expect(edgeQualifies('Carrot', filter, { produce: {} })).toBe(true);
    expect(edgeQualifies('Carrot', filter, logged('Carrot'))).toBe(false);
    expect(edgeQualifies('Carrot', filter, null)).toBe(false);
    expect(edgeQualifies('Carrot', { unloggedJournal: false, species: ['Carrot'] }, logged('Carrot'))).toBe(true);
    expect(edgeQualifies('Tulip', { unloggedJournal: false, species: ['Carrot'] }, { produce: {} })).toBe(false);
  });
});

describe('crop max-size feed (ALR-15.1)', () => {
  const garden = (dirt: Array<[string, number]>, board: Array<[string, number]> = []): GardenSnapshot => {
    const tiles = (rows: Array<[string, number]>) => Object.fromEntries(rows.map(([species, size], i) => [
      String(i), { objectType: 'plant', slots: [{ species, startTime: 1000, size, slotId: 0 }] },
    ]));
    return { tileObjects: tiles(dirt), boardwalkTileObjects: tiles(board) } as unknown as GardenSnapshot;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('one snapshot → one batch of qualifying edges; logged species filtered out but kept in lastEdges', async () => {
    cms.startCropMaxSize();
    const batches: string[][] = [];
    const off = cms.onCropMaxSizeBatch((b) => batches.push(b.map((e) => e.species)));
    journal = logged('Tulip');
    gardenCb?.(garden([['Carrot', 99], ['Tulip', 99]], [['Beet', 99]]));
    gardenCb?.(garden([['Carrot', 100], ['Tulip', 100]], [['Beet', 100]]));
    await flush();
    expect(batches).toEqual([['Carrot', 'Beet']]);
    const recent = cms.getRecentSizeEdges();
    expect(recent.map((e) => [e.species, e.journalLogged, e.qualifies])).toEqual([['Carrot', false, true], ['Tulip', true, false], ['Beet', false, true]]);
    off();
    cms.stopCropMaxSize();
    expect(cms.getCropMaxSizeState()).toMatchObject({ running: false, steps: 0 });
    expect(gardenCb).toBeNull();
  });
});
