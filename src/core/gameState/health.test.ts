import { describe, expect, it } from 'vitest';
import { buildGameStateHealth, renderGameStateTable } from './health';
import type { KeyExplain } from './types';

const ex = (key: string, boundVia: KeyExplain['boundVia'], preferred: boolean): KeyExplain => ({
  key, policy: 'authoritative', doc: '', boundVia, boundIndex: boundVia ? (preferred ? 0 : 1) : null,
  boundDescription: boundVia ? `${boundVia}:x` : null, boundAt: 5, preferred, rebinds: 1, subscribers: 2, lastDeliveryAt: 9, sources: [],
});

describe('gameState health', () => {
  it('is ok when every key is bound to its preferred rung', () => {
    const h = buildGameStateHealth({
      stats: () => ({ keys: 2, bound: 2, preferred: 2, unbound: [], fallback: [], lastReasons: [] }),
      explainAll: () => [ex('a', 'stateTree', true), ex('b', 'atom', true)],
    }, []);
    expect(h.status).toBe('ok');
    expect(h.metrics).toMatchObject({ keys: 2, viaStateTree: 1, viaAtom: 1, unbound: 0, fallbackBound: 0, divergent: 0 });
  });
  it('degrades and names fallback / unbound / divergent keys', () => {
    const h = buildGameStateHealth({
      stats: () => ({ keys: 3, bound: 2, preferred: 1, unbound: ['c'], fallback: ['b'], lastReasons: [] }),
      explainAll: () => [ex('a', 'stateTree', true), ex('b', 'atom', false), ex('c', null, false)],
    }, ['a']);
    expect(h.status).toBe('degraded');
    expect(h.message).toContain('b via atom');
    expect(h.message).toContain('c unbound');
    expect(h.message).toContain('divergent: a');
  });
  it('renders one aligned line per key', () => {
    const lines = renderGameStateTable([ex('coins', 'stateTree', true)]);
    expect(lines[0]).toMatch(/^coins\s+stateTree:x\s+preferred\s+subs=2\s+rebinds=1/);
  });

  it('swaps the "degraded" wording for a spectator-aware message when isSpectating is true', () => {
    const h = buildGameStateHealth({
      stats: () => ({ keys: 5, bound: 2, preferred: 2, unbound: ['c'], fallback: ['b', 'd'], lastReasons: [] }),
      explainAll: () => [
        ex('a', 'stateTree', true),
        ex('b', 'atom', false),
        ex('c', null, false),
        ex('d', 'atom', false),
        ex('e', 'stateTree', true),
      ],
    }, [], true);
    expect(h.status).toBe('degraded');
    expect(h.message).toBe('no seat: spectating — 3 key(s) awaiting seat');
    expect(h.message).not.toContain('degraded:');
  });

  it('keeps the "degraded" wording when isSpectating is false (default)', () => {
    const h = buildGameStateHealth({
      stats: () => ({ keys: 3, bound: 2, preferred: 1, unbound: ['c'], fallback: ['b'], lastReasons: [] }),
      explainAll: () => [ex('a', 'stateTree', true), ex('b', 'atom', false), ex('c', null, false)],
    }, [], false);
    expect(h.status).toBe('degraded');
    expect(h.message).toMatch(/^degraded:/);
    expect(h.message).not.toContain('spectating');
  });

  it('leaves "ok" untouched when isSpectating is true but nothing is degraded', () => {
    const h = buildGameStateHealth({
      stats: () => ({ keys: 2, bound: 2, preferred: 2, unbound: [], fallback: [], lastReasons: [] }),
      explainAll: () => [ex('a', 'stateTree', true), ex('b', 'atom', true)],
    }, [], true);
    expect(h.status).toBe('ok');
    expect(h.message).not.toContain('spectating');
  });
});
