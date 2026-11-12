import { beforeEach, describe, expect, it, vi } from 'vitest';

const CYCLE = 'var Ae={day:210,sunset:10,midnight:10,sunrise:10},je=Object.values(Ae).reduce((e,t)=>e+t,0)';
const BONUS = 'var F={day:0,sunset:15,midnight:20,sunrise:10};F.midnight;function I(e){return M[e].isNocturnal===!0}';
const CAP = 'var ct=.99;function lt(e){return Number.isNaN(e)?0:Math.min(1,Math.max(0,e))}function ut(e){return Math.min(ct,lt(e))}';
const CRYSTAL = 'function dt(e){let t=new Set;for(let{crystal:n}of ct(e))n.remainingActiveSeconds>0&&t.add(n.crystalType);return{strengthBonus:t.has(`Strength`)?10:0}}';

let chunks: string[] = [];
let chunkCb: (() => void) | null = null;
let stageCb: ((v: string | null) => void) | null = null;
let gameStateReady = true;
const fetchBundleContaining = vi.fn(async (marker: RegExp) => chunks.find((t) => marker.test(t)) ?? null);
const offChunk = vi.fn(() => { chunkCb = null; });
const offStage = vi.fn(() => { stageCb = null; });
const registerBundleConsumer = vi.fn();
const markBundleConsumerDone = vi.fn();

vi.mock('./bundleParser', () => ({
  fetchBundleContaining: (m: RegExp) => fetchBundleContaining(m),
  getMarkerMissCount: () => 0,
  registerBundleConsumer: (n: string) => registerBundleConsumer(n),
  markBundleConsumerDone: (n: string) => markBundleConsumerDone(n),
  onNewBundleChunk: (cb: () => void) => { chunkCb = cb; return offChunk; },
}));
vi.mock('../../core/gameState', () => ({
  isGameStateReady: () => gameStateReady,
  subscribe: (_key: string, cb: (v: string | null) => void) => { stageCb = cb; return offStage; },
}));
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => {} }) }));

type Mod = typeof import('./dayCycleCatalog');
const load = async (): Promise<Mod> => import('./dayCycleCatalog');
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  chunks = [];
  chunkCb = null;
  stageCb = null;
  gameStateReady = true;
});

describe('dayCycleCatalog', () => {
  it('resolves every part from loaded chunks and releases the chunk retry', async () => {
    chunks = [CYCLE, BONUS, CAP, CRYSTAL];
    const m = await load();
    const changed = vi.fn();
    m.onDayCycleChange(changed);
    m.startDayCycleSource();
    await settle();
    expect(m.getDayCycle()).toEqual({
      stages: [{ id: 'day', minutes: 210 }, { id: 'sunset', minutes: 10 }, { id: 'midnight', minutes: 10 }, { id: 'sunrise', minutes: 10 }],
      nocturnalBonus: { day: 0, sunset: 15, midnight: 20, sunrise: 10 },
      chanceCapPerMinute: 0.99,
      crystalModifiers: { strengthBonus: { crystalType: 'Strength', active: 10, inactive: 0 } },
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(offChunk).toHaveBeenCalledTimes(1);
    expect(m.getDayCycleSourceStatus().chunkRetryActive).toBe(false);
    expect(registerBundleConsumer).toHaveBeenCalledWith('day-cycle');
    expect(markBundleConsumerDone).toHaveBeenCalledTimes(registerBundleConsumer.mock.calls.length);
  });

  it('keeps missing parts null and retries them on the next chunk only', async () => {
    chunks = [CYCLE, BONUS, CRYSTAL];
    const m = await load();
    m.startDayCycleSource();
    await settle();
    expect(m.getDayCycle().chanceCapPerMinute).toBeNull();
    expect(m.getDayCycle().stages).not.toBeNull();
    expect(m.getDayCycleSourceStatus().chunkRetryActive).toBe(true);
    fetchBundleContaining.mockClear();
    chunks.push(CAP);
    chunkCb?.();
    await settle();
    expect(fetchBundleContaining).toHaveBeenCalledTimes(1);
    expect(m.getDayCycle().chanceCapPerMinute).toBe(0.99);
    expect(m.getDayCycleSourceStatus()).toMatchObject({ complete: true, chunkRetryActive: false });
  });

  it('dedupes in-flight work and reruns once for a chunk that lands mid-scan', async () => {
    const m = await load();
    m.startDayCycleSource();
    m.startDayCycleSource();
    chunkCb?.();
    chunkCb?.();
    await settle();
    expect(fetchBundleContaining).toHaveBeenCalledTimes(8);
    expect(m.getDayCycleSourceStatus().parts.cycle.attempts).toBe(2);
  });

  it('counts a marker hit that fails to parse', async () => {
    chunks = [CYCLE.replace('day:210,sunset:10,midnight:10,sunrise:10', 'day:0'), BONUS, CAP, CRYSTAL];
    const m = await load();
    m.startDayCycleSource();
    await settle();
    expect(m.getDayCycleSourceStatus().parts.cycle).toMatchObject({ resolved: false, parseFailures: 1 });
  });

  it('releases the chunk retry and the stage watch on stop, and restarts cleanly', async () => {
    const m = await load();
    m.startDayCycleSource();
    await settle();
    expect(m.getDayCycleSourceStatus()).toMatchObject({ started: true, chunkRetryActive: true, stageWatchActive: true });
    m.stopDayCycleSource();
    m.stopDayCycleSource();
    expect(offChunk).toHaveBeenCalledTimes(1);
    expect(offStage).toHaveBeenCalledTimes(1);
    expect(m.getDayCycleSourceStatus()).toMatchObject({ started: false, chunkRetryActive: false, stageWatchActive: false });
    m.startDayCycleSource();
    expect(m.getDayCycleSourceStatus()).toMatchObject({ started: true, chunkRetryActive: true, stageWatchActive: true });
    m.stopDayCycleSource();
  });

  it('records stage values from the key, and skips the watch before game state exists', async () => {
    const m = await load();
    m.startDayCycleSource();
    stageCb?.('sunrise');
    stageCb?.('eclipse');
    stageCb?.(null);
    expect(m.getDayCycleSourceStatus().stagesSeen).toEqual(['sunrise', 'eclipse']);
    m.stopDayCycleSource();
    gameStateReady = false;
    m.startDayCycleSource();
    expect(m.getDayCycleSourceStatus().stageWatchActive).toBe(false);
    m.stopDayCycleSource();
  });
});
