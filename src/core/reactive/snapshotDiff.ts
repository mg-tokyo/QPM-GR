import type { PatchOp } from '../stateTree';

// Game 1686 dropped the connection's patch stream. Its RoomFrame apply is
// copy-on-write and deep-freezes the result (RoomConnection-*.js `Xe`), so an
// untouched subtree keeps its identity and the walk only descends along
// patched paths. Paths it emits are equal to or deeper than the game's own.
const MAX_VISITS = 2000;
// Above this many changed children a container reports itself instead
// (bulk replace: the per-child paths cost more than they gate).
const MAX_CHANGED_CHILDREN = 32;

type Container = Record<string, unknown> | unknown[];

const isContainer = (v: unknown): v is Container => typeof v === 'object' && v !== null;
const escapeSegment = (k: string): string => (k.includes('~') || k.includes('/') ? k.replace(/~/g, '~0').replace(/\//g, '~1') : k);

/**
 * Changed JSON Pointer paths between two frozen room-state snapshots, or null
 * when they can't be diffed cheaply and safely (not frozen, budget exceeded) —
 * callers treat null as a full reload.
 */
export function diffSnapshotPaths(prev: unknown, next: unknown): PatchOp[] | null {
  if (prev === next || !isContainer(prev) || !isContainer(next)) return null;
  const out: PatchOp[] = [];
  const budget = { visits: 0 };
  return walk(prev, next, '', out, budget) ? out : null;
}

function walk(a: unknown, b: unknown, path: string, out: PatchOp[], budget: { visits: number }): boolean {
  if (++budget.visits > MAX_VISITS) return false;
  if (!isContainer(a) || !isContainer(b) || Array.isArray(a) !== Array.isArray(b)
    || (Array.isArray(a) && Array.isArray(b) && a.length !== b.length)) {
    out.push({ op: 'replace', path });
    return true;
  }
  // Identity-equal children are skipped unread; only immutability makes that sound.
  if (!Object.isFrozen(a) || !Object.isFrozen(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const mark = out.length;
  let changed = 0;
  for (const k of Object.keys(rb)) {
    const va = ra[k];
    const vb = rb[k];
    if (va === vb) continue;
    if (++changed > MAX_CHANGED_CHILDREN) {
      out.length = mark;
      out.push({ op: 'replace', path });
      return true;
    }
    if (!walk(va, vb, `${path}/${escapeSegment(k)}`, out, budget)) return false;
  }
  if (!Array.isArray(b)) {
    for (const k of Object.keys(ra)) {
      if (!Object.prototype.hasOwnProperty.call(rb, k)) out.push({ op: 'remove', path: `${path}/${escapeSegment(k)}` });
    }
  }
  return true;
}
