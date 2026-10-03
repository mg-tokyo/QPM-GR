import { describe, expect, it } from 'vitest';
import { createOverrides } from './overrides';

class Base {
  private v = true; private z = 0; private a = 1;
  destroyed = false;
  get visible(): boolean { return this.v; } set visible(x: boolean) { this.v = x; }
  get zIndex(): number { return this.z; } set zIndex(x: number) { this.z = x; }
  get alpha(): number { return this.a; } set alpha(x: number) { this.a = x; }
}
class Node extends Base {}

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

  it('dropAll restores the latest game value and removes the accessor', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('zIndex', n, 99);
    n.zIndex = 7;
    ov.dropAll();
    expect(Object.prototype.hasOwnProperty.call(n, 'zIndex')).toBe(false);
    expect(n.zIndex).toBe(7);
    expect(ov.count()).toBe(0);
  });

  it('a put equal to the current value installs nothing', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('alpha', n, 1);
    expect(ov.has('alpha', n)).toBe(false);
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

  it('drop on a destroyed node removes the accessor without writing', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('visible', n, false);
    n.destroyed = true;
    expect(() => ov.drop('visible', n)).not.toThrow();
    expect(ov.raw<boolean>('visible', n)).toBe(false);
  });

  it('rawSet bypasses the shadow', () => {
    const ov = createOverrides(new Node());
    const n = new Node();
    ov.put('visible', n, false);
    ov.rawSet('visible', n, true);
    expect(ov.raw<boolean>('visible', n)).toBe(true);
    expect(n.visible).toBe(true);
  });

  it('throws when the sample has no accessor', () => {
    expect(() => createOverrides({})).toThrow(/visible/);
  });
});
