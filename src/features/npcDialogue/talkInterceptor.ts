import type { NpcChatBubble } from '../../types/gameAtoms';
import { createAtomWriteInterceptor, type InterceptorState } from '../../utils/game/atomWriteInterceptor';
import { isRecord } from '../../utils/typeGuards';
import type { BubbleLine } from './types';

export type Rewriter = (npcId: string, entry: NpcChatBubble) => BubbleLine | null;

const interceptor = createAtomWriteInterceptor('npcDialogue.talk');

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

function rewritePayload(rewriter: Rewriter, update: unknown, prev: Record<string, unknown> | null): unknown {
  if (!isRecord(update)) return update;
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

export function installTalkInterceptor(atom: unknown, rewrite: Rewriter): boolean {
  return interceptor.install(atom, (update, readPrev) => {
    if (typeof update === 'function') return update;
    const prev = readPrev();
    return rewritePayload(rewrite, update, isRecord(prev) ? prev : null);
  });
}

export const isInterceptorTarget = (atom: unknown): boolean => interceptor.isTarget(atom);

export const getInterceptorState = (): InterceptorState => interceptor.state();

export const ensureTalkInterceptor = (): boolean => interceptor.ensure();

export const uninstallTalkInterceptor = (): void => interceptor.uninstall();
