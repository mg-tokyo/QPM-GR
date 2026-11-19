import { describe, expect, it, vi } from 'vitest';
import type { PushRules } from '../../catalogs/logic/pushRulesCatalog';
import type { ShopCatalogKind } from '../../catalogs/shopEligibility';
import { mapNightStages, mapPinsToTopics, parseSubscriptionList, planPushSync, topicKey } from './phonePushPlan';
import type { PinLookup, PushTopic } from './phonePushPlan';
import type { PhonePushDeps } from './phonePushSync';

vi.mock('../../core/pageContext', () => ({ pageWindow: {} }));
vi.mock('../../core/playerContext', () => ({ getPlayerIdSync: () => null }));
vi.mock('../../catalogs/catalogLoader/ownership', () => ({ getRoomApiBase: async () => null }));
vi.mock('../../catalogs/logic/pushRulesCatalog', () => ({ loadPushRules: async () => null }));
vi.mock('../../catalogs/shopEligibility', () => ({ getItemEligibleShops: () => [], getShopFacingCatalogEntry: () => null }));
vi.mock('../../services/authFetch', () => ({ buildAuthHeaders: () => ({}), buildTimeoutSignal: () => undefined }));
vi.mock('../../store/restockTracked', () => ({ loadTrackedSet: () => new Set() }));
vi.mock('../../utils/restock/dataService', () => ({ canonicalItemId: (_s: string, id: string) => id }));
vi.mock('../../utils/storage', () => ({ storage: { get: () => null, set: () => undefined } }));
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => undefined }) }));

// Shape of QPM_DEBUG_API.pushRules() on live build 2082 (ALR-8.2a proof), trimmed.
const RULES: PushRules = {
  chunk: 'villageDirectory-_CKNQ4JI.js',
  silentShops: ['spooky'],
  shopTopics: [
    { subject: 'QuinoaSeedInStock', itemType: 'Seed', onlyIds: null, excludeIds: [], usesSilentShops: true, readable: true },
    { subject: 'QuinoaEggInStock', itemType: 'Egg', onlyIds: null, excludeIds: [], usesSilentShops: true, readable: true },
    { subject: 'QuinoaToolInStock', itemType: 'Tool', onlyIds: ['FrozenPotion', 'XPShard'], excludeIds: [], usesSilentShops: true, readable: true },
    { subject: 'QuinoaDecorInStock', itemType: 'Decor', onlyIds: null, excludeIds: ['PetHutch'], usesSilentShops: true, readable: true },
  ],
  listTopics: [
    { subject: 'QuinoaWeatherActive', ids: ['Rain', 'Frost', 'AmberMoon'] },
    { subject: 'QuinoaDayNightPhase', ids: ['sunset', 'midnight', 'sunrise'] },
  ],
};

// literal-list-justified: test fixture standing in for the catalogs
const KINDS: Record<string, ShopCatalogKind> = {
  Carrot: 'plant', Moonbinder: 'plant', MythicalEgg: 'egg', FrozenPotion: 'item', Shovel: 'item',
  PetHutch: 'decor', StoneBench: 'decor', Pumpkin: 'plant',
};
// literal-list-justified: test fixture standing in for the catalogs
const SHOPS: Record<string, string[]> = { Carrot: ['seed'], Moonbinder: ['amber'], Pumpkin: ['spooky'], MythicalEgg: ['egg'] };

const LOOKUP: PinLookup = {
  canonical: (_shop, id) => (id === 'carrot' ? 'Carrot' : id),
  kindOf: (id) => KINDS[id] ?? null,
  eligibleShops: (id) => SHOPS[id] ?? ['shop'],
};

const carrot: PushTopic = { subject: 'QuinoaSeedInStock', itemId: 'Carrot' };
const egg: PushTopic = { subject: 'QuinoaEggInStock', itemId: 'MythicalEgg' };
const daily: PushTopic = { subject: 'QuinoaDailyQuestsReady', itemId: 'daily' };
const bamboo: PushTopic = { subject: 'QuinoaSeedInStock', itemId: 'Bamboo' };

describe('mapPinsToTopics (ALR-8.2b)', () => {
  it('maps each catalog kind to its shop subject and dedupes alias pins', () => {
    const { topics, skipped } = mapPinsToTopics(['seed:Carrot', 'seed:carrot', 'egg:MythicalEgg', 'tool:FrozenPotion', 'decor:StoneBench'], RULES, LOOKUP);
    expect(topics).toEqual([
      carrot,
      egg,
      { subject: 'QuinoaToolInStock', itemId: 'FrozenPotion' },
      { subject: 'QuinoaDecorInStock', itemId: 'StoneBench' },
    ]);
    expect(skipped).toEqual([]);
  });

  it('maps weather-shop pins by the item kind, not the shop', () => {
    expect(mapPinsToTopics(['amber:Moonbinder'], RULES, LOOKUP).topics).toEqual([{ subject: 'QuinoaSeedInStock', itemId: 'Moonbinder' }]);
  });

  it('skips what the game never offers: tool outside the list, excluded decor, silent-shop-only, unknown', () => {
    const { topics, skipped } = mapPinsToTopics(['tool:Shovel', 'decor:PetHutch', 'spooky:Pumpkin', 'seed:Nope', 'junk'], RULES, LOOKUP);
    expect(topics).toEqual([]);
    expect(skipped).toEqual([
      { pin: 'tool:Shovel', reason: 'not-offered' },
      { pin: 'decor:PetHutch', reason: 'not-offered' },
      { pin: 'spooky:Pumpkin', reason: 'not-offered' },
      { pin: 'seed:Nope', reason: 'unknown-item' },
      { pin: 'junk', reason: 'unknown-item' },
    ]);
  });

  it('maps weather pins case-insensitively to the game id; unknown weather is not offered', () => {
    const { topics, skipped } = mapPinsToTopics(['weather:amberMoon', 'weather:Snow'], RULES, LOOKUP);
    expect(topics).toEqual([{ subject: 'QuinoaWeatherActive', itemId: 'AmberMoon' }]);
    expect(skipped).toEqual([{ pin: 'weather:Snow', reason: 'not-offered' }]);
  });

  it('skips every pin of a topic whose rules did not resolve, never guessing', () => {
    const broken: PushRules = {
      ...RULES,
      shopTopics: RULES.shopTopics.map((t) => (t.itemType === 'Tool' ? { ...t, onlyIds: null, readable: false } : t)),
      listTopics: [{ subject: 'QuinoaWeatherActive', ids: null }],
    };
    const { topics, skipped } = mapPinsToTopics(['tool:FrozenPotion', 'weather:Rain', 'seed:Carrot'], broken, LOOKUP);
    expect(topics).toEqual([carrot]);
    expect(skipped.map((s) => s.reason)).toEqual(['rules-unreadable', 'rules-unreadable']);
  });

  it('keeps night stages the game lists and skips the rest', () => {
    expect(mapNightStages(['sunset', 'day', 'sunset'], RULES)).toEqual({
      topics: [{ subject: 'QuinoaDayNightPhase', itemId: 'sunset' }],
      skipped: [{ pin: 'night:day', reason: 'not-offered' }],
    });
  });
});

describe('planPushSync', () => {
  it('adds missing, removes only QPM-made, never touches app-made entries', () => {
    expect(planPushSync([carrot, egg], [egg, daily, bamboo], new Set([topicKey(bamboo)]))).toEqual({ add: [carrot], remove: [bamboo], unchanged: 1 });
  });

  it('an app-made entry that is no longer pinned stays', () => {
    expect(planPushSync([], [daily, egg], new Set()).remove).toEqual([]);
  });

  it('reads the game response shape and drops malformed rows', () => {
    expect(parseSubscriptionList({ subscriptions: [{ subject: 'A', itemId: 'b' }, { subject: 1 }, null] })).toEqual([{ subject: 'A', itemId: 'b' }]);
    expect(parseSubscriptionList([])).toBeNull();
    expect(parseSubscriptionList(null)).toBeNull();
  });
});

type Call = { url: string; method: string; body: unknown };

function harness(server: PushTopic[], made: string[], statuses: number[] = []) {
  const calls: Call[] = [];
  const store: Record<string, string[]> = { p1: made };
  let post = 0;
  const deps: PhonePushDeps = {
    loadRules: async () => RULES,
    playerId: () => 'p1',
    apiBase: async () => 'https://x/version/2082/api/rooms/ZZZ',
    fetch: async (url, init) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
      if (method === 'GET') return new Response(JSON.stringify({ subscriptions: server }), { status: 200 });
      const status = statuses[post++] ?? 200;
      return new Response('{}', { status });
    },
    pins: () => ['seed:Carrot', 'egg:MythicalEgg'],
    lookup: LOOKUP,
    readMade: (id) => store[id] ?? [],
    writeMade: (id, keys) => { store[id] = keys; },
    wait: async () => undefined,
  };
  return { deps, calls, store };
}

describe('runPhonePushSync', () => {
  it('dry run reads the list once and sends nothing', async () => {
    const { runPhonePushSync } = await import('./phonePushSync');
    const h = harness([daily, bamboo], [topicKey(bamboo)]);
    const r = await runPhonePushSync({ dryRun: true }, h.deps);
    expect(h.calls.map((c) => c.method)).toEqual(['GET']);
    expect(h.calls[0]?.url).toBe('https://x/version/2082/api/rooms/ZZZ/notifications/subscriptions');
    expect(r).toMatchObject({ ok: true, dryRun: true, added: [], pending: { add: [carrot, egg], remove: [bamboo] } });
    expect(h.store.p1).toEqual([topicKey(bamboo)]);
  });

  it('adds, removes QPM-made, records what it made, leaves app entries', async () => {
    const { runPhonePushSync } = await import('./phonePushSync');
    const h = harness([daily, bamboo], [topicKey(bamboo)]);
    const r = await runPhonePushSync({}, h.deps);
    expect(h.calls.slice(1).map((c) => [c.url.split('/').pop(), c.body])).toEqual([
      ['subscribe', carrot], ['subscribe', egg], ['unsubscribe', bamboo],
    ]);
    expect(r).toMatchObject({ ok: true, added: [carrot, egg], removed: [bamboo], pending: { add: [], remove: [] } });
    expect(new Set(h.store.p1)).toEqual(new Set([topicKey(carrot), topicKey(egg)]));
  });

  it('stops on 409 without retrying and keeps the record of what went through', async () => {
    const { runPhonePushSync } = await import('./phonePushSync');
    const h = harness([], [], [200, 409]);
    const r = await runPhonePushSync({}, h.deps);
    expect(h.calls).toHaveLength(3);
    expect(r).toMatchObject({ ok: false, error: 'version-expired', added: [carrot], failed: { action: 'subscribe', topic: egg, status: 409 }, pending: { add: [egg] } });
    expect(h.store.p1).toEqual([topicKey(carrot)]);
  });

  it('stops on the first other error', async () => {
    const { runPhonePushSync } = await import('./phonePushSync');
    const h = harness([], [], [500]);
    const r = await runPhonePushSync({}, h.deps);
    expect(h.calls).toHaveLength(2);
    expect(r).toMatchObject({ ok: false, error: 'request-failed', added: [], failed: { status: 500 } });
  });

  it('forgets a QPM-made entry the player removed in the app', async () => {
    const { runPhonePushSync } = await import('./phonePushSync');
    const h = harness([carrot, egg], [topicKey(bamboo), topicKey(carrot)]);
    const r = await runPhonePushSync({}, h.deps);
    expect(r).toMatchObject({ ok: true, added: [], removed: [], unchanged: 2 });
    expect(h.store.p1).toEqual([topicKey(carrot)]);
  });

  it('a failed list read sends nothing', async () => {
    const { runPhonePushSync } = await import('./phonePushSync');
    const h = harness([], []);
    h.deps.fetch = async () => new Response('', { status: 409 });
    const r = await runPhonePushSync({}, h.deps);
    expect(r).toMatchObject({ ok: false, error: 'version-expired', failed: { action: 'list', status: 409 } });
  });
});
