import { readAtomValueSync } from '../core/atomRegistry';
import { playSfx } from './player';
import type { SpatialSfxOptions } from './types';

const DEFAULT_MAX_DISTANCE = 20;

export function playSpatialSfx(
  name: string,
  sourcePos: { x: number; y: number },
  opts?: SpatialSfxOptions,
): void {
  const player = readAtomValueSync('position');
  if (!player || typeof player.x !== 'number' || typeof player.y !== 'number') {
    playSfx(name, opts?.feature !== undefined ? { feature: opts.feature } : {});
    return;
  }

  const maxDistance = opts?.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const dx = sourcePos.x - player.x;
  const dy = sourcePos.y - player.y;
  const chebyshev = Math.max(Math.abs(dx), Math.abs(dy));
  if (chebyshev >= maxDistance) return;

  const volumeMultiplier = 1 - (chebyshev / maxDistance);
  if (volumeMultiplier <= 0) return;
  const pan = clamp(dx / maxDistance, -1, 1);

  const call: { volumeMultiplier: number; pan: number; feature?: string } = { volumeMultiplier, pan };
  if (opts?.feature !== undefined) call.feature = opts.feature;
  playSfx(name, call);
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
