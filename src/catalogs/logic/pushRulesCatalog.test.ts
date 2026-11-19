import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY, INVENTORY_URL, RULES, RULES_URL, SUBSCRIBE, SUBSCRIBE_URL, TOOLS, TOOLS_URL } from './__fixtures__/pushRules';

let hit: { url: string; text: string } | null = null;
let chunks = new Map<string, string>();
const fetched: string[] = [];

vi.mock('./bundleParser', () => ({
  fetchBundleHitContaining: async () => hit,
  fetchBundleChunkText: async (url: string) => { fetched.push(url); return chunks.get(url) ?? null; },
  registerBundleConsumer: () => undefined,
  markBundleConsumerDone: () => undefined,
}));
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => undefined }) }));

beforeEach(() => {
  vi.resetModules();
  hit = { url: RULES_URL, text: RULES };
  chunks = new Map([[SUBSCRIBE_URL, SUBSCRIBE], [TOOLS_URL, TOOLS], [INVENTORY_URL, INVENTORY]]);
  fetched.length = 0;
});

describe('loadPushRules (ALR-8.2a)', () => {
  it('follows every cross-chunk name on the live 2082 shape', async () => {
    const m = await import('./pushRulesCatalog');
    const rules = await m.loadPushRules();
    expect(rules?.chunk).toBe('villageDirectory-_CKNQ4JI.js');
    expect(rules?.silentShops).toEqual(['spooky']);
    const tool = rules?.shopTopics.find((t) => t.subject === 'QuinoaToolInStock');
    expect(tool?.onlyIds).toEqual(['ChilledPotion', 'FrozenPotion', 'ReplenishPotion', 'XPPotion', 'RainWardShard', 'SnowWardShard', 'ThunderWardShard', 'HungerShard', 'XPShard', 'StrengthShard']);
    expect(rules?.shopTopics.find((t) => t.subject === 'QuinoaDecorInStock')?.excludeIds).toEqual(['FeedingTrough', 'DecorShed', 'PetHutch', 'SeedSilo', 'ToolShack']);
    expect(rules?.shopTopics.find((t) => t.subject === 'QuinoaSeedInStock')).toMatchObject({ onlyIds: null, excludeIds: [], readable: true });
    expect(rules?.listTopics).toEqual([
      { subject: 'QuinoaWeatherActive', ids: ['Rain', 'Frost', 'Thunderstorm', 'Dawn', 'AmberMoon'] },
      { subject: 'QuinoaDayNightPhase', ids: ['sunset', 'midnight', 'sunrise'] },
    ]);
    expect(rules?.shopTopics.every((t) => t.readable)).toBe(true);
    expect(m.getPushRulesStatus()).toEqual({ attempts: 1, outcome: 'resolved', chunk: 'villageDirectory-_CKNQ4JI.js' });
    expect(new Set(fetched)).toEqual(new Set([SUBSCRIBE_URL, TOOLS_URL, INVENTORY_URL]));
    expect(fetched.filter((u) => u === SUBSCRIBE_URL)).toHaveLength(1);

    await m.loadPushRules();
    expect(m.getPushRulesStatus().attempts).toBe(1);
  });

  it('a missing exporter makes only its topic unreadable, and the next call retries', async () => {
    chunks.delete(INVENTORY_URL);
    const m = await import('./pushRulesCatalog');
    const rules = await m.loadPushRules();
    const tool = rules?.shopTopics.find((t) => t.subject === 'QuinoaToolInStock');
    expect(tool).toMatchObject({ onlyIds: null, readable: false });
    expect(rules?.shopTopics.filter((t) => t.subject !== 'QuinoaToolInStock').every((t) => t.readable)).toBe(true);
    expect(m.getPushRulesStatus().outcome).toBe('partial');

    chunks.set(INVENTORY_URL, INVENTORY);
    expect((await m.loadPushRules())?.shopTopics.every((t) => t.readable)).toBe(true);
    expect(m.getPushRulesStatus()).toMatchObject({ attempts: 2, outcome: 'resolved' });
  });

  it('a missing shop enum makes every silent-shop topic unreadable', async () => {
    chunks.set(SUBSCRIBE_URL, SUBSCRIBE.replace('Qe as sr,', ''));
    const m = await import('./pushRulesCatalog');
    const rules = await m.loadPushRules();
    expect(rules?.silentShops).toBeNull();
    expect(rules?.shopTopics.some((t) => t.readable)).toBe(false);
    expect(rules?.listTopics[0]?.ids).toEqual(['Rain', 'Frost', 'Thunderstorm', 'Dawn', 'AmberMoon']);
  });

  it('marker miss → null', async () => {
    hit = null;
    const m = await import('./pushRulesCatalog');
    expect(await m.loadPushRules()).toBeNull();
    expect(m.getPushRulesStatus().outcome).toBe('marker-miss');
  });
});
