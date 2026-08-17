import { applyMutations, type MgSceneV1 } from '../../../../mg-sprite-render/src';
import { getRawSpriteCanvas } from '../../../sprite-v2/compat';
import { computeSlotBounds } from './bounds';

// Mirrors the customiser's export padding (MG-Sprite-Customiser-V2 app.ts SAFE_PAD),
// in scene pixel units.
const CONTENT_PAD_PX = 24;

interface ComposedSlot {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

// Scene coord convention (matches MG-Sprite-Customiser-V2/src/renderer/canvas-renderer.ts:349-355):
//   - origin (0,0) = customiser render-canvas CENTER; each slot is drawn centered on
//     transform.x/y (anchor 0.5, 0.5) at its natural sprite pixel size × transform.scale.
// IMPORTANT: scene.canvas (256×256) is a hardcoded constant in the customiser's
// serializeSceneAsQpmV1 and is NOT the real render size (default 1024). Content
// routinely extends far outside it, so we must fit to the union of slot bounds
// (like the customiser's auto-fit PNG export) — never to scene.canvas.
export function renderDesignCanvas(scene: MgSceneV1, size = 256): HTMLCanvasElement | null {
  const composed = composeSlots(scene);
  const b = computeSlotBounds(
    composed.map(s => ({ w: s.canvas.width, h: s.canvas.height, x: s.x, y: s.y, scale: s.scale, rotation: s.rotation })),
    CONTENT_PAD_PX,
  );
  if (!b) return null;
  const fit = size / Math.max(b.w, b.h);
  const outW = Math.max(1, Math.round(b.w * fit));
  const outH = Math.max(1, Math.round(b.h * fit));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;

  for (const s of composed) {
    ctx.save();
    ctx.translate((s.x - b.x) * fit, (s.y - b.y) * fit);
    ctx.rotate(s.rotation);
    ctx.scale(s.scale * fit, s.scale * fit);
    ctx.drawImage(s.canvas, -s.canvas.width / 2, -s.canvas.height / 2);
    ctx.restore();
  }

  return canvas;
}

function composeSlots(scene: MgSceneV1): ComposedSlot[] {
  const out: ComposedSlot[] = [];
  const ordered = [...scene.slots].sort((a, b) => a.zIndex - b.zIndex);
  for (const slot of ordered) {
    if (!slot.visible) continue;
    const raw = getRawSpriteCanvas(slot.spriteKey);
    if (!raw || raw.width === 0 || raw.height === 0) continue;

    const c = document.createElement('canvas');
    c.width = raw.width;
    c.height = raw.height;
    const cctx = c.getContext('2d');
    if (!cctx) continue;
    cctx.drawImage(raw, 0, 0);
    applyMutations(c, [...slot.mutations], false, slot.tint);

    out.push({
      canvas: c,
      x: slot.transform.x,
      y: slot.transform.y,
      scale: slot.transform.scale,
      rotation: slot.transform.rotation,
    });
  }
  return out;
}

export function renderDesignThumbnail(scene: MgSceneV1, size = 256): string {
  const canvas = renderDesignCanvas(scene, size);
  return canvas ? canvas.toDataURL('image/png') : '';
}
