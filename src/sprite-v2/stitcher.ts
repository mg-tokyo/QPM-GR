// sprite-v2/stitcher.ts — Composites multi-harvest plant sprites using runtime blueprint data.
// Renders base plant + N fruit sprites at their catalog-defined slot offsets, matching the game's
// own tile rendering.

import { areCatalogsReady, getFloraBlueprint, getAllPlantSpecies } from '../catalogs/gameCatalogs';
import type { FloraBlueprint } from '../catalogs/gameCatalogs';
import { canvasToDataUrl } from '../utils/dom/canvasHelpers';
import { log } from '../utils/logger';
import {
  isSpritesReady,
  getProduceSpriteCanvas,
  getMultiHarvestSpriteCanvas,
  renderBySpriteKey,
  getTextureAnchor,
  clearSpriteDataUrlCache,
} from './compat';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default output canvas size in pixels. */
const DEFAULT_OUTPUT_SIZE = 256;

/** Maximum cached stitch canvases before FIFO eviction. */
const MAX_STITCH_CACHE = 200;

/** World tile size in pixels (game constant). */
const TILE_SIZE_WORLD = 256;

// ============================================================================
// CACHE
// ============================================================================

const stitchCache = new Map<string, HTMLCanvasElement>();

/** Evict oldest entries when cache exceeds limit. */
function cacheEvict(): void {
  while (stitchCache.size > MAX_STITCH_CACHE) {
    const firstKey = stitchCache.keys().next().value;
    if (firstKey !== undefined) {
      stitchCache.delete(firstKey);
    } else {
      break;
    }
  }
}

function buildCacheKey(
  species: string,
  activeSlotCount: number,
  slotMutations: string[][] | string[],
  slotScales: number[],
  size: number,
): string {
  const mutHash = Array.isArray(slotMutations[0])
    ? (slotMutations as string[][]).map(m => m.join(',')).join(';')
    : (slotMutations as string[]).join(',');
  const scaleHash = slotScales.join(',');
  return `stitch:${species}:${activeSlotCount}:${mutHash}:${scaleHash}:${size}`;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export interface StitchOptions {
  species: string;
  /** Per-slot mutation arrays. Single flat array = same mutations for all slots. */
  slotMutations?: string[][] | string[];
  /** Number of active fruit slots to render. Defaults to all from blueprint. */
  activeSlotCount?: number;
  /**
   * Per-slot growth scales (game's targetScale values). Defaults to 1.0 for all.
   * Ignored when `fullGrowth` is true.
   */
  slotScales?: number[];
  /**
   * Render all fruits at their maximum growth scale (cropMaxScale from blueprint).
   * Convenient for UI previews where you want a "fully mature" display without
   * manually looking up the max scale. Overrides slotScales.
   */
  fullGrowth?: boolean;
  /** Output canvas size in pixels (default 256). */
  size?: number;
  /** Skip cache lookup. */
  noCache?: boolean;
}

export interface StitchResult {
  canvas: HTMLCanvasElement;
  cacheKey: string;
  renderedSlots: number;
  fromCatalog: boolean;
}

/**
 * Composite a multi-harvest plant sprite from runtime blueprint data.
 * Renders the base plant/tree and overlays fruit sprites at catalog-defined positions.
 *
 * Returns null if sprites or catalogs aren't ready, or if the species is unknown.
 */
export function stitchPlantSprite(opts: StitchOptions): StitchResult | null {
  if (!isSpritesReady() || !areCatalogsReady()) return null;

  const {
    species,
    slotMutations = [],
    size = DEFAULT_OUTPUT_SIZE,
    noCache = false,
  } = opts;

  const blueprint = getFloraBlueprint(species);
  if (!blueprint) return null;

  const activeSlotCount = opts.activeSlotCount ?? blueprint.slotCount;

  // When fullGrowth is set, fill all slots with cropMaxScale so fruits render at max size.
  let slotScales: number[];
  if (opts.fullGrowth && blueprint.cropMaxScale && blueprint.cropMaxScale > 0) {
    slotScales = new Array(activeSlotCount).fill(blueprint.cropMaxScale);
  } else {
    slotScales = opts.slotScales ?? [];
  }

  // Cache check
  const cacheKey = buildCacheKey(species, activeSlotCount, slotMutations, slotScales, size);
  if (!noCache && stitchCache.has(cacheKey)) {
    return {
      canvas: stitchCache.get(cacheKey)!,
      cacheKey,
      renderedSlots: activeSlotCount,
      fromCatalog: true,
    };
  }

  // Single-harvest or no slot offsets → render single crop sprite
  if (blueprint.harvestType === 'Single' || blueprint.slotOffsets.length === 0) {
    const mutations = normalizeMutationsArg(slotMutations, 0);
    const canvas = getMultiHarvestSpriteCanvas(species, mutations);
    if (!canvas) return null;

    // Scale to output size if needed
    const out = scaleCanvasToSize(canvas, size);
    stitchCache.set(cacheKey, out);
    cacheEvict();

    return { canvas: out, cacheKey, renderedSlots: 0, fromCatalog: true };
  }

  // Multi-harvest: composite base + fruits
  return renderMultiHarvest(blueprint, opts, activeSlotCount, slotScales, cacheKey, size);
}

/**
 * Convenience: returns a data URL string instead of a canvas.
 */
export function stitchPlantSpriteDataUrl(opts: StitchOptions): string {
  const result = stitchPlantSprite(opts);
  return result ? canvasToDataUrl(result.canvas) : '';
}

/**
 * Clear the stitch cache. Called automatically on sprite hydration events.
 */
export function clearStitchCache(): void {
  stitchCache.clear();
}

export function invalidateSpecies(speciesRoot: string): void {
  const prefix = `stitch:${speciesRoot}:`;
  for (const k of [...stitchCache.keys()]) {
    if (k.startsWith(prefix)) stitchCache.delete(k);
  }
}

let stitchHydrationHandler: (() => void) | null = null;

export function initStitcherHydrationListener(): void {
  if (typeof window === 'undefined' || stitchHydrationHandler) return;
  stitchHydrationHandler = () => { clearStitchCache(); };
  window.addEventListener('qpm:sprite-hydration-state-change', stitchHydrationHandler);
}

export function stopStitcherHydrationListener(): void {
  if (typeof window === 'undefined' || !stitchHydrationHandler) return;
  window.removeEventListener('qpm:sprite-hydration-state-change', stitchHydrationHandler);
  stitchHydrationHandler = null;
}

// ============================================================================
// INTERNAL RENDERING
// ============================================================================

/** Resolve mutations for a specific slot index from the user-provided arg. */
function normalizeMutationsArg(slotMutations: string[][] | string[], slotIndex: number): string[] {
  if (slotMutations.length === 0) return [];
  // If first element is a string, it's a flat array (same mutations for all slots)
  if (typeof slotMutations[0] === 'string') {
    return slotMutations as string[];
  }
  // Per-slot arrays
  const perSlot = slotMutations as string[][];
  return perSlot[slotIndex] ?? perSlot[0] ?? [];
}

function scaleCanvasToSize(source: HTMLCanvasElement, targetSize: number): HTMLCanvasElement {
  if (source.width === targetSize && source.height === targetSize) return source;
  const out = document.createElement('canvas');
  out.width = targetSize;
  out.height = targetSize;
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  const scale = Math.min(targetSize / source.width, targetSize / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.drawImage(source, (targetSize - w) / 2, (targetSize - h) / 2, w, h);
  return out;
}

function renderMultiHarvest(
  blueprint: FloraBlueprint,
  opts: StitchOptions,
  activeSlotCount: number,
  slotScales: number[],
  cacheKey: string,
  outputSize: number,
): StitchResult | null {
  const { species, slotMutations = [] } = opts;

  // Render base plant canvas (bush/tree) by exact sprite key from blueprint.
  // E.g. plantSpriteKey = "sprite/plant/SproutFruit" for Strawberry bush.
  // Falls back to species-name produce lookup if blueprint key is absent.
  const baseCanvas = blueprint.plantSpriteKey
    ? renderBySpriteKey(blueprint.plantSpriteKey)
    : getProduceSpriteCanvas(species);
  if (!baseCanvas) return null;

  // Look up base texture anchor (how the sprite is pinned in world space)
  const baseAnchor = blueprint.plantSpriteKey
    ? getTextureAnchor(blueprint.plantSpriteKey)
    : null;
  const ax = baseAnchor?.x ?? 0.5;
  const ay = baseAnchor?.y ?? 0.5;

  // Render a sample fruit canvas by exact crop sprite key from blueprint.
  // E.g. cropSpriteKey = "sprite/plant/Strawberry" for the fruit.
  // Falls back to multi-harvest category search if blueprint key is absent.
  const sampleMuts = normalizeMutationsArg(slotMutations, 0);
  const fruitCanvas = blueprint.cropSpriteKey
    ? renderBySpriteKey(blueprint.cropSpriteKey, sampleMuts)
    : getMultiHarvestSpriteCanvas(species, sampleMuts);
  if (!fruitCanvas) {
    // No fruit sprite — return base only
    const out = scaleCanvasToSize(baseCanvas, outputSize);
    stitchCache.set(cacheKey, out);
    cacheEvict();
    return { canvas: out, cacheKey, renderedSlots: 0, fromCatalog: true };
  }

  const bw = baseCanvas.width;
  const bh = baseCanvas.height;
  const fw = fruitCanvas.width;
  const fh = fruitCanvas.height;

  // Compute the relative scale of fruit textures vs base.
  // The game applies baseTileScale to each element in world space:
  //   - plantBaseTileScale (e.g. 1.0) for the bush
  //   - cropBaseTileScale  (e.g. 0.25) for each fruit
  // But the atlas textures may be different native sizes, so we compute
  // the world-space ratio and apply it to the fruit canvas dimensions.
  const baseScale = blueprint.plantBaseTileScale || 1;
  const cropScale = blueprint.cropBaseTileScale ?? 0.5;
  const fruitBaseRatio = cropScale / baseScale;

  // Compute anchor offset: how far the texture origin is from its center
  const anchorOffX = (0.5 - ax) * bw;
  const anchorOffY = (0.5 - ay) * bh;

  // Compute bounding box encompassing base + all fruit positions.
  // All coordinates are in "base-texture pixels" space.
  // Base bbox (pinned at anchor origin):
  let minX = -ax * bw;
  let minY = -ay * bh;
  let maxX = (1 - ax) * bw;
  let maxY = (1 - ay) * bh;

  const count = Math.min(activeSlotCount, blueprint.slotOffsets.length);
  for (let i = 0; i < count; i++) {
    const off = blueprint.slotOffsets[i];
    if (!off) continue;

    const perSlotScale = slotScales[i] ?? 1;
    const effectiveFruitScale = fruitBaseRatio * perSlotScale;
    const scaledFw = fw * effectiveFruitScale;
    const scaledFh = fh * effectiveFruitScale;

    // Fruit center in base-texture pixel space
    const cx = off.x * TILE_SIZE_WORLD + anchorOffX;
    const cy = off.y * TILE_SIZE_WORLD + anchorOffY;

    minX = Math.min(minX, cx - scaledFw / 2);
    minY = Math.min(minY, cy - scaledFh / 2);
    maxX = Math.max(maxX, cx + scaledFw / 2);
    maxY = Math.max(maxY, cy + scaledFh / 2);
  }

  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  // Scale factor to fit everything inside outputSize with 4% padding
  const fitScale = Math.min(outputSize / bboxW, outputSize / bboxH) * 0.92;

  // Create output canvas
  const out = document.createElement('canvas');
  out.width = outputSize;
  out.height = outputSize;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  // Offset so the bounding box is centered in the output canvas
  const originX = outputSize / 2 - ((minX + maxX) / 2) * fitScale;
  const originY = outputSize / 2 - ((minY + maxY) / 2) * fitScale;

  // Draw base at its anchor origin (no mutations on the base plant)
  const baseDrawX = originX - ax * bw * fitScale;
  const baseDrawY = originY - ay * bh * fitScale;
  ctx.drawImage(baseCanvas, baseDrawX, baseDrawY, bw * fitScale, bh * fitScale);

  // Draw each active fruit slot
  for (let i = 0; i < count; i++) {
    const off = blueprint.slotOffsets[i];
    if (!off) continue;

    // Render fruit with per-slot mutations via exact crop sprite key
    const mutations = normalizeMutationsArg(slotMutations, i);
    let slotFruitCanvas: HTMLCanvasElement;
    if (i === 0 && mutations === sampleMuts) {
      slotFruitCanvas = fruitCanvas;
    } else if (blueprint.cropSpriteKey) {
      slotFruitCanvas = renderBySpriteKey(blueprint.cropSpriteKey, mutations) ?? fruitCanvas;
    } else {
      slotFruitCanvas = getMultiHarvestSpriteCanvas(species, mutations) ?? fruitCanvas;
    }

    const perSlotScale = slotScales[i] ?? 1;
    const effectiveFruitScale = fruitBaseRatio * perSlotScale;
    const scaledFw = slotFruitCanvas.width * effectiveFruitScale * fitScale;
    const scaledFh = slotFruitCanvas.height * effectiveFruitScale * fitScale;

    // Fruit center in output coordinates
    const cx = originX + (off.x * TILE_SIZE_WORLD + anchorOffX) * fitScale;
    const cy = originY + (off.y * TILE_SIZE_WORLD + anchorOffY) * fitScale;
    const rot = (off.rotation ?? 0) * (Math.PI / 180);

    if (rot !== 0) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.drawImage(slotFruitCanvas, -scaledFw / 2, -scaledFh / 2, scaledFw, scaledFh);
      ctx.restore();
    } else {
      ctx.drawImage(slotFruitCanvas, cx - scaledFw / 2, cy - scaledFh / 2, scaledFw, scaledFh);
    }
  }

  stitchCache.set(cacheKey, out);
  cacheEvict();

  return { canvas: out, cacheKey, renderedSlots: count, fromCatalog: true };
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

const warnedSpecies = new Set<string>();

/**
 * Log flora blueprints for a single species or all species to console.
 */
export function diagnoseFloraBlueprints(species?: string): void {
  if (!areCatalogsReady()) {
    console.warn('[QPM Stitcher] Catalogs not ready');
    return;
  }

  if (species) {
    const bp = getFloraBlueprint(species);
    if (!bp) {
      console.warn(`[QPM Stitcher] No blueprint for "${species}"`);
      return;
    }
    console.log(`[QPM Stitcher] Blueprint for ${species}:`, bp);
    return;
  }

  // All species summary
  const all = getAllPlantSpecies();
  const rows: Array<Record<string, unknown>> = [];
  for (const sp of all) {
    const bp = getFloraBlueprint(sp);
    if (!bp) continue;
    rows.push({
      species: sp,
      harvestType: bp.harvestType,
      slots: bp.slotCount,
      plantScale: bp.plantBaseTileScale,
      cropMaxScale: bp.cropMaxScale,
      cropSellPrice: bp.cropBaseSellPrice,
      origin: bp.tileTransformOrigin,
      matureTime: bp.secondsToMature,
    });
  }
  console.table(rows);
  log(`[Stitcher] Diagnosed ${rows.length} flora blueprints`);
}

/**
 * Render and display a stitched sprite as a DOM overlay for visual inspection.
 */
export function testStitch(species: string, mutations?: string[]): HTMLCanvasElement | null {
  const result = stitchPlantSprite({
    species,
    slotMutations: mutations ?? [],
    fullGrowth: true,
    size: DEFAULT_OUTPUT_SIZE,
    noCache: true,
  });

  if (!result) {
    console.warn(`[QPM Stitcher] testStitch failed for "${species}"`);
    return null;
  }

  const bp = getFloraBlueprint(species);

  // Create overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 999999;
    background: rgba(0,0,0,0.92); padding: 16px; border-radius: 8px;
    border: 1px solid rgba(143,130,255,0.5); color: #e8e0ff;
    font-family: monospace; font-size: 12px;
  `;

  const title = document.createElement('div');
  title.textContent = `${species} — ${bp?.harvestType ?? '?'} (${result.renderedSlots} slots)`;
  title.style.cssText = 'margin-bottom: 8px; font-weight: bold; font-size: 14px;';
  overlay.appendChild(title);

  result.canvas.style.cssText = 'border: 1px solid rgba(143,130,255,0.3); image-rendering: pixelated;';
  overlay.appendChild(result.canvas);

  const info = document.createElement('div');
  info.style.cssText = 'margin-top: 8px; opacity: 0.7;';
  info.textContent = `${result.canvas.width}×${result.canvas.height} | fromCatalog: ${result.fromCatalog}`;
  overlay.appendChild(info);

  const close = document.createElement('button');
  close.textContent = 'Close';
  close.style.cssText = 'margin-top: 8px; cursor: pointer; padding: 4px 12px;';
  close.onclick = () => overlay.remove();
  overlay.appendChild(close);

  document.body.appendChild(overlay);
  console.log(`[QPM Stitcher] testStitch rendered for "${species}"`, result);

  return result.canvas;
}

/**
 * Render a grid of all multi-harvest species for visual comparison.
 */
export function testStitchAll(): HTMLDivElement | null {
  if (!areCatalogsReady() || !isSpritesReady()) {
    console.warn('[QPM Stitcher] Not ready');
    return null;
  }

  const all = getAllPlantSpecies();
  const multiHarvest = all.filter(sp => {
    const bp = getFloraBlueprint(sp);
    return bp && bp.harvestType === 'Multiple' && bp.slotOffsets.length > 0;
  });

  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; top: 20px; left: 20px; z-index: 999999;
    background: rgba(0,0,0,0.95); padding: 16px; border-radius: 8px;
    border: 1px solid rgba(143,130,255,0.5); color: #e8e0ff;
    font-family: monospace; max-height: 90vh; overflow-y: auto;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center;';
  header.innerHTML = `<span style="font-weight:bold;font-size:14px;">Multi-Harvest Species (${multiHarvest.length})</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'cursor: pointer; padding: 4px 12px;';
  closeBtn.onclick = () => container.remove();
  header.appendChild(closeBtn);
  container.appendChild(header);

  for (const sp of multiHarvest) {
    const result = stitchPlantSprite({ species: sp, fullGrowth: true, size: 128, noCache: true });
    if (!result) continue;

    const cell = document.createElement('div');
    cell.style.cssText = 'text-align: center;';

    result.canvas.style.cssText = 'border: 1px solid rgba(143,130,255,0.2); image-rendering: pixelated; width: 128px; height: 128px;';
    cell.appendChild(result.canvas);

    const bp = getFloraBlueprint(sp);
    const label = document.createElement('div');
    label.style.cssText = 'font-size: 11px; margin-top: 4px; opacity: 0.8;';
    label.textContent = `${sp} (${bp?.slotCount ?? '?'})`;
    cell.appendChild(label);

    container.appendChild(cell);
  }

  document.body.appendChild(container);
  console.log(`[QPM Stitcher] testStitchAll: rendered ${multiHarvest.length} species`);

  return container;
}
