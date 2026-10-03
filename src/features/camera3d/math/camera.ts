// Camera maths for the 3D view. World X = 2D x, world Z = 2D y, world Y = height (world px; 256 = one tile).
export type V3 = [number, number, number];
export interface XY { x: number; y: number }

export interface CamParams {
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
  lookH: number;
  yOff: number;
  near: number;
  far: number;
}

export interface Basis { F: V3; R: V3; U: V3; C: V3; fpx: number; cx0: number; cy0: number }

/** Yaw 0 looks north (−y); pitch π/2 looks straight down. */
export function makeBasis(p: CamParams, tx: number, ty: number, W: number, H: number): Basis {
  const fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const F: V3 = [fx * cp, -sp, fz * cp];
  const R: V3 = [Math.cos(p.yaw), 0, Math.sin(p.yaw)];
  const U: V3 = [fx * sp, cp, fz * sp];
  const C: V3 = [tx - F[0] * p.dist, p.lookH - F[1] * p.dist, ty - F[2] * p.dist];
  const fpx = (H / 2) / Math.tan(p.fov / 2);
  return { F, R, U, C, fpx, cx0: W / 2, cy0: H / 2 + p.yOff * H };
}

/** out[0] = screen x, out[1] = screen y, out[2] = camera depth. */
export function project(b: Basis, X: number, Y: number, Z: number, out: number[]): void {
  const rx = X - b.C[0], ry = Y - b.C[1], rz = Z - b.C[2];
  const cz = rx * b.F[0] + ry * b.F[1] + rz * b.F[2];
  const cx = rx * b.R[0] + rz * b.R[2];
  const cy = rx * b.U[0] + ry * b.U[1] + rz * b.U[2];
  out[0] = b.cx0 + b.fpx * cx / cz;
  out[1] = b.cy0 - b.fpx * cy / cz;
  out[2] = cz;
}

function rayDir(b: Basis, sx: number, sy: number): V3 {
  const a = sx - b.cx0, c = b.cy0 - sy;
  return [
    b.F[0] * b.fpx + b.R[0] * a + b.U[0] * c,
    b.F[1] * b.fpx + b.U[1] * c,
    b.F[2] * b.fpx + b.R[2] * a + b.U[2] * c,
  ];
}

export function groundRay(b: Basis, sx: number, sy: number): XY | null {
  const d = rayDir(b, sx, sy);
  if (d[1] >= -1e-6) return null;
  const t = -b.C[1] / d[1];
  return { x: b.C[0] + t * d[0], y: b.C[2] + t * d[2] };
}

/** Camera ground point plus the four corner rays, each cut at maxDist horizontally. */
export function groundFootprint(b: Basis, W: number, H: number, maxDist: number): { x0: number; y0: number; x1: number; y1: number } {
  const pts: Array<[number, number]> = [[b.C[0], b.C[2]]];
  for (const [sx, sy] of [[0, H], [W, H], [0, 0], [W, 0]] as const) {
    const d = rayDir(b, sx, sy);
    const h = Math.hypot(d[0], d[2]) || 1;
    let t = d[1] < -1e-6 ? -b.C[1] / d[1] : Infinity;
    if (!(t * h <= maxDist)) t = maxDist / h;
    pts.push([b.C[0] + t * d[0], b.C[2] + t * d[2]]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
