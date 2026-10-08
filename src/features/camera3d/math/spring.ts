export interface SpringPoint { s: number; v: number }

/** Critically damped spring toward a fixed target, exact for any dt (w = 1/τ in dt's units). */
export const springStep = (p: SpringPoint, target: number, dt: number, w: number): void => {
  const e0 = p.s - target, c = p.v + w * e0, ex = Math.exp(-w * dt);
  p.s = target + (e0 + c * dt) * ex;
  p.v = (p.v - w * c * dt) * ex;
};
