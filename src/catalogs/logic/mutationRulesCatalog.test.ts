import { beforeEach, describe, expect, it, vi } from 'vitest';

const SWITCH = 'function no(e,t,n){let r=W[t].group;return e.some(e=>W[e].group===r&&n?.includes(e)!==!0)}function ro(e,t){if(t.includes(e))return;let n=[...t];switch(e){case`Rainbow`:case`Gold`:if(no(t,e))return;n.push(e);break;case`Frozen`:if(no(t,e,[`Wet`,`Chilled`]))return;n=n.filter(e=>W[e].group!==`Hydro`),n.push(`Frozen`);break;case`Eclipse`:n.unshift(e);break;default:return e}return n}';

let hit: { url: string; text: string } | null = null;
let chunkCb: (() => void) | null = null;
const fetchHit = vi.fn(async () => hit);
const offChunk = vi.fn(() => { chunkCb = null; });
const registerBundleConsumer = vi.fn();
const markBundleConsumerDone = vi.fn();

vi.mock('./bundleParser', () => ({
  fetchBundleHitContaining: () => fetchHit(),
  getMarkerMissCount: () => 0,
  registerBundleConsumer: (n: string) => registerBundleConsumer(n),
  markBundleConsumerDone: (n: string) => markBundleConsumerDone(n),
  onNewBundleChunk: (cb: () => void) => { chunkCb = cb; return offChunk; },
}));
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => {} }) }));

type Mod = typeof import('./mutationRulesCatalog');
const load = async (): Promise<Mod> => import('./mutationRulesCatalog');
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

const CATALOG = {
  Gold: { group: 'Growth' }, Rainbow: { group: 'Growth' }, Frozen: { group: 'Hydro' }, Wet: { group: 'Hydro' }, Mystery: {},
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  hit = null;
  chunkCb = null;
});

describe('mutationRulesCatalog', () => {
  it('reports the group-only fallback until a chunk parses, then resolves once and releases the retry', async () => {
    const m = await load();
    const changed = vi.fn();
    m.onMutationRulesChange(changed);
    m.startMutationRulesSource();
    await settle();
    expect(m.getMutationRule('Gold')).toBeNull();
    expect(m.getMutationRulesDrift(CATALOG)).toMatchObject({ resolved: false, fallback: 'group-only', chunkRetryActive: true, catalogIdsWithoutCase: [] });

    hit = { url: 'https://magicgarden.gg/version/2022/assets/inventoryAtoms-CaOrtw-I.js', text: SWITCH };
    chunkCb?.();
    await settle();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(offChunk).toHaveBeenCalledTimes(1);
    expect(m.getMutationRule('Frozen')).toMatchObject({ clearsGroup: 'Hydro', mayReplace: ['Wet', 'Chilled'] });
    expect(m.getMutationRulesDrift(CATALOG)).toEqual({
      started: true, resolved: true, chunk: 'inventoryAtoms-CaOrtw-I.js', attempts: 2, parseFailures: 0, markerMisses: 0, chunkRetryActive: false,
      parsedIds: ['Rainbow', 'Gold', 'Frozen'],
      unparsedCases: ['Eclipse'],
      catalogIdsWithoutCase: ['Wet', 'Mystery'],
      caseIdsNotInCatalog: ['Eclipse'],
      catalogIdsWithoutGroup: ['Mystery'],
      groups: { Gold: 'Growth', Rainbow: 'Growth', Frozen: 'Hydro', Wet: 'Hydro' },
      fallback: null,
    });
    expect(markBundleConsumerDone).toHaveBeenCalledTimes(registerBundleConsumer.mock.calls.length);
  });

  it('counts a marker hit that fails to parse and keeps retrying', async () => {
    hit = { url: 'x/a.js', text: SWITCH.replace('default:', 'dflt:') };
    const m = await load();
    m.startMutationRulesSource();
    await settle();
    expect(m.getMutationRulesStatus()).toMatchObject({ resolved: false, parseFailures: 1, chunkRetryActive: true });
  });

  it('stop releases the chunk retry; start is idempotent', async () => {
    const m = await load();
    m.startMutationRulesSource();
    m.startMutationRulesSource();
    await settle();
    expect(fetchHit).toHaveBeenCalledTimes(1);
    m.stopMutationRulesSource();
    m.stopMutationRulesSource();
    expect(offChunk).toHaveBeenCalledTimes(1);
    expect(m.getMutationRulesStatus()).toMatchObject({ started: false, chunkRetryActive: false });
  });

  it('drift without a catalog lists nothing against it', async () => {
    const m = await load();
    expect(m.getMutationRulesDrift(null)).toMatchObject({ catalogIdsWithoutCase: [], caseIdsNotInCatalog: [], catalogIdsWithoutGroup: [], groups: {} });
  });
});
