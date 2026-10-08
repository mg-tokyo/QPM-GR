import { describe, expect, it } from 'vitest';
import { createOverrides, removeOverrideAccessors } from './overrides';

class Base {
  private v = true; private z = 0; private a = 1;
  destroyed = false;
  get visible(): boolean { return this.v; } set visible(x: boolean) { this.v = x; }
  get zIndex(): number { return this.z; } set zIndex(x: number) { this.z = x; }
  get alpha(): number { return this.a; } set alpha(x: number) { this.a = x; }
}
class Node extends Base {}

const own = (n: object, key: string): boolean => Object.prototype.hasOwnProperty.call(n, key);

describe('overrides', () => {
  it('PIXI sees our value; the game reads and writes its own', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('visible', n, false);
    expect(ov.raw<boolean>('visible', n)).toBe(false);
    expect(n.visible).toBe(true);
    n.visible = false;
    n.visible = true;
    expect(ov.gameValue<boolean>('visible', n)).toBe(true);
    expect(ov.raw<boolean>('visible', n)).toBe(false);
    expect(ov.stats().gameWrites).toBe(2);
  });

  it('dropAll restores the latest game value and leaves a pass-through (P20)', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('zIndex', n, 99);
    n.zIndex = 7;
    ov.dropAll();
    expect(n.zIndex).toBe(7);
    expect(ov.count()).toBe(0);
    expect(own(n, 'zIndex')).toBe(true);
    n.zIndex = 3;
    expect(ov.raw<number>('zIndex', n)).toBe(3);
    expect(ov.stats().gameWrites).toBe(1);
  });

  it('a put equal to the current value installs nothing', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('alpha', n, 1);
    expect(ov.has('alpha', n)).toBe(false);
    expect(own(n, 'alpha')).toBe(false);
  });

  it('a pinned put installs the accessor even when the value matches, so a later game write cannot change it', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('visible', n, true, true);
    n.visible = false;
    expect(ov.raw<boolean>('visible', n)).toBe(true);
    expect(ov.gameValue<boolean>('visible', n)).toBe(false);
    expect(ov.stats().writes).toBe(0);
  });

  it('writes only on change', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('zIndex', n, 5);
    ov.put('zIndex', n, 5);
    expect(ov.stats().writes).toBe(1);
  });

  it('drop on a destroyed node writes nothing', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('visible', n, false);
    n.destroyed = true;
    expect(() => ov.drop('visible', n)).not.toThrow();
    expect(ov.raw<boolean>('visible', n)).toBe(false);
    expect(ov.has('visible', n)).toBe(false);
  });

  it('rawSet bypasses the shadow', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('visible', n, false);
    ov.rawSet('visible', n, true);
    expect(ov.raw<boolean>('visible', n)).toBe(true);
    expect(n.visible).toBe(true);
  });

  it('prune drops destroyed and detached nodes, a slice per call, and keeps the rest (A R4)', () => {
    const ov = createOverrides(new Node());
    const parent = {};
    const live = Array.from({ length: 6 }, () => Object.assign(new Node(), { parent }));
    for (const n of live) { ov.put('zIndex', n, 5); ov.put('visible', n, false); }
    const [gone, detached] = [live[1]!, live[4]!];
    gone.destroyed = true;
    detached.parent = null as unknown as object;
    detached.zIndex = 3; // the game's own value, restored on drop
    // 12 entries: a budget of 5 needs three calls to cover both maps.
    let dropped = 0;
    for (let i = 0; i < 3; i++) dropped += ov.prune(5);
    expect(dropped).toBe(4);
    expect(ov.count()).toBe(8);
    expect(ov.has('zIndex', gone)).toBe(false);
    expect(ov.has('zIndex', detached)).toBe(false);
    expect(ov.raw<number>('zIndex', detached)).toBe(3);
    expect(ov.raw<number>('zIndex', live[0]!)).toBe(5);
  });

  it('prune visits each entry at most once per call, however large the budget', () => {
    const ov = createOverrides(new Node());
    const n = Object.assign(new Node(), { parent: {} });
    ov.put('alpha', n, 0.5);
    expect(ov.prune(1000)).toBe(0);
    expect(ov.count()).toBe(1);
  });

  it('throws when the sample has no accessor', () => {
    expect(() => createOverrides({})).toThrow(/visible/);
  });

  it('every node gets the same accessor functions, across instances (P20)', () => {
    const a = createOverrides(new Node());
    const b = createOverrides(new Node());
    const [n1, n2, n3] = [new Node(), new Node(), new Node()];
    a.put('zIndex', n1, 5);
    a.put('zIndex', n2, 6);
    b.put('zIndex', n3, 7);
    const d1 = Object.getOwnPropertyDescriptor(n1, 'zIndex')!;
    const d2 = Object.getOwnPropertyDescriptor(n2, 'zIndex')!;
    const d3 = Object.getOwnPropertyDescriptor(n3, 'zIndex')!;
    expect(d1.get).toBe(d2.get);
    expect(d1.set).toBe(d2.set);
    expect(d1.get).toBe(d3.get);
  });

  it('a pass-through re-activates with the current game value (P20)', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('alpha', n, 0.5);
    ov.drop('alpha', n);
    n.alpha = 0.8;
    ov.put('alpha', n, 0.25);
    expect(ov.has('alpha', n)).toBe(true);
    expect(ov.raw<number>('alpha', n)).toBe(0.25);
    expect(n.alpha).toBe(0.8);
    n.alpha = 0.9;
    expect(ov.gameValue<number>('alpha', n)).toBe(0.9);
    ov.dropAll();
    expect(n.alpha).toBe(0.9);
  });

  it('a pass-through whose value already matches is not re-activated by an unpinned put', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('visible', n, false);
    ov.drop('visible', n);
    ov.put('visible', n, true);
    expect(ov.has('visible', n)).toBe(false);
  });

  it('a reinstalled instance adopts the pass-throughs the last one left (P20)', () => {
    const old = createOverrides(new Node());
    const n = new Node();
    old.put('zIndex', n, 4);
    old.dropAll();
    const next = createOverrides(new Node());
    next.put('zIndex', n, 9);
    n.zIndex = 2;
    expect(next.stats().gameWrites).toBe(1);
    expect(old.stats().gameWrites).toBe(0);
    expect(next.gameValue<number>('zIndex', n)).toBe(2);
    next.dropAll();
    expect(n.zIndex).toBe(2);
  });

  it('removeOverrideAccessors takes the pass-throughs off a tree and leaves active overrides (P20)', () => {
    const ov = createOverrides(new Node());
    const [root, a, b, c] = [new Node(), new Node(), new Node(), new Node()];
    Object.assign(root, { children: [a, b] });
    Object.assign(a, { children: [c] });
    ov.put('visible', a, false);
    ov.put('zIndex', c, 5);
    ov.put('alpha', b, 0.5);
    ov.drop('visible', a);
    ov.drop('zIndex', c);
    expect(removeOverrideAccessors(root)).toBe(2);
    expect(own(a, 'visible') || own(c, 'zIndex')).toBe(false);
    expect([a.visible, c.zIndex]).toEqual([true, 0]);
    expect(own(b, 'alpha')).toBe(true);
    expect(ov.raw<number>('alpha', b)).toBe(0.5);
    ov.dropAll();
    expect(removeOverrideAccessors(root)).toBe(1);
    expect(b.alpha).toBe(1);
  });

  // PIXI keeps `_zIndex` on the prototype; the first changing zIndex write makes it an own field, after our accessor.
  class Lazy extends Node { declare _zIndex: number; override get zIndex(): number { return this._zIndex; } override set zIndex(x: number) { if (this._zIndex !== x) this._zIndex = x; } }
  (Lazy.prototype as { _zIndex: number })._zIndex = 0;

  it('keys the setter added after ours keep their value and order when the accessor comes off', () => {
    const ov = createOverrides(new Lazy());
    const n = new Lazy();
    const before = Reflect.ownKeys(n);
    ov.put('zIndex', n, 5);
    n.zIndex = 2;
    ov.dropAll();
    removeOverrideAccessors(n);
    expect(Reflect.ownKeys(n)).toEqual([...before, '_zIndex']);
    expect(n.zIndex).toBe(2);
  });
});
