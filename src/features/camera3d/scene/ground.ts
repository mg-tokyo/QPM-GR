import type { Node3 } from '../types';

const AVATAR = 'AvatarContainer (';
const REST_FRAMES = 6;
const MIN_OFF = 32;
const MAX_OFF = 256;

interface Seen { y: number; s: number; n: number }

export interface GroundTracker {
  isAvatar(n: Node3): boolean;
  /** Ground y the node stands on and the camera follows: an avatar's glides, everything else is its sort y. */
  groundY(n: Node3, sortY: number): number;
}

// An avatar's sort y is its tile's, so it steps a whole tile at the start of each step while the container glides
// (live 2026-10-03: z/1e4 5504 → 5760 → 6016 as y went 5312 → 5718). At rest it is y + 192 (0.75 tile); that rest
// offset is learned from any avatar standing still, then applied to y, so walking north/south is continuous.
export function createGroundTracker(): GroundTracker {
  const seen = new WeakMap<Node3, Seen>();
  let restOff: number | null = null;
  const isAvatar = (n: Node3): boolean => (n.label ?? '').startsWith(AVATAR);
  return {
    isAvatar,
    groundY(n, sortY) {
      if (!isAvatar(n)) return sortY;
      const y = n.y;
      const p = seen.get(n);
      if (!p) seen.set(n, { y, s: sortY, n: 0 });
      else if (p.y === y && p.s === sortY) {
        const off = sortY - y;
        if (++p.n >= REST_FRAMES && off > MIN_OFF && off <= MAX_OFF) restOff = off;
      } else { p.y = y; p.s = sortY; p.n = 0; }
      return restOff === null ? sortY : y + restOff;
    },
  };
}
