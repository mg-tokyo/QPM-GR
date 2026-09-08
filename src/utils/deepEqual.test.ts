import { describe, expect, it } from 'vitest';
import { deepEqual } from './deepEqual';

// A foreign realm's Object.prototype is a different object whose own prototype
// is null — model it with Object.create(Object.create(null)).
function foreignObject(fields: Record<string, unknown>): Record<string, unknown> {
  const foreignProto = Object.create(null) as object;
  return Object.assign(Object.create(foreignProto) as Record<string, unknown>, fields);
}

describe('deepEqual', () => {
  it('compares plain objects and arrays structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('treats objects from another realm as plain objects (userscript sandbox / Xray)', () => {
    const a = foreignObject({ species: 'Carrot', initialStock: 18, nested: foreignObject({ x: 1 }) });
    const b = foreignObject({ species: 'Carrot', initialStock: 18, nested: foreignObject({ x: 1 }) });
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, foreignObject({ species: 'Carrot', initialStock: 17, nested: foreignObject({ x: 1 }) }))).toBe(false);
    // Mixed realms compare by content too.
    expect(deepEqual(a, { species: 'Carrot', initialStock: 18, nested: { x: 1 } })).toBe(true);
  });

  it('still rejects class instances and Maps unless reference-equal', () => {
    class Thing { v = 1; }
    expect(deepEqual(new Thing(), new Thing())).toBe(false);
    expect(deepEqual(new Map(), new Map())).toBe(false);
    const m = new Map();
    expect(deepEqual(m, m)).toBe(true);
  });
});
