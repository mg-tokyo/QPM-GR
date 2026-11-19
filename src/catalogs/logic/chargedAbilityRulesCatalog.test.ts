import { beforeEach, describe, expect, it, vi } from 'vitest';

const RULES = { captures: [], chargers: [], chargerDispatchFound: true, unparsedChargers: [] };

let release: ((h: { url: string; text: string } | null) => void) | null = null;
let chunkCb: (() => void) | null = null;

vi.mock('./bundleParser', () => ({
  fetchBundleHitContaining: () => new Promise((resolve) => { release = resolve; }),
  getMarkerMissCount: () => 0,
  registerBundleConsumer: () => undefined,
  markBundleConsumerDone: () => undefined,
  onNewBundleChunk: (cb: () => void) => { chunkCb = cb; return () => { chunkCb = null; }; },
}));
vi.mock('./chargedAbilityRulesParsing', () => ({
  CHARGED_ABILITY_RULES_MARKER: 'capsulesByMutation',
  parseChargedAbilityRules: (text: string) => (text === 'rules' ? RULES : null),
}));
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => undefined }) }));

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules();
  release = null;
  chunkCb = null;
});

describe('charged-ability rules unreadable state (REL-8.3)', () => {
  it('no note while loading, note once the first load misses, gone when a later chunk resolves', async () => {
    const m = await import('./chargedAbilityRulesCatalog');
    const changed = vi.fn();
    m.onChargedAbilityRulesChange(changed);
    m.startChargedAbilityRulesSource();
    await settle();
    expect(m.areChargedAbilityRulesUnreadable()).toBe(false);

    release?.(null);
    await settle();
    expect(m.areChargedAbilityRulesUnreadable()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);

    chunkCb?.();
    await settle();
    release?.({ url: 'https://x/assets/inventoryAtoms-A.js', text: 'rules' });
    await settle();
    expect(m.areChargedAbilityRulesUnreadable()).toBe(false);
    expect(m.getChargedAbilityRules()).toEqual(RULES);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('a first load that resolves never shows the note', async () => {
    const m = await import('./chargedAbilityRulesCatalog');
    m.startChargedAbilityRulesSource();
    release?.({ url: 'a.js', text: 'rules' });
    await settle();
    expect(m.areChargedAbilityRulesUnreadable()).toBe(false);
    expect(m.getChargedAbilityRulesStatus()).toMatchObject({ settled: true, resolved: true });
  });
});
