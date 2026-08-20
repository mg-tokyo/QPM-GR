import { getPetSpriteWithMutations } from '../../../sprite-v2/compat';
import { getBalloonDef } from '../data/balloonDefs';
import type { BalloonId } from '../types';

// getPetSpriteWithMutations returns the SHARED cached canvas element. Appending
// it to the DOM reparents it, so every consumer must draw into its own copy.
export function buildBalloonIconCanvas(kind: BalloonId, className: string): HTMLCanvasElement | null {
  const def = getBalloonDef(kind);
  const overlays = def.mutationOverlay ? [def.mutationOverlay] : [];
  const source = getPetSpriteWithMutations(def.spriteName, overlays);
  if (!source || source.width === 0 || source.height === 0) return null;
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(source, 0, 0);
  } catch {
    return null;
  }
  copy.className = className;
  return copy;
}
