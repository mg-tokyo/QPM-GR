import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../ui/hub', () => ({ getHubGroups: () => [] }));

const { buildWindowActions, cardOpenAction } = await import('./windows');
import type { CardConfig, HubGroupDef } from '../../../ui/hub';

const icon = { kind: 'emoji', value: '' } as const;
const base = { label: 'L', description: 'D', icon };
const noop = (): void => undefined;

const launcher = (key: string, onOpen: () => void, opensExternal?: boolean): CardConfig => ({
  ...base, key, tier: 'launcher', renderSummary: noop, onOpen, ...(opensExternal ? { opensExternal } : {}),
});
const expandable = (key: string, onDetach?: () => void): CardConfig => ({
  ...base, key, tier: 'expandable', renderSummary: noop, renderExpanded: noop, ...(onDetach ? { onDetach } : {}),
});
const toggle = (key: string): CardConfig => ({ ...base, key, tier: 'inline-toggle', getEnabled: () => false, setEnabled: noop });
const group = (cards: CardConfig[]): HubGroupDef => ({ id: 'tools', label: 'G', icon, cards });

describe('cardOpenAction (PD1: a key does what the card does)', () => {
  it('uses the launcher open and the expandable detach', () => {
    const open = vi.fn();
    const detach = vi.fn();
    expect(cardOpenAction(launcher('a', open))).toBe(open);
    expect(cardOpenAction(expandable('b', detach))).toBe(detach);
  });
  it('leaves out website cards, settings-only cards and toggles', () => {
    expect(cardOpenAction(launcher('web', noop, true))).toBeNull();
    expect(cardOpenAction(expandable('settings'))).toBeNull();
    expect(cardOpenAction(toggle('t'))).toBeNull();
  });
});

describe('buildWindowActions', () => {
  it('one action per window card in panel order, ids from the card key, first card wins a duplicate key', () => {
    const groups = [
      group([launcher('stats', noop), expandable('settings'), launcher('web', noop, true)]),
      group([expandable('xp', noop), launcher('stats', noop)]),
    ];
    const actions = buildWindowActions(groups);
    expect(actions.map(a => a.id)).toEqual(['window:stats', 'window:xp']);
    expect(actions.every(a => a.section === 'windows')).toBe(true);
  });
  it('runs the card action and reports its throw', async () => {
    const open = vi.fn();
    const [ok] = buildWindowActions([group([launcher('stats', open)])]);
    await ok?.run();
    expect(open).toHaveBeenCalledTimes(1);
    const [bad] = buildWindowActions([group([launcher('x', () => { throw new Error('boom'); })])]);
    await expect(bad?.run()).rejects.toThrow('boom');
  });
  it('is empty before the panel registers its groups', () => {
    expect(buildWindowActions()).toEqual([]);
  });
});
