import type { NpcChatBubble } from '../../types/gameAtoms';
import { isRecord } from '../../utils/typeGuards';
import type { BubbleLine } from './types';

export type Rewriter = (npcId: string, entry: NpcChatBubble) => BubbleLine | null;
type WriteFn = (this: unknown, ...args: unknown[]) => unknown;
interface WritableAtom { write: WriteFn }
type Wrapper = WriteFn & { __qpmWrapped?: true; __qpmLabel?: string };

let target: WritableAtom | null = null;
let original: WriteFn | null = null;
let wrapper: Wrapper | null = null;
let rewriter: Rewriter | null = null;
let passthrough = false;

const isAtom = (a: unknown): a is WritableAtom => isRecord(a) && typeof a.write === 'function';

function readPrev(get: unknown, self: unknown): Record<string, unknown> | null {
  if (typeof get !== 'function') return null;
  try {
    const v: unknown = (get as (a: unknown) => unknown)(self);
    return isRecord(v) ? v : null;
  } catch { return null; }
}

/** When the line was said: `saidAtMs` by game 1468, `timestamp` on older `npcChatBubblesAtom` entries. */
export function bubbleSaidAt(entry: unknown): number | null {
  if (!isRecord(entry)) return null;
  const at = typeof entry.saidAtMs === 'number' ? entry.saidAtMs : entry.timestamp;
  return typeof at === 'number' ? at : null;
}

// Every write spreads the existing bubbles back in and stamps only the line just said, so an unchanged
// said-at time is not a new line.
function isAlreadyShown(prev: Record<string, unknown> | null, npcId: string, entry: Record<string, unknown>): boolean {
  const before = prev?.[npcId];
  return isRecord(before) && bubbleSaidAt(before) === bubbleSaidAt(entry);
}

function rewritePayload(update: unknown, prev: Record<string, unknown> | null): unknown {
  if (passthrough || !rewriter || !isRecord(update)) return update;
  let out: Record<string, unknown> | null = null;
  for (const [npcId, entry] of Object.entries(update)) {
    if (!isRecord(entry) || entry.ariesAuthored === true || entry.qpmAuthored === true || typeof entry.message !== 'string') continue;
    // Pose-only placeholder: the game says the real line only while the message is still empty.
    if (entry.message === '') continue;
    if (isAlreadyShown(prev, npcId, entry)) continue;
    let line: BubbleLine | null = null;
    try { line = rewriter(npcId, entry as NpcChatBubble); } catch { line = null; }
    if (!line) continue;
    const { tags: _stale, ...rest } = entry;
    out ??= { ...update };
    // ariesAuthored stops Arie's Mod's write wrapper from rewriting this line for its borrowed NPC (speech.ts:57 there).
    out[npcId] = { ...rest, message: line.message, ...(line.tags ? { tags: line.tags } : {}), qpmAuthored: true, ariesAuthored: true };
  }
  return out ?? update;
}

function makeWrapper(inner: WriteFn): Wrapper {
  // Classic function: jotai's default write reads `this`.
  const w: Wrapper = function (this: unknown, get: unknown, set: unknown, update: unknown, ...rest: unknown[]) {
    const next = typeof update === 'function' ? update : rewritePayload(update, readPrev(get, this));
    return inner.call(this, get, set, next, ...rest);
  };
  w.__qpmWrapped = true;
  w.__qpmLabel = 'npcDialogue.talk';
  return w;
}

export function installTalkInterceptor(atom: unknown, rewrite: Rewriter): boolean {
  if (!isAtom(atom)) return false;
  rewriter = rewrite;
  passthrough = false;
  if (target === atom && wrapper && atom.write === wrapper) return true;
  // The room scope was swapped (new npcLines atom): hand the old atom its own write back.
  if (target && target !== atom && wrapper && original && target.write === wrapper) target.write = original;
  target = atom;
  original = atom.write;
  wrapper = makeWrapper(original);
  atom.write = wrapper;
  return true;
}

export const isInterceptorTarget = (atom: unknown): boolean => target !== null && target === atom;

export function getInterceptorState():'absent' | 'installed' | 'displaced' | 'passthrough' {
  if (!target || !wrapper) return 'absent';
  if (passthrough) return 'passthrough';
  return target.write === wrapper ? 'installed' : 'displaced';
}

/** Another mod's uninstall can restore a stale `write`, silently dropping ours; re-wrap whatever is there now. */
export function ensureTalkInterceptor(): boolean {
  if (!target || !rewriter || passthrough) return false;
  if (target.write === wrapper) return true;
  original = target.write;
  wrapper = makeWrapper(original);
  target.write = wrapper;
  return true;
}

export function uninstallTalkInterceptor(): void {
  if (target && wrapper && original) {
    if (target.write === wrapper) target.write = original;
    else passthrough = true;
  }
  if (!passthrough) { target = null; original = null; wrapper = null; }
  rewriter = null;
}
