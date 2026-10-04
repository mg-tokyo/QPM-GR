import { PET_LAYER, RIDER_LAYER, layerOf } from '../math/depth';
import type { Node3 } from '../types';

const AVATAR = 'AvatarContainer (';
const REST_FRAMES = 6;
const MIN_OFF = 32;
const MAX_OFF = 256;
// The game glides a step over 130 ms, easeOutQuad (beta 3651 avatarConstants.ts:169, MOVE_MS 100 + 30): a third of it
// is the glide's mean lag.
const RIDE_TAU_MS = 45;
const SNAP_PX = 512; // a jump of 2+ tiles is a teleport, which the game snaps too
const HALF_TILE = 128;
const HANDOVER_PX = 2;
const RIDE_STALE_MS = 500;

interface Seen { y: number; s: number; n: number }
/** A rider's ground `g` at time `t` on tile row `row`; `riding` false: dismounted, handing over to the walker ground. */
interface Ride { g: number; t: number; x: number; row: number; riding: boolean }

export interface GroundTracker {
  isAvatar(n: Node3): boolean;
  /** Ground y the node stands on and the camera follows (`now` in ms): a walking avatar's glides, a riding avatar and its
   * mount share their tile row's, everything else is its sort y. */
  groundY(n: Node3, sortY: number, now: number): number;
  /** The riding avatar whose ground `n` stood on in its last groundY call: `n` is its mount. */
  riderOf(n: Node3): Node3 | null;
}

// An avatar's sort y is its tile's, so it steps a whole tile at the start of each step while the container glides
// (live 2026-10-03: z/1e4 5504 → 5760 → 6016 as y went 5312 → 5718). At rest it is y + 192 (0.75 tile); that rest
// offset is learned from any avatar standing still, then applied to y, so walking north/south is continuous.
// A rider's container also carries the saddle lift and its bob (live 2026-10-04, Phoenix: 400 ± 17 px above the row),
// which are height, not ground: the rider and its mount stand on their tile row, eased like the game's step glide.
export function createGroundTracker(): GroundTracker {
  const seen = new WeakMap<Node3, Seen>();
  const rides = new Map<Node3, Ride>();
  const mounts = new WeakMap<Node3, Node3>();
  let restOff: number | null = null;
  const isAvatar = (n: Node3): boolean => (n.label ?? '').startsWith(AVATAR);

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

  return {
    isAvatar,
    groundY(n, sortY, now) {
      if (!isAvatar(n)) return mountGround(n, sortY, now) ?? sortY;
      const row = Math.floor(sortY);
      if (layerOf(sortY) === RIDER_LAYER) return ride(n, row, now, true).g;
      const w = walker(n, sortY);
      if (!rides.has(n)) return w;
      // Dismounted: the saddle lift slews back to the walker pose over a few frames; y + rest offset holds after that.
      const g = ride(n, row, now, false).g;
      if (Math.abs(w - g) > HANDOVER_PX) return g;
      rides.delete(n);
      return w;
    },
    riderOf: (n) => mounts.get(n) ?? null,
  };
}
