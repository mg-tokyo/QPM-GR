import type { GridPosition } from '../../types/gameAtoms';
import { isRecord } from '../../utils/typeGuards';

// The game frames its own avatar a quarter tile low (avatarCentered, S F1; live 1448 tile {24,24} → target {24,23.75}).
export const AVATAR_HEADROOM = 0.25;
// Grid g is drawn at world (g + 0.5) × 256 (live 1448: cameraSmoothing goal 11136, 7744 for target 43, 29.75).
export const WORLD_PX_PER_TILE = 256;
const PICK_RADIUS_TILES = 0.6;

const usable = (p: GridPosition | null): p is GridPosition => p !== null && Number.isFinite(p.x) && Number.isFinite(p.y);

/** The slot fallback gets the same headroom, so a switch between the two sources never jumps. */
export function followPointOf(drawnGrid: GridPosition | null, slotTile: GridPosition | null): GridPosition | null {
  const src = usable(drawnGrid) ? drawnGrid : usable(slotTile) ? slotTile : null;
  return src ? { x: src.x, y: src.y - AVATAR_HEADROOM } : null;
}

interface WorldXY { x: number; y: number }
interface SmoothingLike { readonly isInterpolating: boolean; lastGoalWorldY: number; advance(nowMs: number): WorldXY }

/** The AvatarView fields follow reads (live 1448; the game only updates a view while it is in the viewport). */
export interface FollowViewLike {
  naturalContainerX: number;
  naturalContainerY: number;
  gridPosition: GridPosition | null;
  readonly isInViewport: boolean;
  container: WorldXY;
  positionSmoothing: SmoothingLike;
}

/** The avatar system's views plus its runtime tile per avatar, culled ones included (beta 4035 AvatarSystem.preDraw). */
export interface AvatarSysLike { views: Map<unknown, unknown>; userPositions?: Map<unknown, unknown> }
export type FollowSource = (frameMs: number) => GridPosition | null;

const fine = new WeakSet<object>();
export function asFollowView(v: unknown): FollowViewLike | null {
  if (!isRecord(v)) return null;
  if (fine.has(v)) return v as unknown as FollowViewLike;
  const ps = v.positionSmoothing, c = v.container;
  const ok = typeof v.naturalContainerX === 'number' && typeof v.naturalContainerY === 'number' && 'isInViewport' in v
    && isRecord(c) && typeof c.x === 'number' && isRecord(ps) && typeof ps.lastGoalWorldY === 'number'
    && typeof ps.advance === 'function' && 'isInterpolating' in ps;
  if (ok) fine.add(v);
  return ok ? v as unknown as FollowViewLike : null;
}

/** The view's ground glide: its goal is the tile centre plus the rest offset and the tile's lift
 * (calculateAvatarWorldPosition), so that difference comes off the drawn position. */
export function drawnGridOf(view: FollowViewLike, natural: WorldXY = { x: view.naturalContainerX, y: view.naturalContainerY }): GridPosition | null {
  const gp = view.gridPosition;
  if (!gp) return null;
  const offset = view.positionSmoothing.lastGoalWorldY - (gp.y + 0.5) * WORLD_PX_PER_TILE;
  return { x: natural.x / WORLD_PX_PER_TILE - 0.5, y: (natural.y - offset) / WORLD_PX_PER_TILE - 0.5 };
}

/** Where the game will draw the view this frame: its own smoothing, copied and advanced to the frame time. Run before
 * the engine frame, this keeps a walking avatar still on screen (live 1448: p95 0 px vs 4.4 px from last frame's spot).
 * Null when the smoothing can't be copied (a game update made its fields private). */
export function predictNatural(view: FollowViewLike, frameMs: number): WorldXY | null {
  const ps = view.positionSmoothing;
  return ps.isInterpolating ? advanceCopy(ps, frameMs) : { x: view.naturalContainerX, y: view.naturalContainerY };
}

// A nested field would be shared with the live smoothing and advanced through the copy (live 1448: 25 own fields, all
// numbers or booleans), so such a smoothing is never copied.
const flat = (o: object): boolean => Object.values(o).every((v) => v === null || typeof v !== 'object');

function advanceCopy(ps: SmoothingLike, frameMs: number): WorldXY | null {
  if (!flat(ps)) return null;
  try {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(ps) as object | null) as object, ps) as SmoothingLike;
    const p = copy.advance(frameMs);
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  } catch {
    return null;
  }
}

/** The entry check (S §4.7): some avatar view has the follow shape and its smoothing can be copied and advanced. */
export function canFollowViews(views: Map<unknown, unknown>, frameMs: number): boolean {
  for (const v of views.values()) {
    const view = asFollowView(v);
    if (view) return advanceCopy(view.positionSmoothing, frameMs) !== null;
  }
  return false;
}

export function tileOf(sys: AvatarSysLike, id: string): GridPosition | null {
  const t = sys.userPositions?.get(id);
  return isRecord(t) && typeof t.x === 'number' && typeof t.y === 'number' ? { x: t.x, y: t.y } : null;
}

/** The view is looked up by id every frame, so a rebuilt view is picked up at once and a dead one never followed. */
export function followSourceFor(id: string, sys: AvatarSysLike): FollowSource {
  return (frameMs) => {
    const v = asFollowView(sys.views.get(id));
    if (v?.isInViewport && v.gridPosition) {
      const natural = predictNatural(v, frameMs) ?? { x: v.naturalContainerX, y: v.naturalContainerY };
      return followPointOf(drawnGridOf(v, natural), tileOf(sys, id));
    }
    return followPointOf(null, tileOf(sys, id));
  };
}

/** The drawn body: the avatar sprite is centred on its container (live 1448: 2×2-tile bounds around it). */
export function bodyPointOf(view: FollowViewLike): GridPosition {
  return { x: view.container.x / WORLD_PX_PER_TILE - 0.5, y: view.container.y / WORLD_PX_PER_TILE - 0.5 };
}

export function pickPlayerAt(
  grid: GridPosition, candidates: ReadonlyArray<{ id: string; point: GridPosition }>, radius = PICK_RADIUS_TILES,
): string | null {
  let best: string | null = null;
  let bestD = radius;
  for (const c of candidates) {
    const d = Math.hypot(c.point.x - grid.x, c.point.y - grid.y);
    if (d <= bestD && (best === null || d < bestD)) { best = c.id; bestD = d; }
  }
  return best;
}
