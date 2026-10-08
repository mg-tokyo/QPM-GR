// Persistent per-node render overrides. An overridden node gets own accessors: the game keeps reading and writing
// its own value (the shadow) while PIXI renders ours. Values are written only on change, so a still camera causes
// no render-group rebuild. dropAll() hands the game's latest values back.
export type OverrideKey = 'visible' | 'zIndex' | 'alpha';
const KEYS: readonly OverrideKey[] = ['visible', 'zIndex', 'alpha'];

export interface Overrides {
  /** pin: install the accessor even when the value already matches, so later game writes only reach the shadow. */
  put(key: OverrideKey, node: object, value: unknown, pin?: boolean): void;
  drop(key: OverrideKey, node: object): void;
  dropAll(): void;
  gameValue<T>(key: OverrideKey, node: object): T;
  raw<T>(key: OverrideKey, node: object): T;
  rawSet(key: OverrideKey, node: object, value: unknown): void;
  has(key: OverrideKey, node: object): boolean;
  /** Drops overrides of destroyed or detached nodes, up to `max` entries visited per call, resuming where the last call
   * stopped; each entry at most once per call. Returns how many were dropped. */
  prune(max: number): number;
  count(): number;
  stats(): { writes: number; gameWrites: number; count: number };
}

interface Proto { get: (this: object) => unknown; set: (this: object, v: unknown) => void }
interface Counters { gameWrites: number }
/** Inactive: the accessor stays on the node and passes reads and writes straight to PIXI. */
interface Entry { game: unknown; active: boolean; p: Proto; o: Counters }

// V8 turns a node slow (dictionary mode) when one key gets a different accessor pair on the same hidden class, and on
// any delete (Chrome 154, live 2026-10-06): per-node closures plus delete-on-exit left 866 game nodes slow in 2D and
// kept the old runtime reachable through the transition tree (P20). So every node shares one accessor pair per key,
// closing over module scope only, and a dropped override stays installed as a pass-through.
const ENTRIES: Record<OverrideKey, WeakMap<object, Entry>> = { visible: new WeakMap(), zIndex: new WeakMap(), alpha: new WeakMap() };
const accessor = (entries: WeakMap<object, Entry>): PropertyDescriptor => ({
  configurable: true,
  get(this: object): unknown {
    const e = entries.get(this);
    if (e === undefined) return undefined;
    return e.active ? e.game : e.p.get.call(this);
  },
  set(this: object, v: unknown): void {
    const e = entries.get(this);
    if (e === undefined) return;
    if (e.active) { e.game = v; e.o.gameWrites++; } else e.p.set.call(this, v);
  },
});
const ACCESSORS: Record<OverrideKey, PropertyDescriptor> = { visible: accessor(ENTRIES.visible), zIndex: accessor(ENTRIES.zIndex), alpha: accessor(ENTRIES.alpha) };

/** Takes the pass-through accessors off every node under `root` when 3D is turned off; those nodes turn slow (any
 * delete does). Active overrides are left alone. Returns how many were removed. */
export function removeOverrideAccessors(root: object): number {
  let removed = 0;
  const stack: object[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i]!;
      const e = ENTRIES[k].get(node);
      if (e === undefined || e.active) continue;
      delete (node as Record<string, unknown>)[k];
      ENTRIES[k].delete(node);
      removed++;
    }
    const kids = (node as { children?: unknown }).children;
    if (Array.isArray(kids)) for (const c of kids as unknown[]) if (c !== null && typeof c === 'object') stack.push(c);
  }
  return removed;
}

function findAccessor(sample: object, key: string): PropertyDescriptor | null {
  for (let p: object | null = Object.getPrototypeOf(sample) as object | null; p; p = Object.getPrototypeOf(p) as object | null) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) return d.get && d.set ? d : null;
  }
  return null;
}

export function createOverrides(sample: object): Overrides {
  const proto = (key: OverrideKey): Proto => {
    const d = findAccessor(sample, key);
    if (!d) throw new Error(`camera3d: no ${key} accessor on the node prototype`);
    return { get: d.get as Proto['get'], set: d.set as Proto['set'] };
  };
  const protos: Record<OverrideKey, Proto> = { visible: proto('visible'), zIndex: proto('zIndex'), alpha: proto('alpha') };
  // This instance's active entries, read by property: these run several times per billboard per frame (string-keyed
  // Map lookups here were ~0.2 ms a frame at 700 billboards, live 2026-10-03).
  const maps: Record<OverrideKey, Map<object, Entry>> = { visible: new Map(), zIndex: new Map(), alpha: new Map() };
  const counters: Counters = { gameWrites: 0 };
  let writes = 0;
  const isDestroyed = (node: object): boolean => (node as { destroyed?: unknown }).destroyed === true;
  // Until exit, a despawned pet or avatar stayed alive in these maps (A R4). Live iterators survive deletes.
  const iters: Partial<Record<OverrideKey, Iterator<object>>> = {};
  let pruneKey = 0;

  const drop = (key: OverrideKey, node: object): boolean => {
    const e = maps[key].get(node);
    if (!e) return false;
    maps[key].delete(node);
    if (e.o !== counters) return true;
    e.active = false;
    if (!isDestroyed(node) && e.p.get.call(node) !== e.game) e.p.set.call(node, e.game);
    return true;
  };

  return {
    put(key, node, value, pin = false) {
      const m = maps[key];
      const p = protos[key];
      if (!m.has(node)) {
        const cur = p.get.call(node);
        let e = ENTRIES[key].get(node);
        if (e === undefined) {
          if (cur === value && !pin) return;
          e = { game: cur, active: true, p, o: counters };
          ENTRIES[key].set(node, e);
          Object.defineProperty(node, key, ACCESSORS[key]);
        } else if (!e.active) {
          if (cur === value && !pin) return;
          e.game = cur;
          e.active = true;
        }
        e.p = p;
        e.o = counters;
        m.set(node, e);
      }
      if (p.get.call(node) !== value) { p.set.call(node, value); writes++; }
    },
    drop(key, node) { drop(key, node); },
    dropAll() {
      for (const key of KEYS) for (const node of maps[key].keys()) drop(key, node);
    },
    gameValue<T>(key: OverrideKey, node: object): T {
      const e = maps[key].get(node);
      return (e ? e.game : protos[key].get.call(node)) as T;
    },
    raw<T>(key: OverrideKey, node: object): T { return protos[key].get.call(node) as T; },
    rawSet(key, node, value) { protos[key].set.call(node, value); },
    has(key, node) { return maps[key].has(node); },
    prune(max) {
      let dropped = 0, visited = 0, ends = 0;
      while (visited < max && ends < KEYS.length) {
        const key = KEYS[pruneKey]!;
        const it = (iters[key] ??= maps[key].keys());
        const r = it.next();
        if (r.done) { delete iters[key]; pruneKey = (pruneKey + 1) % KEYS.length; ends++; continue; }
        visited++;
        const n = r.value as { parent?: unknown };
        if (isDestroyed(n) || n.parent == null) { drop(key, n); dropped++; }
      }
      return dropped;
    },
    count() { let n = 0; for (const k of KEYS) n += maps[k].size; return n; },
    stats() { let n = 0; for (const k of KEYS) n += maps[k].size; return { writes, gameWrites: counters.gameWrites, count: n }; },
  };
}
