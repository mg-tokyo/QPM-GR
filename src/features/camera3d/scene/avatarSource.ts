import { getDecor } from '../../../catalogs/gameCatalogs';
import { isRecord } from '../../../utils/typeGuards';
import { TILE } from '../constants';
import type { AvatarSystemLike, AvatarViewLike, Node3 } from '../types';
import type { AvatarSource } from './ground';

const isView = (v: Record<string, unknown>): boolean => {
  const ps = v.positionSmoothing;
  return typeof v.naturalContainerY === 'number' && isRecord(ps) && typeof ps.lastGoalWorldY === 'number'
    && typeof ps.goalSourceWorldY === 'number' && typeof ps.isInterpolating === 'boolean';
};

// The game's calculateAvatarWorldPosition (live 2026-10-05, v1419): the tile's decor avatarNudgeY (tile units, negative
// is up) wins, else the building's avatarYNudgePixels; an airborne mount gets neither.
export function liftOfView(v: AvatarViewLike, nudgeOf: (decorId: string) => unknown = (id) => getDecor(id)?.avatarNudgeY): number {
  if (v.isAirborneMount) return 0;
  const td = v.lastTileData;
  if (isRecord(td) && td.objectType === 'decor' && typeof td.decorId === 'string') {
    const nudge = nudgeOf(td.decorId);
    if (typeof nudge === 'number' && nudge !== 0) return -nudge * TILE;
  }
  const b = v.gridPosition ? v.buildingDataProvider?.getBuildingAt(v.gridPosition) : null;
  return isRecord(b) && typeof b.avatarYNudgePixels === 'number' && b.avatarYNudgePixels !== 0 ? -b.avatarYNudgePixels : 0;
}

/** Views are matched by their container (one per player and NPC, created with it) and kept per container; so is a
 * miss, so a drifted shape does not rescan the views every frame. */
export function createAvatarSource(sys: AvatarSystemLike | null, drift: (info: Record<string, unknown>) => void): AvatarSource {
  const cache = new WeakMap<Node3, AvatarViewLike>();
  const misses = new WeakSet<Node3>();
  const find = (n: Node3): AvatarViewLike | null => {
    if (!sys) return null;
    for (const v of sys.views.values()) {
      if (isRecord(v) && v.container === n) return isView(v) ? (v as unknown as AvatarViewLike) : null;
    }
    return null;
  };
  return {
    viewOf(n) {
      const hit = cache.get(n);
      if (hit) return hit;
      if (misses.has(n)) return null;
      const v = find(n);
      if (v) cache.set(n, v); else misses.add(n);
      return v;
    },
    liftOf: (v) => liftOfView(v),
    drift,
  };
}
