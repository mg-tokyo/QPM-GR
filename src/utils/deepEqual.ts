// src/utils/deepEqual.ts
//
// Minimal recursive deep-equals for MagicGarden state-tree data. Handles the
// shape that shows up in stateAtom.value: primitives, arrays, plain objects,
// null/undefined. Does NOT handle Maps, Sets, Dates, functions, class instances,
// or prototype chains — game state is Immutable<IState<RoomData>> (see beta
// store/store.ts) which serializes cleanly as plain JSON. If a future state
// change introduces non-plain values, this function will treat them as
// reference-equals only.
//
// Purpose: memoization comparator for stateTree.subscribe selectors. Called on
// every state event for every subscriber, so keep it fast — reference equality
// first, then a shallow type check, then recurse only when both are plain
// containers.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  // Different types (one plain object, one array; one object, one primitive),
  // NaN vs NaN (typeof number but a !== b), or unsupported (Map/Set/Date/etc):
  // fall through as unequal. Reference-equal case handled at the top.
  return false;
}
