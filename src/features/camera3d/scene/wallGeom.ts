import type { Basis } from '../math/camera';

// A fence wall drawn as a batched strip: every vertex projected exactly (no fourth-corner drift), the texture affine
// within each triangle. Near the lens that affine error grows and a vertex can cross the near plane, so the wall
// switches to a perspective quad (GPU w, hardware near clip; polish Task 11, A V4).
export const WALL_COLS = 4;
export const WALL_ROWS = 2;
export const STRIP_VERTS = (WALL_COLS + 1) * (WALL_ROWS + 1);
const ROW = WALL_COLS + 1;
// Hysteresis, in screen px of texture error and in near planes of depth. 2 px keeps third-person mid-distance walls on
// the strip (live 1411: at 1 px, 7 walls 490–1150 px away switched in the default view, each first switch a World rebuild).
const ON_PX = 2;
const OFF_PX = 1.2;
const NEAR_ON = 3;
const NEAR_OFF = 4;
// fences.ts holds an error-only switch for a frame that rebuilds World anyway while the error stays under this.
const WAIT_PX = 3;
// Looser than the switch: fences.ts shows a wall's quad (at scale 0) ahead of the switch, on a frame that rebuilds World
// anyway, so the switch itself moves scales only (perf Task 7, PC12).
const ARM_PX = 1;
const NEAR_ARM = 6;

/** Ground line A→B in 2D world px (x, y as world x, z), art `h` px tall. */
export interface WallLine { ax: number; az: number; bx: number; bz: number; h: number }

/** Texture-local uvs: u along A→B, v from the wall top (0) to the ground (1). */
export function stripUvs(): Float32Array {
  const uv = new Float32Array(STRIP_VERTS * 2);
  for (let j = 0; j <= WALL_ROWS; j++) for (let i = 0; i <= WALL_COLS; i++) { const v = i + j * ROW; uv[2 * v] = i / WALL_COLS; uv[2 * v + 1] = j / WALL_ROWS; }
  return uv;
}

export function stripIndices(): Uint32Array {
  const idx = new Uint32Array(WALL_COLS * WALL_ROWS * 6);
  let k = 0;
  for (let j = 0; j < WALL_ROWS; j++) {
    for (let i = 0; i < WALL_COLS; i++) {
      const a = i + j * ROW, b = a + 1, c = a + ROW, d = c + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = a; idx[k++] = d; idx[k++] = c;
    }
  }
  return idx;
}

/** The perspective quad in world space (x, height, z): A top, B top, B ground, A ground (the texture's TL, TR, BR, BL). */
export function wallQuadWorld(w: WallLine): Float32Array {
  return new Float32Array([w.ax, w.h, w.az, w.bx, w.h, w.bz, w.bx, 0, w.bz, w.ax, 0, w.az]);
}

const put = (a: Float32Array, i: number, v: number): boolean => {
  const f = Math.fround(v);
  if (a[i] === f) return false;
  a[i] = f;
  return true;
};

/** Screen positions and camera depths of every strip vertex (math/camera.ts project()); true when a position moved. */
export function projectStrip(b: Basis, w: WallLine, pos: Float32Array, depth: Float32Array): boolean {
  const C = b.C, F = b.F, R = b.R, U = b.U;
  let ch = false;
  for (let j = 0; j <= WALL_ROWS; j++) {
    const ry = w.h * (1 - j / WALL_ROWS) - C[1];
    for (let i = 0; i <= WALL_COLS; i++) {
      const f = i / WALL_COLS, v = i + j * ROW;
      const rx = w.ax + (w.bx - w.ax) * f - C[0], rz = w.az + (w.bz - w.az) * f - C[2];
      const cz = rx * F[0] + ry * F[1] + rz * F[2];
      ch = put(pos, 2 * v, b.cx0 + (b.fpx * (rx * R[0] + rz * R[2])) / cz) || ch;
      ch = put(pos, 2 * v + 1, b.cy0 - (b.fpx * (rx * U[0] + ry * U[1] + rz * U[2])) / cz) || ch;
      depth[v] = cz;
    }
  }
  return ch;
}

// An edge whose ends sit at depths z0, z1 shows its texture midpoint (z1 − z0) / (2 (z0 + z1)) of its length away
// from where perspective puts it; the triangles' edges and diagonals bound the error inside them.
function edgeError(pos: Float32Array, depth: Float32Array, p: number, q: number): number {
  const z0 = depth[p]!, z1 = depth[q]!;
  const dx = pos[2 * q]! - pos[2 * p]!, dy = pos[2 * q + 1]! - pos[2 * p + 1]!;
  // sqrt, not Math.hypot: hypot allocated on every call (live 2026-10-05: 10 MB of garbage in a 7 s walk, A PF4).
  return (Math.abs(z1 - z0) / (2 * (z0 + z1))) * Math.sqrt(dx * dx + dy * dy);
}

function errorOver(pos: Float32Array, depth: Float32Array, limit: number): boolean {
  for (let j = 0; j <= WALL_ROWS; j++) {
    for (let i = 0; i <= WALL_COLS; i++) {
      const a = i + j * ROW;
      if (i < WALL_COLS && edgeError(pos, depth, a, a + 1) > limit) return true;
      if (j < WALL_ROWS && edgeError(pos, depth, a, a + ROW) > limit) return true;
      if (i < WALL_COLS && j < WALL_ROWS && edgeError(pos, depth, a, a + ROW + 1) > limit) return true;
    }
  }
  return false;
}

function zMinOf(depth: Float32Array): number {
  let zMin = Infinity;
  for (let v = 0; v < STRIP_VERTS; v++) if (depth[v]! < zMin) zMin = depth[v]!;
  return zMin;
}

/** Whether this wall draws as a perspective quad this frame (prev: last frame's answer). */
export function stripNeedsPerspective(prev: boolean, pos: Float32Array, depth: Float32Array, near: number): boolean {
  const zMin = zMinOf(depth);
  if (zMin < NEAR_ON * near) return true;
  if (prev && zMin < NEAR_OFF * near) return true;
  return errorOver(pos, depth, prev ? OFF_PX : ON_PX);
}

/** The wall is close to needing the quad: show it now if the frame rebuilds World anyway. */
export function stripMayNeedPerspective(pos: Float32Array, depth: Float32Array, near: number): boolean {
  return zMinOf(depth) < NEAR_ARM * near || errorOver(pos, depth, ARM_PX);
}

/** A strip asking for the quad on its texture error alone, still under WAIT_PX, can draw a few more frames. */
export function stripCanWait(pos: Float32Array, depth: Float32Array, near: number): boolean {
  return zMinOf(depth) >= NEAR_ON * near && !errorOver(pos, depth, WAIT_PX);
}
