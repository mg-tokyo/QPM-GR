import { describe, expect, it, vi } from 'vitest';
import { createAtomWriteInterceptor } from './atomWriteInterceptor';

function fakeAtom(value: unknown = null) {
  const calls: unknown[] = [];
  const atom = {
    write(this: unknown, _g: unknown, _s: unknown, update: unknown) {
      calls.push(update);
      return this;
    },
  };
  return {
    atom,
    calls,
    send: (u: unknown) => atom.write.call(atom, (a: unknown) => (a === atom ? value : undefined), null, u),
  };
}

describe('createAtomWriteInterceptor', () => {
  it('passes every update (functions included) through the transform, with the previous value and `this`', () => {
    const f = fakeAtom(['old']);
    const ic = createAtomWriteInterceptor('test');
    const fn = (): string[] => [];
    const seen: unknown[] = [];
    ic.install(f.atom, (u, readPrev) => { seen.push(readPrev()); return typeof u === 'function' ? 'wrapped' : `${String(u)}!`; });
    expect(f.send('a')).toBe(f.atom);
    f.send(fn);
    expect(f.calls).toEqual(['a!', 'wrapped']);
    expect(seen).toEqual([['old'], ['old']]);
  });

  it('marks its wrapper for mod detection', () => {
    const f = fakeAtom();
    createAtomWriteInterceptor('my.label').install(f.atom, (u) => u);
    const w = f.atom.write as unknown as { __qpmWrapped?: unknown; __qpmLabel?: unknown };
    expect([w.__qpmWrapped, w.__qpmLabel]).toEqual([true, 'my.label']);
  });

  it('readPrev returns null when get throws or is missing', () => {
    const f = fakeAtom();
    const ic = createAtomWriteInterceptor('test');
    const seen: unknown[] = [];
    ic.install(f.atom, (u, readPrev) => { seen.push(readPrev()); return u; });
    f.atom.write.call(f.atom, () => { throw new Error('x'); }, null, 1);
    f.atom.write.call(f.atom, null, null, 2);
    expect(seen).toEqual([null, null]);
  });

  it('two instances stay independent', () => {
    const a = fakeAtom();
    const b = fakeAtom();
    const one = createAtomWriteInterceptor('one');
    const two = createAtomWriteInterceptor('two');
    one.install(a.atom, () => 'one');
    two.install(b.atom, () => 'two');
    a.send(0);
    b.send(0);
    expect([a.calls[0], b.calls[0]]).toEqual(['one', 'two']);
    one.uninstall();
    expect(one.state()).toBe('absent');
    expect(two.state()).toBe('installed');
  });

  it('re-install on the same atom swaps the transform without stacking wrappers', () => {
    const f = fakeAtom();
    const ic = createAtomWriteInterceptor('test');
    ic.install(f.atom, () => 'first');
    const w = f.atom.write;
    ic.install(f.atom, () => 'second');
    expect(f.atom.write).toBe(w);
    f.send(0);
    expect(f.calls).toEqual(['second']);
  });

  it('rejects a non-atom and stays absent', () => {
    const ic = createAtomWriteInterceptor('test');
    const t = vi.fn();
    expect(ic.install(null, t)).toBe(false);
    expect(ic.install({ write: 1 }, t)).toBe(false);
    expect(ic.state()).toBe('absent');
    expect(ic.ensure()).toBe(false);
  });

  it('uninstall restores the original write when ours is on top', () => {
    const f = fakeAtom();
    const original = f.atom.write;
    const ic = createAtomWriteInterceptor('test');
    ic.install(f.atom, () => 'x');
    ic.uninstall();
    expect(f.atom.write).toBe(original);
    expect(ic.isTarget(f.atom)).toBe(false);
  });

  it('pass-through after being wrapped over: updates reach the game untouched, ensure refuses, a fresh install resumes', () => {
    const f = fakeAtom();
    const ic = createAtomWriteInterceptor('test');
    ic.install(f.atom, () => 'x');
    const ours = f.atom.write;
    f.atom.write = function (this: unknown, g: unknown, s: unknown, u: unknown) { return ours.call(this, g, s, u); };
    ic.uninstall();
    expect(ic.state()).toBe('passthrough');
    expect(ic.ensure()).toBe(false);
    f.send('raw');
    expect(f.calls).toEqual(['raw']);
    ic.install(f.atom, () => 'again');
    f.send('raw');
    expect(f.calls[1]).toBe('again');
  });
});
