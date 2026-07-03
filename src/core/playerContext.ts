// src/core/playerContext.ts — Shared player identity and position helpers.
//
// Centralises the "read playerAtom → extract id" and "read positionAtom → XY"
// patterns that were previously duplicated across 5+ files.

import { readAtomValue, readAtomValueSync } from './atomRegistry';
import { getRoomConnection } from '../websocket/api';
import type { GridPosition } from '../types/gameAtoms';
import { isRecord } from '../utils/typeGuards';

/**
 * Atom-free playerId fallback for the WEB build only.
 *
 * On `magicgarden.gg` (web/webview), the WS connect URL includes a
 * `?playerId="..."` query param — the value is JSON-encoded (has literal
 * double-quotes around the string; empirically verified 2026-07-03). We
 * `JSON.parse` to strip them.
 *
 * On Discord Activity (`discordsays.com`), the URL has NO `playerId` param —
 * it uses a `jwt` with the Discord snowflake instead, which is NOT the
 * server-assigned player.id used in room state. There is no sync client-side
 * fallback for Discord; that surface still requires `playerAtom` /
 * `playerIdAtom` to be present. If those get deprecated, a Discord-specific
 * path (Discord SDK subscription or async /me lookup) will be needed.
 *
 * Returns null if the WS is missing, the URL is unparseable, the surface is
 * Discord, or the param is empty.
 */
export function getPlayerIdFromUrl(): string | null {
  const rc = getRoomConnection();
  const ws = rc?.currentWebSocket ?? rc?.ws ?? rc?.socket ?? null;
  const rawUrl = ws?.url;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
  try {
    const parsed = new URL(rawUrl);
    const raw = parsed.searchParams.get('playerId');
    if (!raw || raw.length === 0) return null;
    // Values in this URL are JSON-encoded strings. `raw` = `"p_juEzJpS13rS946jH"`
    // (literal quotes included). JSON.parse strips them; if that fails, fall
    // back to a manual quote strip so an unexpected format still works.
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = raw.replace(/^"(.*)"$/, '$1');
    }
    if (typeof decoded !== 'string') return null;
    const trimmed = decoded.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function extractPlayerIdFromRecord(player: unknown): string | null {
  if (!player || typeof player !== 'object') return null;
  const record = player as Record<string, unknown>;
  for (const field of ['id', 'playerId', 'userId'] as const) {
    const candidate = record[field];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Resolve the current player's ID synchronously.
 * Tries the `player` atom first, then falls back to the WS URL. Suitable for
 * state-tree selectors and keydown handlers that can't await.
 */
export function getPlayerIdSync(): string | null {
  const fromAtom = extractPlayerIdFromRecord(readAtomValueSync('player'));
  if (fromAtom) return fromAtom;
  return getPlayerIdFromUrl();
}

/**
 * Resolve the current player's ID. Tries the `player` atom first, then falls
 * back to the WS URL (atom-free path).
 */
export async function getPlayerId(): Promise<string | null> {
  const fromAtom = extractPlayerIdFromRecord(await readAtomValue('player'));
  if (fromAtom) return fromAtom;
  return getPlayerIdFromUrl();
}

/**
 * Resolve the current player's grid position.
 * Reads `position` first, falls back to `localPosition`.
 */
export async function getPlayerPosition(): Promise<GridPosition | null> {
  const pos = await readAtomValue('position');
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') return pos;

  const local = await readAtomValue('localPosition');
  if (local && typeof local.x === 'number' && typeof local.y === 'number') return local;

  return null;
}

/**
 * Resolve the current player's user-slot index.
 * Reads `myUserSlotIdx` directly, falls back to searching stateAtom + playerAtom.
 */
export async function getMyUserSlotIdx(): Promise<number | null> {
  const idx = await readAtomValue('myUserSlotIdx');
  if (typeof idx === 'number' && idx >= 0) return idx;

  // Fallback: find our slot in stateAtom by matching playerId
  const playerId = await getPlayerId();
  if (!playerId) return null;

  const state = await readAtomValue('state');
  if (!isRecord(state)) return null;
  const child = state.child;
  if (!isRecord(child)) return null;
  const data = child.data;
  if (!isRecord(data)) return null;
  const userSlots = data.userSlots;
  if (!Array.isArray(userSlots)) return null;

  for (let i = 0; i < userSlots.length; i++) {
    const slot = userSlots[i];
    if (isRecord(slot) && String(slot.playerId ?? '').trim() === playerId) {
      return i;
    }
  }
  return null;
}
