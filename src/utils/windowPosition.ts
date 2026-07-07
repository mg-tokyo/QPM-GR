// Shared ratio-based window positioning utilities.
// Position is stored as viewport ratios (0–1) so windows survive any viewport resize.

/**
 * Compute a viewport-proportional default dimension.
 * designPx is the intended size at 1920px wide; this scales proportionally to
 * the actual viewport so windows are always the same *fraction* of the screen.
 * Falls back to designPx if the viewport is narrower than 1920.
 */
export function scaledDimension(designPx: number, axis: 'w' | 'h'): number {
  const ref = axis === 'w' ? 1920 : 1080;
  const actual = axis === 'w' ? window.innerWidth : window.innerHeight;
  return Math.round(Math.max(designPx, designPx * (actual / ref)));
}

/** Clamp a ratio to [0, 1]. */
export function clampPct(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Convert viewport ratios → pixel left/top, clamped to visible viewport.
 * elementW/elementH are the element's current rendered dimensions.
 */
export function pctToPixels(
  xPct: number,
  yPct: number,
  elementW: number,
  elementH: number,
): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - elementW);
  const maxY = Math.max(0, window.innerHeight - elementH);
  return {
    x: Math.round(clampPct(xPct) * maxX),
    y: Math.round(clampPct(yPct) * maxY),
  };
}

/**
 * Convert pixel left/top → viewport ratios (0–1).
 * elementW/elementH are the element's current rendered dimensions.
 */
export function pixelsToPct(
  x: number,
  y: number,
  elementW: number,
  elementH: number,
): { xPct: number; yPct: number } {
  const maxX = Math.max(1, window.innerWidth - elementW);
  const maxY = Math.max(1, window.innerHeight - elementH);
  return {
    xPct: clampPct(x / maxX),
    yPct: clampPct(y / maxY),
  };
}

/** Clamp pixel position so element stays fully on-screen. */
export function clampPixels(
  x: number,
  y: number,
  elementW: number,
  elementH: number,
): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - elementW);
  const maxY = Math.max(0, window.innerHeight - elementH);
  return {
    x: Math.max(0, Math.min(maxX, Math.round(x))),
    y: Math.max(0, Math.min(maxY, Math.round(y))),
  };
}
