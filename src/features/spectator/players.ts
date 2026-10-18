import { readSync, subscribe } from '../../core/gameState';
import { getSlotOwnerId } from '../../core/slotOwner';
import type { PlayerAtomValue } from '../../types/gameAtoms';
import { isRecord } from '../../utils/typeGuards';

export interface SeatedPlayer {
  id: string;
  name: string;
  /** userSlots index + 1: the digit that follows them. */
  seat: number;
  online: boolean;
  /** The cosmetic colour name, e.g. "Black". */
  colour: string | null;
  discordAvatarUrl: string | null;
  lastAction: { action: string; at: number } | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function lastActionOf(slot: unknown): SeatedPlayer['lastAction'] {
  const e = isRecord(slot) ? slot.lastActionEvent : null;
  return isRecord(e) && typeof e.action === 'string' && typeof e.performedAt === 'number' ? { action: e.action, at: e.performedAt } : null;
}

/** Everyone seated but you, in seat order. A seat whose player record is gone counts as offline. */
export function seatedPlayersFrom(slots: readonly unknown[] | null, players: readonly PlayerAtomValue[] | null, meId: string | null): SeatedPlayer[] {
  const out: SeatedPlayer[] = [];
  (slots ?? []).forEach((slot, i) => {
    const id = getSlotOwnerId(slot);
    if (!id || id === meId) return;
    const p = (players ?? []).find((q) => q.id === id);
    const cosmetic = p && isRecord(p.cosmetic) ? p.cosmetic : null;
    out.push({
      id, name: str(p?.name) ?? id, seat: i + 1, online: p ? p.isConnected !== false : false,
      colour: str(cosmetic?.color), discordAvatarUrl: str(p?.discordAvatarUrl), lastAction: lastActionOf(slot),
    });
  });
  return out;
}

export const listSeatedPlayers = (): SeatedPlayer[] =>
  seatedPlayersFrom(readSync('userSlots'), readSync('players'), readSync('playerId'));

/** ] from free cam starts at the first seat, [ at the last; a player who left counts as free cam. */
export function nextFollowId(list: ReadonlyArray<{ id: string }>, currentId: string | null, dir: 1 | -1): string | null {
  if (list.length === 0) return null;
  const i = currentId === null ? -1 : list.findIndex((p) => p.id === currentId);
  if (i < 0) return (dir === 1 ? list[0] : list[list.length - 1])?.id ?? null;
  return list[(i + dir + list.length) % list.length]?.id ?? null;
}

const signatureOf = (list: readonly SeatedPlayer[]): string =>
  JSON.stringify(list.map((p) => [p.id, p.name, p.seat, p.online, p.colour, p.discordAvatarUrl, p.lastAction?.at ?? null]));

const listeners = new Set<(list: readonly SeatedPlayer[]) => void>();
let offs: Array<() => void> = [];
let lastSig = '';

function refresh(): void {
  const list = listSeatedPlayers();
  const sig = signatureOf(list);
  if (sig === lastSig) return;
  lastSig = sig;
  for (const cb of [...listeners]) {
    try { cb(list); } catch { /* isolate listeners */ }
  }
}

/** Fires when the roster, a name, a connection or a last action changes. The game state is watched only while
 * someone listens. */
export function onPlayersChange(cb: (list: readonly SeatedPlayer[]) => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    lastSig = signatureOf(listSeatedPlayers());
    offs = [subscribe('userSlots', refresh), subscribe('players', refresh), subscribe('playerId', refresh)];
  }
  return () => {
    if (!listeners.delete(cb) || listeners.size > 0) return;
    for (const off of offs.splice(0)) off();
  };
}
