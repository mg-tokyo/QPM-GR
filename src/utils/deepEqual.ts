// Recursive deep-equals for stateAtom.value shapes (primitives, arrays, plain
// objects, null/undefined). Maps/Sets/Dates/class instances fall back to
// reference-equals only. Used as the memoization comparator for
// stateTree.subscribe — called on every state event, so keep it fast.

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
