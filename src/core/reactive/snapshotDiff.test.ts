import { describe, expect, it } from 'vitest';
import { diffSnapshotPaths } from './snapshotDiff';

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}

// Copy-on-write set along `path`, like the game's RoomFrame apply.
function setIn(root: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return deepFreeze(value);
  const [head, ...rest] = path as [string, ...string[]];
  const src = root as Record<string, unknown>;
  const copy: Record<string, unknown> | unknown[] = Array.isArray(root) ? [...root] : { ...src };
  (copy as Record<string, unknown>)[head] = setIn(src[head], rest, value);
  return Object.freeze(copy);
}

const base = () => deepFreeze({
  child: {
    data: {
      currentTime: 1,
      userSlots: [
        { data: { petSlots: [{ hunger: 10, xp: 1 }, { hunger: 20, xp: 2 }], garden: { tileObjects: { a: 1 } } } },
        { data: { petSlots: [], garden: { tileObjects: {} } } },
      ],
    },
  },
});

const paths = (r: ReturnType<typeof diffSnapshotPaths>) => r?.map((p) => p.path);

describe('diffSnapshotPaths', () => {
  it('reports only the patched leaves, never untouched siblings', () => {
    const prev = base();
    let next = setIn(prev, ['child', 'data', 'currentTime'], 2);
    next = setIn(next, ['child', 'data', 'userSlots', '0', 'data', 'petSlots', '1', 'hunger'], 19);
    expect(paths(diffSnapshotPaths(prev, next))?.sort()).toEqual([
      '/child/data/currentTime',
      '/child/data/userSlots/0/data/petSlots/1/hunger',
    ]);
  });

  it('skips a replaced subtree whose values did not change', () => {
    const prev = base();
    const next = setIn(prev, ['child', 'data', 'userSlots', '0', 'data', 'garden'], { tileObjects: { a: 1 } });
    expect(diffSnapshotPaths(prev, next)).toEqual([]);
  });

  it('reports an array whose length changed as one path', () => {
    const prev = base();
    const next = setIn(prev, ['child', 'data', 'userSlots', '1', 'data', 'petSlots'], [{ hunger: 1, xp: 0 }]);
    expect(paths(diffSnapshotPaths(prev, next))).toEqual(['/child/data/userSlots/1/data/petSlots']);
  });

  it('emits remove for a deleted key and escapes pointer segments', () => {
    const prev = deepFreeze({ m: { 'a/b': 1, 'c~d': 1 } });
    const next = deepFreeze({ m: { 'a/b': 2 } });
    expect(diffSnapshotPaths(prev, next)).toEqual([
      { op: 'replace', path: '/m/a~1b' },
      { op: 'remove', path: '/m/c~0d' },
    ]);
  });

  it('collapses a bulk change to its container', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ q: i }));
    const prev = deepFreeze({ inv: { items } });
    const next = deepFreeze({ inv: { items: items.map((it) => ({ q: it.q + 1 })) } });
    expect(paths(diffSnapshotPaths(prev, next))).toEqual(['/inv/items']);
  });

  it('refuses unfrozen snapshots and identical roots (caller does a full reload)', () => {
    expect(diffSnapshotPaths({ a: { b: 1 } }, { a: { b: 2 } })).toBeNull();
    const prev = base();
    expect(diffSnapshotPaths(prev, prev)).toBeNull();
  });

  it('gives up past the visit budget (e.g. a Welcome full state)', () => {
    const tree = (n: number) => Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => ({ v: { n } })));
    expect(diffSnapshotPaths(deepFreeze({ t: tree(1) }), deepFreeze({ t: tree(2) }))).toBeNull();
  });
});
