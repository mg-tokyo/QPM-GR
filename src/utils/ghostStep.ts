// src/utils/ghostStep.ts — Shared ghost-step utilities for walking to a pet's tile via WS.

import { getAtomByLabel, readAtomValue } from '../core/jotaiBridge';
import { sendRoomAction } from '../websocket/api';

export interface XY { x: number; y: number }

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

export function asXY(v: unknown): XY | null {
  if (!isRecord(v)) return null;
  const x = v.x, y = v.y;
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Compute a pet's current grid tile from its motion state.
 * Simplified port of the game's `petTileAt(motion, nowMs)`.
 */
export function petTileFromMotion(motion: unknown): XY | null {
  if (!isRecord(motion)) return null;

  if (motion.kind === 'idle') {
    return asXY(motion.at);
  }

  if (motion.kind === 'walking') {
    const path = motion.path as unknown[];
    const stepMs = motion.stepDurationMs as number;
    const startMs = motion.startedAtMs as number;
    if (!Array.isArray(path) || !path.length || typeof stepMs !== 'number' || typeof startMs !== 'number') return null;

    const elapsed = Math.max(0, Date.now() - startMs);
    const stepIdx = Math.min(Math.floor(elapsed / stepMs), path.length - 1);
    return asXY(path[stepIdx]);
  }

  return null;
}

/**
 * Read the player's current grid position from `positionAtom`.
 *
 * The game stores position in a standalone `positionAtom` (GridPosition | null),
 * NOT as a sub-property of `playerAtom` (which holds id/name/cosmetic only).
 * Falls back to `localPlayerPositionAtom` (slot-aware derived atom) if the
 * primary atom is missing or null.
 */
export async function getPlayerPosition(): Promise<XY | null> {
  for (const label of ['positionAtom', 'localPlayerPositionAtom'] as const) {
    const atom = getAtomByLabel(label);
    if (!atom) continue;
    const value = await readAtomValue<unknown>(atom).catch(() => null);
    const pos = asXY(value);
    if (pos) return pos;
  }
  return null;
}

/**
 * Read a pet's current grid position from `stateAtom → child.data.userSlots → petSlotInfos`.
 */
export async function getPetPosition(petSlotId: string): Promise<XY | null> {
  const atom = getAtomByLabel('stateAtom');
  if (!atom) return null;
  const state = await readAtomValue<unknown>(atom).catch(() => null);
  if (!isRecord(state)) return null;

  const child = state.child;
  if (!isRecord(child)) return null;
  const data = child.data;
  if (!isRecord(data)) return null;
  const userSlots = data.userSlots;
  if (!Array.isArray(userSlots)) return null;

  for (const slot of userSlots) {
    if (!isRecord(slot)) continue;
    const infos = slot.petSlotInfos;
    if (!isRecord(infos)) continue;
    const info = infos[petSlotId];
    if (!isRecord(info)) continue;
    const pos = petTileFromMotion(info.motion);
    if (pos) return pos;
  }
  return null;
}

/**
 * Ghost-step to a pet's tile, returning a `stepBack()` to restore original position.
 * Returns `null` if already on the same tile or positions can't be resolved.
 */
export async function ghostStepToPet(petSlotId: string): Promise<{ stepBack(): void } | null> {
  const [playerPos, petPos] = await Promise.all([
    getPlayerPosition(),
    getPetPosition(petSlotId),
  ]);

  const onSameTile = playerPos && petPos &&
    playerPos.x === petPos.x && playerPos.y === petPos.y;

  if (!petPos || onSameTile) return null;

  sendRoomAction('PlayerPosition', { position: petPos }, { skipThrottle: true });

  return {
    stepBack() {
      if (playerPos) {
        sendRoomAction('PlayerPosition', { position: playerPos }, { skipThrottle: true });
      }
    },
  };
}
