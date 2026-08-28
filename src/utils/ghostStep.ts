import { readAtomValue } from '../core/atomRegistry';
import { selectSync } from '../core/stateTree';
import { getPlayerPosition as getPlayerPos } from '../core/playerContext';
import { sendRoomAction } from '../websocket/api';
import { createNamedLogger } from '../diagnostics/logger';
import { isRecord } from './typeGuards';

export { isRecord } from './typeGuards';

const log = createNamedLogger('ghostStep');
const WARN_THROTTLE_MS = 30_000;
const lastWarnAt = new Map<string, number>();

export interface XY { x: number; y: number }

export function asXY(v: unknown): XY | null {
  if (!isRecord(v)) return null;
  const x = v.x, y = v.y;
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function pathEnd(path: unknown): XY | null {
  if (!Array.isArray(path) || path.length === 0) return null;
  return asXY(path[path.length - 1]) ?? asXY(path[0]);
}

/**
 * Port of the game's petTile(motion, nowMs) (main v1040 fn `pl`): idle → `at`;
 * walking → `path[floor(elapsed / stepDurationMs)]`. Anything malformed or an
 * unknown kind degrades to the path end / `at` instead of null — the server
 * only needs the tile the pet is on or about to rest on.
 */
export function petTileFromMotion(motion: unknown, nowMs: number = Date.now()): XY | null {
  if (!isRecord(motion)) return null;

  if (motion.kind === 'idle') {
    return asXY(motion.at) ?? pathEnd(motion.path);
  }

  const path = motion.path;
  if (Array.isArray(path) && path.length > 0) {
    const stepMs = motion.stepDurationMs;
    const startMs = motion.startedAtMs;
    if (typeof stepMs === 'number' && stepMs > 0 && typeof startMs === 'number' && Number.isFinite(startMs)) {
      const elapsed = Math.max(0, nowMs - startMs);
      const stepIdx = Math.min(Math.floor(elapsed / stepMs), path.length - 1);
      const tile = asXY(path[stepIdx]);
      if (tile) return tile;
    }
    return pathEnd(path);
  }

  return asXY(motion.at) ?? asXY(motion.to) ?? asXY(motion.from);
}

/** Reads position from standalone `positionAtom`, NOT `playerAtom`. Falls back to `localPlayerPositionAtom`. */
export async function getPlayerPosition(): Promise<XY | null> {
  const pos = await getPlayerPos();
  return pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null;
}

function findPetSlotInfo(state: unknown, petSlotId: string): Record<string, unknown> | null {
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
    if (isRecord(info)) return info;
  }
  return null;
}

/**
 * Read a pet's current grid position from `child.data.userSlots[*].petSlotInfos`.
 * State-tree snapshot first (atom-free, synchronous); stateAtom as fallback.
 */
export async function getPetPosition(petSlotId: string): Promise<XY | null> {
  const info = findPetSlotInfo(selectSync((s) => s), petSlotId)
    ?? findPetSlotInfo(await readAtomValue('state'), petSlotId);
  if (!info) {
    warnUnresolved(petSlotId, 'pet-not-in-state');
    return null;
  }
  const tile = petTileFromMotion(info.motion);
  if (!tile) warnUnresolved(petSlotId, 'motion-unresolved', info.motion);
  return tile;
}

function warnUnresolved(petSlotId: string, reason: string, motion?: unknown): void {
  const now = Date.now();
  if (now - (lastWarnAt.get(petSlotId) ?? 0) < WARN_THROTTLE_MS) return;
  lastWarnAt.set(petSlotId, now);
  log.warn('QPM-PET-001', {
    petSlotId,
    reason,
    motionKind: isRecord(motion) ? String(motion.kind) : typeof motion,
  });
}

/**
 * Ghost-step to a pet's tile, returning a `stepBack()` to restore original position.
 * Returns `null` if already on the same tile or (after a QPM-PET-001 warning)
 * the pet's position can't be resolved — callers then send without stepping,
 * and the server's `rejected` result is the visible failure.
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
