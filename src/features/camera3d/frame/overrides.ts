// Persistent per-node render overrides. An overridden node gets own accessors: the game keeps reading and writing
// its own value (the shadow) while PIXI renders ours. Values are written only on change, so a still camera causes
// no render-group rebuild. dropAll() hands the game's latest values back.
export type OverrideKey = 'visible' | 'zIndex' | 'alpha';
const KEYS: readonly OverrideKey[] = ['visible', 'zIndex', 'alpha'];

interface Shadow { game: unknown }

export interface Overrides {
  /** pin: install the accessor even when the value already matches, so later game writes only reach the shadow. */
  put(key: OverrideKey, node: object, value: unknown, pin?: boolean): void;
  drop(key: OverrideKey, node: object): void;
  dropAll(): void;
  gameValue<T>(key: OverrideKey, node: object): T;
  raw<T>(key: OverrideKey, node: object): T;
  rawSet(key: OverrideKey, node: object, value: unknown): void;
  has(key: OverrideKey, node: object): boolean;
  count(): number;
  stats(): { writes: number; gameWrites: number; count: number };
}

function findAccessor(sample: object, key: string): PropertyDescriptor | null {
  for (let p: object | null = Object.getPrototypeOf(sample) as object | null; p; p = Object.getPrototypeOf(p) as object | null) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) return d.get && d.set ? d : null;
  }
  return null;
}

interface Slot { get: (this: object) => unknown; set: (this: object, v: unknown) => void; map: Map<object, Shadow> }

export function createOverrides(sample: object): Overrides {
  // One slot per key, read by property: these run several times per billboard per frame (string-keyed Map lookups
  // here were ~0.2 ms a frame at 700 billboards, live 2026-10-03).
  const slot = (key: OverrideKey): Slot => {
    const d = findAccessor(sample, key);
    if (!d) throw new Error(`camera3d: no ${key} accessor on the node prototype`);
    return { get: d.get as Slot['get'], set: d.set as Slot['set'], map: new Map<object, Shadow>() };
  };
  const slots: Record<OverrideKey, Slot> = { visible: slot('visible'), zIndex: slot('zIndex'), alpha: slot('alpha') };
  let writes = 0;
  let gameWrites = 0;
  const isDestroyed = (node: object): boolean => (node as { destroyed?: unknown }).destroyed === true;

  const drop = (key: OverrideKey, node: object): void => {
    const s = slots[key];
    const e = s.map.get(node);
    if (!e) return;
    s.map.delete(node);
    delete (node as Record<string, unknown>)[key];
    if (!isDestroyed(node) && s.get.call(node) !== e.game) s.set.call(node, e.game);
  };

  return {
    put(key, node, value, pin = false) {
      const s = slots[key];
      if (!s.map.has(node)) {
        const cur = s.get.call(node);
        if (cur === value && !pin) return;
        const shadow: Shadow = { game: cur };
        s.map.set(node, shadow);
        Object.defineProperty(node, key, {
          configurable: true,
          get() { return shadow.game; },
          set(x: unknown) { shadow.game = x; gameWrites++; },
        });
      }
      if (s.get.call(node) !== value) { s.set.call(node, value); writes++; }
    },
    drop,
    dropAll() {
      for (const key of KEYS) for (const node of [...slots[key].map.keys()]) drop(key, node);
    },
    gameValue<T>(key: OverrideKey, node: object): T {
      const s = slots[key];
      const e = s.map.get(node);
      return (e ? e.game : s.get.call(node)) as T;
    },
    raw<T>(key: OverrideKey, node: object): T { return slots[key].get.call(node) as T; },
    rawSet(key, node, value) { slots[key].set.call(node, value); },
    has(key, node) { return slots[key].map.has(node); },
    count() { let n = 0; for (const k of KEYS) n += slots[k].map.size; return n; },
    stats() { let n = 0; for (const k of KEYS) n += slots[k].map.size; return { writes, gameWrites, count: n }; },
  };
}
