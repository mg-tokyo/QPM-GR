export interface SlotBoundsInput {
  w: number;
  h: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface SlotBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Rotated-rect union in scene units (each slot centered on x/y, anchor 0.5,0.5).
// Same math as MG-Sprite-Customiser-V2 app.ts computeCompositeBounds.
export function computeSlotBounds(slots: readonly SlotBoundsInput[], pad = 0): SlotBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of slots) {
    const hw = (s.w * s.scale) / 2;
    const hh = (s.h * s.scale) / 2;
    const cos = Math.cos(s.rotation);
    const sin = Math.sin(s.rotation);
    for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const) {
      const px = s.x + cx * cos - cy * sin;
      const py = s.y + cx * sin + cy * cos;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const x = minX - pad;
  const y = minY - pad;
  return { x, y, w: Math.max(1, maxX + pad - x), h: Math.max(1, maxY + pad - y) };
}
