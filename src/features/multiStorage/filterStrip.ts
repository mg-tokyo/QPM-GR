// The game picks the wide filter strip from the real window size, so in a narrow panel it overflows; this
// shrinks it to fit. Measuring the strip costs a getBounds per control, so it runs only after the strip changed.
import { walkScene } from '../../core/pixiScene';
import type { PixiNode } from './gameHooks';

const STRIP_PADDING_PX = 10;
// The game lays the strip out in the frame it changes; a few more fits cover controls that size themselves late.
const REFIT_FRAMES = 3;

let fitCount = 0;

/** Live-check readout: strip fits measured since page load (still panels add none). */
export function getStripFitCount(): number {
  return fitCount;
}

export function findStrip(host: PixiNode): PixiNode | null {
  let found: PixiNode | null = null;
  walkScene(host, (node): boolean | void => {
    if (node.label !== 'FilterContainer') return;
    found = node as unknown as PixiNode;
    return true;
  }, { maxDepth: 3 });
  return found;
}

/** Shrinks the strip about its bottom-left corner until it fits; the backdrop is counter-scaled to keep its width. */
export function fitFilterStrip(strip: PixiNode): void {
  const backdrop = strip.children[0];
  if (!strip.visible || !backdrop) return;
  const scale = strip.scale.x || 1;
  const backdropBounds = backdrop.getBounds();
  const naturalWidth = backdropBounds.width / (scale * (backdrop.scale.x || 1));
  const naturalHeight = backdropBounds.height / (scale * (backdrop.scale.y || 1));
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return;
  const originX = strip.getGlobalPosition().x;
  // The last child is the reset button pinned to the right edge; with no room it covers the sort button.
  const reset = strip.children.length > 2 ? strip.children[strip.children.length - 1] ?? null : null;
  let contentRight = 0;
  for (let i = 1; i < strip.children.length; i += 1) {
    const child = strip.children[i];
    if (!child || child === reset || !child.visible) continue;
    const bounds = child.getBounds();
    // Skips empty tooltips and the search box once it has collapsed to a sliver.
    if (bounds.width < 10 * scale) continue;
    contentRight = Math.max(contentRight, (bounds.x + bounds.width - originX) / scale);
  }
  const resetWidth = reset ? reset.getBounds().width / scale : 0;
  const crowded = contentRight + resetWidth + 2 * STRIP_PADDING_PX > naturalWidth;
  if (reset) reset.renderable = !crowded;
  const fit = crowded ? Math.min(1, naturalWidth / (contentRight + STRIP_PADDING_PX)) : 1;
  const next = fit > 0.98 ? 1 : fit;
  if (Math.abs(next - scale) < 0.005) return;
  const pivotY = naturalHeight * (1 - 1 / next);
  strip.scale.set(next);
  strip.pivot.y = pivotY;
  backdrop.scale.set(1 / next);
  backdrop.y = pivotY;
}

/**
 * What the strip's layout depends on (beta itemSheet/SheetFilterStrip.ts layout(): the sheet width; the search
 * box hides its text child while typing). The fit's own writes (scale, pivot, reset.renderable) are not in it.
 */
export function stripKey(strip: PixiNode, sheetWidthPx: number | undefined): string {
  let key = `${strip.visible ? 1 : 0}|${sheetWidthPx ?? ''}|${strip.children.length}|`;
  for (const child of strip.children) key += child.visible ? '1' : '0';
  return key;
}

/** One panel's strip, refitted for a few frames after it changed and left alone while it sits still. */
export function createStripFitter(host: PixiNode, sheetWidthPx: () => number | undefined): () => void {
  let strip: PixiNode | null = null;
  let key = '';
  let frames = 0;
  return () => {
    if (host.destroyed) return;
    if (!strip || strip.destroyed) {
      strip = findStrip(host);
      key = '';
      if (!strip) return;
    }
    const next = stripKey(strip, sheetWidthPx());
    if (next !== key) {
      key = next;
      frames = REFIT_FRAMES;
    }
    if (frames === 0) return;
    frames -= 1;
    fitCount += 1;
    fitFilterStrip(strip);
  };
}
