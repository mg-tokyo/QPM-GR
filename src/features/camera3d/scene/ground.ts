import { TILE } from '../constants';
import { PET_LAYER, RIDER_LAYER, layerOf } from '../math/depth';
import type { AvatarViewLike, Node3, XY } from '../types';

const AVATAR = 'AvatarContainer (';
const REST_FRAMES = 6;
const MIN_OFF = 32;
const MAX_OFF = TILE;
// The game glides a step over 130 ms, easeOutQuad (beta 3651 avatarConstants.ts:169, MOVE_MS 100 + 30): a third of it
// is the glide's mean lag.
const RIDE_TAU_MS = 45;
const SNAP_PX = 512; // a jump of 2+ tiles is a teleport, which the game snaps too
const HALF_TILE = TILE / 2;
const HANDOVER_PX = 2;
const RIDE_STALE_MS = 500;
const DRIFT_PX = 1;

interface Seen { y: number; s: number; n: number }
/** A rider's ground `g` at time `t` on tile row `row`; `riding` false: dismounted, handing over to the walker ground. */
interface Ride { g: number; t: number; x: number; row: number; riding: boolean }
/** The height (px, up) runs from hS at natural y srcY to hT at tgtY. rest: tile centre − natural target − lift. */
export interface Glide { srcY: number; tgtY: number; hS: number; hT: number }
interface Split extends Glide {
  grid: XY | null; tile: unknown; air: boolean; rest: number; restRef: number | null; h: number; ground: number; feet: number; eye: number;
}

export interface AvatarSource {
  /** The game's view of an avatar container; null when there is none or its shape drifted. */
  viewOf(n: Node3): AvatarViewLike | null;
  /** Px (up) the game lifts an avatar standing on the view's tile (decor, else building). */
  liftOf(v: AvatarViewLike): number;
  /** Once per kind: no view for an avatar, or a resting avatar's rest moved (a lift QPM does not model). */
  drift(info: Record<string, unknown>): void;
}

export interface GroundTracker {
  isAvatar(n: Node3): boolean;
  /** Ground y the node stands on and the camera follows (`now` in ms): a walking avatar's glides, a riding avatar and its
   * mount share their tile row's, everything else is its sort y. */
  groundY(n: Node3, sortY: number, now: number): number;
  /** The riding avatar whose ground `n` stood on in its last groundY call: `n` is its mount. */
  riderOf(n: Node3): Node3 | null;
  /** An avatar's feet above its ground as drawn at its last groundY call: decor or building lift, saddle, peek lift. */
  feetH(n: Node3): number;
  /** The height the camera rises by: the surface the avatar stands on and its settled saddle (no bob, no peek lift). */
  eyeH(n: Node3): number;
  /** The tile the game has the avatar on (its view's grid position, the local player's logical position) at its last
   * groundY call; null without the game's view. */
  tileOf(n: Node3): XY | null;
}

/** Linear in the natural y between source and target, so it rides the game's own glide curve, whatever its easing. */
export function heightAlong(g: Glide, natY: number): number {
  const d = g.tgtY - g.srcY;
  if (Math.abs(d) < 1) return g.hT;
  return g.hS + (g.hT - g.hS) * Math.min(1, Math.max(0, (natY - g.srcY) / d));
}

// The game draws an avatar at tile centre − rest (192 px) − lift (a bench, a bridge, a shop platform), gliding between
// tiles, plus the saddle and the peek lift (live 2026-10-05, v1419 calculateAvatarWorldPosition). In 2D up the screen is
// both north and height; in 3D only the tile glide is ground, the rest is height. A rider and its mount stand on their
// tile row, eased like the step glide (live 2026-10-04, Phoenix: 400 ± 17 px above the row).
// Without the game's view, the walker falls back to y + a rest offset learned from any avatar standing still.
export function createGroundTracker(src: AvatarSource | null = null): GroundTracker {
  const seen = new WeakMap<Node3, Seen>();
  const rides = new Map<Node3, Ride>();
  const mounts = new WeakMap<Node3, Node3>();
  const splits = new WeakMap<Node3, Split>();
  const reported = new Set<string>();
  let restOff: number | null = null;
  const isAvatar = (n: Node3): boolean => (n.label ?? '').startsWith(AVATAR);

  const report = (kind: string, info: Record<string, unknown>): void => {
    if (!src || reported.has(kind)) return;
    reported.add(kind);
    src.drift({ kind, ...info });
  };

  function walker(n: Node3, sortY: number): number {
    const y = n.y;
    const p = seen.get(n);
    if (!p) seen.set(n, { y, s: sortY, n: 0 });
    else if (p.y === y && p.s === sortY) {
      const off = sortY - y;
      if (++p.n >= REST_FRAMES && off > MIN_OFF && off <= MAX_OFF) restOff = off;
    } else { p.y = y; p.s = sortY; p.n = 0; }
    return restOff === null ? sortY : y + restOff;
  }

  // Idempotent within a frame: it changes only when the game's glide or tile does.
  function split(n: Node3, v: AvatarViewLike): Split | null {
    const gp = v.gridPosition, ps = v.positionSmoothing;
    if (!gp) return null;
    const air = v.isAirborneMount === true;
    let s = splits.get(n);
    const hT = s && s.grid === gp && s.tile === v.lastTileData && s.air === air ? s.hT : (src?.liftOf(v) ?? 0);
    const tgtY = ps.lastGoalWorldY;
    if (!s) {
      s = { srcY: tgtY, tgtY, hS: hT, hT, grid: gp, tile: v.lastTileData, air, rest: 0, restRef: null, h: hT, ground: 0, feet: 0, eye: 0 };
      splits.set(n, s);
    }
    if (!ps.isInterpolating) { s.srcY = tgtY; s.hS = hT; }
    // A new glide (a step, or the game re-planning one) starts at the current lerp: carry the height it had there.
    else if (ps.goalSourceWorldY !== s.srcY) { s.hS = heightAlong(s, ps.goalSourceWorldY); s.srcY = ps.goalSourceWorldY; }
    s.tgtY = tgtY; s.hT = hT; s.grid = gp; s.tile = v.lastTileData; s.air = air;
    s.rest = gp.y * TILE + TILE / 2 - tgtY - hT;
    s.h = heightAlong(s, v.naturalContainerY);
    s.ground = v.naturalContainerY + s.rest + s.h;
    if (!ps.isInterpolating) {
      if (s.restRef === null) s.restRef = s.rest;
      else if (Math.abs(s.rest - s.restRef) > DRIFT_PX) {
        const td = v.lastTileData as { decorId?: unknown } | null | undefined;
        report('rest', { rest: Math.round(s.rest), ref: Math.round(s.restRef), decorId: typeof td?.decorId === 'string' ? td.decorId : null });
      }
    }
    return s;
  }

  function ride(n: Node3, row: number, now: number, riding: boolean): Ride {
    let r = rides.get(n);
    if (!r || Math.abs(row - r.g) > SNAP_PX) {
      r = { g: row, t: now, x: n.x, row, riding };
      rides.set(n, r);
    } else if (now > r.t) {
      r.g = row + (r.g - row) * Math.exp(-(now - r.t) / RIDE_TAU_MS);
      r.t = now;
    }
    r.x = n.x; r.row = row; r.riding = riding;
    return r;
  }

  // The game locks a ridden pet's x to its rider's and sorts it on the rider's tile row (PetView.ts:722, :903).
  function mountGround(n: Node3, sortY: number, now: number): number | null {
    mounts.delete(n);
    if (rides.size === 0 || layerOf(sortY) !== PET_LAYER) return null;
    const row = Math.floor(sortY);
    for (const [a, r] of rides) {
      if (a.destroyed) { rides.delete(a); continue; }
      if (r.riding && r.row === row && Math.abs(n.x - r.x) < HALF_TILE && now - r.t < RIDE_STALE_MS) { mounts.set(n, a); return r.g; }
    }
    return null;
  }

  function avatarGround(n: Node3, sortY: number, now: number, s: Split | null): number {
    const row = Math.floor(sortY);
    if (layerOf(sortY) === RIDER_LAYER) return ride(n, row, now, true).g;
    const w = s ? s.ground : walker(n, sortY);
    if (!rides.has(n)) return w;
    // Dismounted: the saddle slews back over a few frames; the walker ground holds after that.
    const g = ride(n, row, now, false).g;
    if (Math.abs(w - g) > HANDOVER_PX) return g;
    rides.delete(n);
    return w;
  }

  return {
    isAvatar,
    groundY(n, sortY, now) {
      if (!isAvatar(n)) return mountGround(n, sortY, now) ?? sortY;
      const v = src ? src.viewOf(n) : null;
      if (src && !v) report('view', { label: n.label ?? null });
      const s = v ? split(n, v) : null;
      if (!s) splits.delete(n);
      const g = avatarGround(n, sortY, now, s);
      if (s && v) {
        s.feet = g - n.y - s.rest;
        s.eye = s.h - (v.currentRidingNudgePixels ?? 0);
      }
      return g;
    },
    riderOf: (n) => mounts.get(n) ?? null,
    feetH: (n) => splits.get(n)?.feet ?? 0,
    eyeH: (n) => splits.get(n)?.eye ?? 0,
    tileOf: (n) => splits.get(n)?.grid ?? null,
  };
}
