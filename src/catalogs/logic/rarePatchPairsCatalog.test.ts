import { beforeEach, describe, expect, it, vi } from 'vitest';

const TABLE = 'var $o=[{patchSpeciesId:`Daisy`,rareCropSpeciesId:`PurpleDaisy`},{patchSpeciesId:`Foxfire`,rareCropSpeciesId:`Witchfire`}];';

let hit: { url: string; text: string } | null = null;
let chunkCb: (() => void) | null = null;
const offChunk = vi.fn(() => { chunkCb = null; });

vi.mock('./bundleParser', () => ({
  fetchBundleHitContaining: () => Promise.resolve(hit),
  getMarkerMissCount: () => 0,
  registerBundleConsumer: () => undefined,
  markBundleConsumerDone: () => undefined,
  onNewBundleChunk: (cb: () => void) => { chunkCb = cb; return offChunk; },
}));
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => undefined }) }));

type Mod = typeof import('./rarePatchPairsCatalog');
const load = async (): Promise<Mod> => import('./rarePatchPairsCatalog');
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const REFERENCE = { Daisy: 'PurpleDaisy', Clover: 'FourLeafClover' };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  hit = null;
  chunkCb = null;
});

describe('rarePatchPairsCatalog (ALR-16.2)', () => {
  it('null until a chunk carries the table; the next chunk resolves it once and releases the retry', async () => {
    const m = await load();
    const changed = vi.fn();
    m.onRarePatchPairsChange(changed);
    m.startRarePatchPairsSource();
    await settle();
    expect(m.getRarePatchPairs()).toBeNull();
    expect(m.getRarePatchPairsDrift(REFERENCE)).toMatchObject({ resolved: false, count: 0, notInReference: [], referenceNotInBundle: [], chunkRetryActive: true });

    hit = { url: 'https://x/version/2036/assets/inventoryAtoms-DNE6rlLK.js', text: TABLE };
    chunkCb?.();
    await settle();
    expect(m.getRarePatchPairs()).toEqual([{ patch: 'Daisy', rare: 'PurpleDaisy' }, { patch: 'Foxfire', rare: 'Witchfire' }]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(offChunk).toHaveBeenCalledTimes(1);
    expect(m.getRarePatchPairsDrift(REFERENCE)).toMatchObject({
      resolved: true, chunk: 'inventoryAtoms-DNE6rlLK.js', count: 2, attempts: 2, parseFailures: 0,
      notInReference: ['Foxfire→Witchfire'], referenceNotInBundle: ['Clover→FourLeafClover'], chunkRetryActive: false,
    });
  });

  it('a hit that does not parse counts a failure and keeps the retry', async () => {
    hit = { url: 'a.js', text: '[{patchSpeciesId:`Daisy`}]' };
    const m = await load();
    m.startRarePatchPairsSource();
    await settle();
    expect(m.getRarePatchPairs()).toBeNull();
    expect(m.getRarePatchPairsDrift(REFERENCE)).toMatchObject({ parseFailures: 1, chunkRetryActive: true });
    m.stopRarePatchPairsSource();
    expect(offChunk).toHaveBeenCalledTimes(1);
    expect(m.getRarePatchPairsDrift(REFERENCE)).toMatchObject({ started: false, chunkRetryActive: false });
  });
});
