import { afterEach, describe, expect, it } from 'vitest';
import { ensureRenderHook, getRenderHookState, installRenderHook, uninstallRenderHook } from './renderHook';
import { REWRAP_MAX } from './rewrap';

function makeRenderer() {
  const calls: unknown[] = [];
  const r: { render: (...a: unknown[]) => unknown } = { render: (t: unknown) => { calls.push(t); return 'drawn'; } };
  return { r, calls };
}

describe('renderHook', () => {
  afterEach(() => uninstallRenderHook());

  it('routes stage renders through onStage and passes everything else straight through', () => {
    const { r, calls } = makeRenderer();
    const stage = {};
    const seen: string[] = [];
    installRenderHook(r, stage, (orig) => { seen.push('stage'); return orig(); });
    expect(r.render({ container: stage })).toBe('drawn');
    expect(r.render({ container: {}, target: {} })).toBe('drawn');
    expect(r.render(stage)).toBe('drawn');
    expect(seen).toEqual(['stage', 'stage']);
    expect(calls.length).toBe(3);
  });

  it('uninstall restores a prototype method by deleting the own property', () => {
    class R { render(): string { return 'proto'; } }
    const r = new R();
    installRenderHook(r, {}, (o) => o());
    expect(Object.prototype.hasOwnProperty.call(r, 'render')).toBe(true);
    uninstallRenderHook();
    expect(Object.prototype.hasOwnProperty.call(r, 'render')).toBe(false);
  });

  it('displaced then ensure retires the old wrapper: exactly one onStage per stage render', () => {
    const { r } = makeRenderer();
    const stage = {};
    let n = 0;
    installRenderHook(r, stage, (o) => { n++; return o(); });
    const ours = r.render;
    r.render = function (this: unknown, ...a: unknown[]) { return ours.apply(this, a); };
    expect(getRenderHookState()).toBe('displaced');
    expect(ensureRenderHook(0)).toBe('rewrapped');
    r.render({ container: stage });
    expect(n).toBe(1);
  });

  it('an adversary that re-wraps on every displacement cannot grow the chain without bound (A R7)', () => {
    const { r } = makeRenderer();
    const stage = {};
    let n = 0;
    installRenderHook(r, stage, (o) => { n++; return o(); });
    let depth = 0;
    const results: string[] = [];
    for (let i = 0; i < 50; i++) {
      const inner = r.render;
      r.render = function (this: unknown, ...a: unknown[]) { return inner.apply(this, a); };
      depth++;
      const res = ensureRenderHook(i);
      results.push(res);
      if (res === 'rewrapped') depth++;
    }
    expect(results.filter((x) => x === 'rewrapped').length).toBe(REWRAP_MAX);
    expect(results.filter((x) => x === 'capped').length).toBe(1);
    expect(depth).toBe(50 + REWRAP_MAX);
    // Still exactly one active QPM handler in the chain.
    r.render({ container: stage });
    expect(n).toBe(1);
  });

  it('uninstall while displaced retires the wrapper (it stays in the other chain but does nothing)', () => {
    const { r } = makeRenderer();
    const stage = {};
    let n = 0;
    installRenderHook(r, stage, (o) => { n++; return o(); });
    const ours = r.render;
    r.render = function (this: unknown, ...a: unknown[]) { return ours.apply(this, a); };
    uninstallRenderHook();
    r.render({ container: stage });
    expect(n).toBe(0);
    expect(getRenderHookState()).toBe('absent');
  });

  it('a re-entrant stage render inside onStage passes through', () => {
    const { r } = makeRenderer();
    const stage = {};
    let n = 0;
    installRenderHook(r, stage, (o) => { n++; if (n === 1) r.render({ container: stage }); return o(); });
    r.render({ container: stage });
    expect(n).toBe(1);
  });
});
