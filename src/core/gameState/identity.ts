// src/core/gameState/identity.ts — "who am I" ladder feeding {myIdx} selectors.
// Rungs: playerIdAtom -> playerAtom.id -> legacy URL param -> persisted id
// (validated against the room's player list) -> room /me (async).
import { findSlotIdxByOwner, getSlotOwnerId } from '../slotOwner';
import { isRecord } from '../../utils/typeGuards';
import type { IdentityContext } from './types';
import { signalTopology } from './topology';

export const IDENTITY_STORAGE_KEY = 'qpm.identity.playerId.v1';
export type IdentityRung = 'playerIdAtom' | 'playerAtom' | 'url' | 'persisted' | 'account';

export interface IdentityDeps {
  /** Sync read of an atom by exact label; `undefined` when absent/unreadable. */
  readAtomByExactLabel: (label: string) => unknown;
  urlPlayerId: () => string | null;
  userSlots: () => unknown;
  playersInRoom: () => readonly string[] | null;
  storage: { get<T>(key: string, fallback: T): T; set(key: string, value: unknown): void };
  fetchAccountPlayerId: () => Promise<string | null>;
}

let deps: IdentityDeps | null = null;
let playerId: string | null = null;
let rung: IdentityRung | null = null;
let cachedIdx: number | null = null;
const listeners = new Set<(id: IdentityContext) => void>();

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function resolvePlayerId(d: IdentityDeps): { id: string | null; rung: IdentityRung | null } {
  const fromIdAtom = nonEmpty(d.readAtomByExactLabel('playerIdAtom'));
  if (fromIdAtom) return { id: fromIdAtom, rung: 'playerIdAtom' };
  const player = d.readAtomByExactLabel('playerAtom');
  const fromPlayer = isRecord(player) ? nonEmpty(player.id) : null;
  if (fromPlayer) return { id: fromPlayer, rung: 'playerAtom' };
  const fromUrl = nonEmpty(d.urlPlayerId());
  if (fromUrl) return { id: fromUrl, rung: 'url' };
  const persisted = nonEmpty(d.storage.get<string | null>(IDENTITY_STORAGE_KEY, null));
  const players = d.playersInRoom();
  if (persisted && players && players.includes(persisted)) return { id: persisted, rung: 'persisted' };
  return { id: null, rung: null };
}

function resolveIdx(d: IdentityDeps, id: string | null): number | null {
  if (!id) return null;
  const slots = d.userSlots();
  if (cachedIdx !== null && Array.isArray(slots) && getSlotOwnerId(slots[cachedIdx]) === id) return cachedIdx;
  const idx = findSlotIdxByOwner(slots, id);
  cachedIdx = idx >= 0 ? idx : null;
  return cachedIdx;
}

function notify(ctx: IdentityContext): void {
  for (const l of listeners) { try { l(ctx); } catch { /* isolated */ } }
}

export function initIdentity(d: IdentityDeps): void {
  deps = d;
  playerId = null;
  rung = null;
  cachedIdx = null;
  refreshIdentity();
}

export function stopIdentity(): void {
  deps = null;
  playerId = null;
  rung = null;
  cachedIdx = null;
  listeners.clear();
}

/** Cheap: memoised id + validated cached slot index. Safe to call per state event. */
export function getIdentity(): IdentityContext {
  if (!deps) return { playerId: null, myIdx: null };
  if (playerId === null) {
    const r = resolvePlayerId(deps);
    if (r.id) { playerId = r.id; rung = r.rung; deps.storage.set(IDENTITY_STORAGE_KEY, r.id); }
  }
  return { playerId, myIdx: resolveIdx(deps, playerId) };
}

/** Re-runs the ladder; fires listeners + a topology signal when the id changed. */
export function refreshIdentity(): IdentityContext {
  if (!deps) return { playerId: null, myIdx: null };
  const before = playerId;
  const r = resolvePlayerId(deps);
  if (r.id && r.id !== playerId) {
    playerId = r.id;
    rung = r.rung;
    cachedIdx = null;
    deps.storage.set(IDENTITY_STORAGE_KEY, r.id);
  }
  const ctx = { playerId, myIdx: resolveIdx(deps, playerId) };
  if (ctx.playerId !== before) { notify(ctx); signalTopology('identity:changed'); }
  return ctx;
}

export function onIdentityChange(cb: (id: IdentityContext) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Last rung: room /me. Returns true when it produced a (new) id. */
export async function hydrateIdentityFromAccount(): Promise<boolean> {
  if (!deps || playerId) return false;
  let id: string | null = null;
  try { id = nonEmpty(await deps.fetchAccountPlayerId()); } catch { id = null; }
  if (!id || !deps) return false;
  playerId = id;
  rung = 'account';
  cachedIdx = null;
  deps.storage.set(IDENTITY_STORAGE_KEY, id);
  const ctx = getIdentity();
  notify(ctx);
  signalTopology('identity:changed');
  return true;
}

export function explainIdentity(): { playerId: string | null; myIdx: number | null; rung: IdentityRung | null } {
  const ctx = getIdentity();
  return { playerId: ctx.playerId, myIdx: ctx.myIdx, rung };
}
