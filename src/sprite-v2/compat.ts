// sprite-v2/compat.ts - Compatibility layer for old sprite API (canvas-first)

import { canvasToDataUrl } from '../utils/dom/canvasHelpers';
import { log, isVerboseLogsEnabled } from '../utils/logger';
import { getFloraBlueprint } from '../catalogs/gameCatalogs';
import type { SpriteService } from './types';
import { spriteLog } from './diagnostics';

let service: SpriteService | null = null;
let hasLoggedServiceNotReady = false;
let serviceReadyResolve: ((svc: SpriteService | null) => void) | null = null;
export const serviceReady: Promise<SpriteService | null> = new Promise((resolve) => {
  serviceReadyResolve = resolve;
});

// Callbacks waiting for sprites to be ready
const spritesReadyCallbacks: Array<() => void> = [];
let spritesReady = false;

/**
 * Register a callback to be called when sprites are ready.
 * If sprites are already ready, the callback is called immediately.
 * Returns an unsubscribe function.
 */
export function onSpritesReady(callback: () => void): () => void {
  if (spritesReady) {
    // Already ready, call immediately
    try {
      callback();
    } catch (e) {
      spriteLog('error', 'on-sprites-ready-callback', 'onSpritesReady callback failed', {
        error: String((e as Error)?.message ?? e),
      });
    }
    return () => {}; // No-op unsubscribe since already called
  } else {
    spritesReadyCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      const idx = spritesReadyCallbacks.indexOf(callback);
      if (idx !== -1) {
        spritesReadyCallbacks.splice(idx, 1);
      }
    };
  }
}

/**
 * Check if sprites are ready for use.
 */
export function isSpritesReady(): boolean {
  return spritesReady;
}

function notifySpritesReady(): void {
  spritesReady = true;
  for (const cb of spritesReadyCallbacks) {
    try {
      cb();
    } catch (e) {
      spriteLog('error', 'on-sprites-ready-callback', 'onSpritesReady callback failed', {
        error: String((e as Error)?.message ?? e),
      });
    }
  }
  spritesReadyCallbacks.length = 0; // Clear callbacks
}

/**
 * All sprite categories supported by the sprite service API
 * IMPORTANT: Kept for compatibility with callers that iterate categories
 */
const SPRITE_CATEGORIES = ['pet', 'plant', 'tallplant', 'crop', 'item', 'decor', 'seed'] as const;

/**
 * Crop-related categories
 * Used for looking up crops, plants, items, seeds, and some special items stored in 'pet' sheet
 * NOTE: Eggs, bulbs, and tulips may be in 'pet' or 'plant' sprite sheets
 */
const CROP_CATEGORIES = ['plant', 'tallplant', 'crop', 'item', 'decor', 'seed', 'pet'] as const;

const dataUrlCache = new Map<string, string>();
const MAX_DATAURL_CACHE_SIZE = 500;
let hydrationEventListenerBound = false;

function makeCacheKey(category: string, id: string, mutations: string[] = []): string {
  const mutStr = mutations.length > 0 ? mutations.join(',') : '';
  return `${category}:${id}:${mutStr}`;
}

function cacheDataUrl(key: string, value: string | null): string {
  if (!value) return '';
  if (dataUrlCache.has(key)) {
    return dataUrlCache.get(key)!;
  }
  if (dataUrlCache.size >= MAX_DATAURL_CACHE_SIZE) {
    const firstKey = dataUrlCache.keys().next().value;
    if (firstKey !== undefined) {
      dataUrlCache.delete(firstKey);
    }
  }
  dataUrlCache.set(key, value);
  return value;
}

export function clearSpriteDataUrlCache(): void {
  dataUrlCache.clear();
}

/**
 * Invalidate the sprite LRU variant cache for a specific key (or all keys if none given).
 * Also clears the data URL cache.
 * Use after overriding svc.state.tex to ensure stale renders are evicted.
 */
export function invalidateSpriteKeyCache(key?: string): void {
  if (service) {
    const state = service.state;
    if (key) {
      // Per-key removal: delete matching entries and subtract their cost
      let removed = 0;
      for (const [k, entry] of state.lru) {
        if (k === key || k.startsWith(key + '|')) {
          // Estimate cost: 1 per frame (animation frames count individually)
          const entryCost = (entry as any).isAnim
            ? ((entry as any).frames?.length ?? 1)
            : 1;
          removed += entryCost;
          state.lru.delete(k);
        }
      }
      state.cost = Math.max(0, state.cost - removed);
      // srcCan is keyed by PIXI.Texture object; full clear is safe since we just replaced a texture
      state.srcCan.clear();
    } else {
      // Full clear
      state.lru.clear();
      state.cost = 0;
      state.srcCan.clear();
    }
  }
  clearSpriteDataUrlCache();
}

type QpmSpriteDescriptor = {
  kind: 'crop' | 'pet' | 'any' | 'produce' | 'unknown';
  id: string;
  mutations: string[];
};

function parseQpmSpriteDescriptor(raw: string): QpmSpriteDescriptor {
  const value = String(raw || '').trim();
  if (!value) return { kind: 'unknown', id: '', mutations: [] };

  const [kindRaw, idRaw = '', mutRaw = ''] = value.split(':');
  const kind = kindRaw === 'crop' || kindRaw === 'pet' || kindRaw === 'any' || kindRaw === 'produce'
    ? kindRaw
    : 'unknown';
  const mutations = mutRaw
    ? mutRaw.split(',').map((m) => m.trim()).filter(Boolean)
    : [];

  return {
    kind,
    id: idRaw,
    mutations,
  };
}

function applySpriteUrlToElement(el: Element, url: string): boolean {
  if (!url) return false;
  if (el instanceof HTMLImageElement) {
    if (el.src !== url) {
      el.src = url;
    }
    return true;
  }
  if (el instanceof HTMLElement) {
    const next = `url(${url})`;
    if (el.style.backgroundImage !== next) {
      el.style.backgroundImage = next;
    }
    return true;
  }
  return false;
}

export function refreshMarkedSpriteElements(): number {
  let updated = 0;
  const elements = document.querySelectorAll('[data-qpm-sprite]');
  for (const el of elements) {
    const raw = (el as HTMLElement).dataset.qpmSprite || '';
    const parsed = parseQpmSpriteDescriptor(raw);
    if (!parsed.id) continue;

    let url = '';
    switch (parsed.kind) {
      case 'crop':
        url = parsed.mutations.length > 0
          ? getCropSpriteDataUrlWithMutations(parsed.id, parsed.mutations)
          : getCropSpriteDataUrl(parsed.id);
        break;
      case 'pet':
        url = parsed.mutations.length > 0
          ? getPetSpriteDataUrlWithMutations(parsed.id, parsed.mutations)
          : getPetSpriteDataUrl(parsed.id);
        break;
      case 'produce':
        url = parsed.mutations.length > 0
          ? getProduceSpriteDataUrlWithMutations(parsed.id, parsed.mutations)
          : getProduceSpriteDataUrl(parsed.id);
        break;
      case 'any':
        url = getAnySpriteDataUrl(parsed.id);
        break;
      default:
        break;
    }

    if (applySpriteUrlToElement(el, url)) {
      updated++;
    }
  }
  return updated;
}

function ensureHydrationEventListener(): void {
  if (hydrationEventListenerBound) return;
  hydrationEventListenerBound = true;

  window.addEventListener('qpm:sprite-hydration-state-change', () => {
    if (!service) return;
    clearSpriteDataUrlCache();
    const updated = refreshMarkedSpriteElements();
    if (updated > 0 && isVerboseLogsEnabled()) {
      log(`[Sprite Compat] Refreshed ${updated} marked sprite elements after hydration event`);
    }
  });
}

// Legacy compat used data URL caches and warmup; the canvas-first path relies on PIXI's internal cache.
export function setSpriteService(svc: SpriteService): void {
  service = svc;
  hasLoggedServiceNotReady = false;
  ensureHydrationEventListener();
  serviceReadyResolve?.(service);
  notifySpritesReady();
}

/**
 * Normalize species names for consistent sprite lookup
 */
function normalizeSpeciesName(species: string | number): string {
  const str = String(species).trim();
  const lower = str.toLowerCase();

  // Celestial crops - Map display names to internal sprite IDs
  // The sprite manifest uses DawnCelestial/MoonCelestial, not Dawnbinder/Moonbinder
  // Also handle common typos: Dawnbiner, Moobinder
  if (lower === 'dawnbinder' || lower === 'dawncelestial' || lower === 'dawnbiner') return 'DawnCelestial';
  if (lower === 'moonbinder' || lower === 'mooncelestial' || lower === 'moobinder') return 'MoonCelestial';

  // Egg variations - handle singular/plural
  if (lower === 'uncommon egg' || lower === 'uncommon eggs' || lower === 'uncommonegg') return 'UncommonEgg';
  if (lower === 'rare egg' || lower === 'rare eggs' || lower === 'rareegg') return 'RareEgg';
  if (lower === 'legendary egg' || lower === 'legendary eggs' || lower === 'legendaryegg') return 'LegendaryEgg';
  if (lower === 'mythical egg' || lower === 'mythical eggs' || lower === 'mythicalegg') return 'MythicalEgg';

  // Flower variations - handle various naming conventions
  if (lower === 'orange tulip' || lower === 'orangetulip') return 'OrangeTulip';
  if (lower === 'red tulip' || lower === 'redtulip') return 'RedTulip';
  if (lower === 'yellow tulip' || lower === 'yellowtulip') return 'YellowTulip';
  if (lower === 'pink tulip' || lower === 'pinktulip') return 'PinkTulip';
  if (lower === 'purple tulip' || lower === 'purpletulip') return 'PurpleTulip';

  // Cacao / cocoa variants - game uses "Cacao" as the internal sprite name
  // Display names are "Cacao Bean" (seed), "Cacao Plant" (plant), "Cacao Fruit" (fruit)
  if (lower === 'cacaobean' || lower === 'cacaobeans' || lower === 'cacaofruit' || lower === 'cacao' || lower === 'cacao bean' || lower === 'cocoa bean' || lower === 'cocoabean' || lower === 'cacao plant' || lower === 'cacao fruit') return 'Cacao';

  // Starweaver variations
  if (lower === 'starweaver') return 'Starweaver';

  // Handle names with spaces - remove spaces and capitalize properly
  // e.g., "cacao bean" -> "CacaoBean", "burro's tail" -> "BurrosTail"
  if (str.includes(' ')) {
    const normalized = str
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    // Remove apostrophes: "Burro's" -> "Burros"
    return normalized.replace(/'/g, '');
  }

  // If already proper case (first letter uppercase), return as-is
  if (str.charAt(0) === str.charAt(0).toUpperCase()) {
    return str;
  }

  // Otherwise capitalize first letter
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function normalizeMutations(mutations: string[] = []): string[] {
  return (mutations ?? [])
    .map((mut) => String(mut ?? '').trim())
    .filter(Boolean)
    .map((mut) => {
      const lower = mut.toLowerCase();
      if (lower === 'rainbow') return 'Rainbow';
      if (lower === 'gold' || lower === 'golden') return 'Gold';
      return mut.charAt(0).toUpperCase() + mut.slice(1);
    });
}

// Plant sprite atlas key aliases — some plant catalog names differ from their atlas keys.
// E.g. "Rose" in the catalog resolves to "RoseRed" in the plant sprite atlas.
// Atlas keys confirmed from plantCatalog sprite fields (sprite/plant/<key>).
const PLANT_SPRITE_ALIASES: Record<string, string> = {
  Rose: 'RoseRed',
  FourLeafClover: 'CloverFourLeaf',  // catalog: FourLeafClover → atlas: sprite/plant/CloverFourLeaf
  Clover: 'CloverThreeLeaf',         // catalog: Clover → atlas: sprite/plant/CloverThreeLeaf
};

function getIdVariations(category: string, id: string): string[] {
  const variations = [id]; // Try original display name first

  // Celestial crops: manifest uses suffixes
  // - plant category: "DawnCelestialCrop", "MoonCelestialCrop"
  // - tallplant category: "DawnCelestialPlant", "MoonCelestialPlant"
  if (id === 'DawnCelestial' || id === 'MoonCelestial') {
    if (category === 'plant') {
      variations.push(id + 'Crop');
    }
    if (category === 'tallplant') {
      variations.push(id + 'Plant');
    }
  }

  // Color variants: manifest only has base sprite
  // OrangeTulip, RedTulip, etc. all use "Tulip" sprite
  const colorMatch = id.match(/^(Orange|Red|Yellow|Pink|Purple|White)(.+)$/);
  if (colorMatch && colorMatch[2]) {
    variations.push(colorMatch[2]); // Extract base name (e.g., "Tulip")
  }

  // Plant-specific atlas key aliases (plant / tallplant / crop categories only)
  if (category === 'plant' || category === 'tallplant' || category === 'crop') {
    const alias = PLANT_SPRITE_ALIASES[id];
    if (alias) variations.push(alias);
  }

  return variations;
}

function tryRenderCanvas(category: string, id: string, mutations: string[] = []): HTMLCanvasElement | null {
  if (!service) {
    if (!hasLoggedServiceNotReady) {
      hasLoggedServiceNotReady = true;
      spriteLog('warn', 'compat-service-not-ready', 'Sprite service not initialized yet', undefined, {
        onceKey: 'compat-service-not-ready',
      });
    }
    return null;
  }

  try {
    return service.renderToCanvas({ category: category as any, id, mutations });
  } catch (e) {
    spriteLog('warn', 'compat-render-failed', `Sprite render failed for ${category}:${id}`, {
      error: String((e as Error)?.message ?? e),
    });
    return null;
  }
}

function renderAcrossCategories(
  categories: readonly string[],
  id: string,
  mutations: string[] = [],
  includeVariants = false
): HTMLCanvasElement | null {
  const targets = includeVariants ? getIdVariations(categories[0] ?? '', id) : [id];

  for (const category of categories) {
    const ids = includeVariants ? getIdVariations(category, id) : targets;
    for (const variant of ids) {
      const canvas = tryRenderCanvas(category, variant, mutations);
      if (canvas) {
        return canvas;
      }
    }
  }

  return null;
}

/**
 * Gets crop sprite canvas by species name or tile ID (no mutations)
 */
export function getCropSpriteCanvas(speciesOrTile: string | number | null | undefined): HTMLCanvasElement | null {
  if (speciesOrTile == null) return null;
  const id = normalizeSpeciesName(speciesOrTile);
  const canvas = renderAcrossCategories(CROP_CATEGORIES, id, [], true);
  if (canvas) return canvas;
  const bp = getFloraBlueprint(String(speciesOrTile));
  if (bp?.cropSpriteKey) return tryRenderCanvas('any', bp.cropSpriteKey, []);
  return null;
}

/**
 * Gets crop sprite canvas with mutations applied
 */
export function getCropSpriteWithMutations(
  speciesOrTile: string | number | null | undefined,
  mutations: string[] = []
): HTMLCanvasElement | null {
  if (speciesOrTile == null) return null;
  const id = normalizeSpeciesName(speciesOrTile);
  const normalizedMutations = normalizeMutations(mutations);
  const canvas = renderAcrossCategories(CROP_CATEGORIES, id, normalizedMutations, true);
  if (canvas) return canvas;
  const bp = getFloraBlueprint(String(speciesOrTile));
  if (bp?.cropSpriteKey) return tryRenderCanvas('any', bp.cropSpriteKey, normalizedMutations);
  return null;
}

/**
 * Gets crop sprite data URL by species name or tile ID (legacy API)
 */
export function getCropSpriteDataUrl(speciesOrTile: string | number | null | undefined): string {
  const id = speciesOrTile == null ? '' : String(speciesOrTile);
  const key = makeCacheKey('crop', id);
  if (dataUrlCache.has(key)) {
    return dataUrlCache.get(key)!;
  }
  return cacheDataUrl(key, canvasToDataUrl(getCropSpriteCanvas(speciesOrTile)));
}

/**
 * Gets crop sprite data URL with mutations (legacy API)
 */
export function getCropSpriteDataUrlWithMutations(speciesOrTile: string | number, mutations: string[]): string {
  const key = makeCacheKey('crop', String(speciesOrTile), normalizeMutations(mutations));
  if (dataUrlCache.has(key)) {
    return dataUrlCache.get(key)!;
  }
  return cacheDataUrl(key, canvasToDataUrl(getCropSpriteWithMutations(speciesOrTile, mutations)));
}

/**
 * Gets pet sprite canvas
 */
export function getPetSpriteCanvas(species: string): HTMLCanvasElement | null {
  if (!species) return null;
  const normalized = normalizeSpeciesName(species);
  return tryRenderCanvas('pet', normalized, []);
}

/**
 * Gets pet sprite canvas with mutations applied
 */
export function getPetSpriteWithMutations(species: string, mutations: string[] = []): HTMLCanvasElement | null {
  if (!species) return null;
  const normalized = normalizeSpeciesName(species);
  const normalizedMutations = normalizeMutations(mutations);
  return tryRenderCanvas('pet', normalized, normalizedMutations);
}

/**
 * Gets pet sprite data URL by species name (legacy API)
 */
export function getPetSpriteDataUrl(species: string): string {
  const key = makeCacheKey('pet', species);
  if (dataUrlCache.has(key)) {
    return dataUrlCache.get(key)!;
  }
  return cacheDataUrl(key, canvasToDataUrl(getPetSpriteCanvas(species)));
}

/**
 * Gets pet sprite data URL with mutations (legacy API)
 */
export function getPetSpriteDataUrlWithMutations(species: string, mutations: string[]): string {
  const normalizedMutations = normalizeMutations(mutations);
  const key = makeCacheKey('pet', species, normalizedMutations);
  if (dataUrlCache.has(key)) {
    return dataUrlCache.get(key)!;
  }
  return cacheDataUrl(key, canvasToDataUrl(getPetSpriteWithMutations(species, normalizedMutations)));
}

/**
 * Produce-only categories — excludes 'seed' and 'pet' so a plant species like
 * "Rose" resolves to the plant sprite instead of a Rose-colored pet sprite.
 */
const PRODUCE_CATEGORIES = ['plant', 'tallplant', 'crop', 'item', 'decor'] as const;

/**
 * Multi-harvest category order — crop/item FIRST, then plant fallback.
 * Matches the game's own icon logic (addMutationIcons.ts: "Multiple harvest → use crop sprite").
 * For plants like Lychee this returns the fruit/produce sprite instead of the bush.
 */
const MULTIHARVEST_CATEGORIES = ['crop', 'item', 'plant', 'tallplant', 'decor'] as const;

export function getMultiHarvestSpriteDataUrlWithMutations(
  species: string | number,
  mutations: string[]
): string {
  const id = normalizeSpeciesName(species);
  const normalizedMuts = normalizeMutations(mutations);
  const key = makeCacheKey('multiharvest', String(species), normalizedMuts);
  if (dataUrlCache.has(key)) return dataUrlCache.get(key)!;
  return cacheDataUrl(key, canvasToDataUrl(renderAcrossCategories(MULTIHARVEST_CATEGORIES, id, normalizedMuts, true)));
}

/**
 * Render a canvas by exact atlas sprite key (e.g. "sprite/plant/SproutFruit").
 * Uses the "any" category for direct key lookup. Supports mutation overlays.
 */
export function renderBySpriteKey(spriteKey: string, mutations: string[] = []): HTMLCanvasElement | null {
  if (!spriteKey) return null;
  const normalizedMuts = normalizeMutations(mutations);
  return tryRenderCanvas('any', spriteKey, normalizedMuts);
}

/**
 * Render fruit sprite canvas using MULTIHARVEST_CATEGORIES order.
 * Returns the crop/fruit sprite for a multi-harvest species (e.g. a strawberry fruit, not the bush).
 */
export function getMultiHarvestSpriteCanvas(
  species: string | number,
  mutations: string[] = []
): HTMLCanvasElement | null {
  const id = normalizeSpeciesName(species);
  const normalizedMuts = normalizeMutations(mutations);
  return renderAcrossCategories(MULTIHARVEST_CATEGORIES, id, normalizedMuts, true);
}

/**
 * Look up PIXI texture anchor by sprite key. Returns {x, y} or null.
 * Sprite keys follow the pattern "sprite/plant/Strawberry", "sprite/crop/Strawberry", etc.
 */
export function getTextureAnchor(
  spriteKey: string
): { x: number; y: number } | null {
  if (!service) return null;
  const tex = service.state.tex.get(spriteKey);
  if (!tex) return null;
  const anchor = tex.defaultAnchor;
  if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
    return { x: anchor.x, y: anchor.y };
  }
  return null;
}

/**
 * Composite sprite: plant base (bush/tree) + N fruit canvases at slotOffsets.
 * Used to replicate in-game tile appearance for multi-harvest plants.
 * Returns null if sprites aren't ready or species is unknown.
 * Offsets are normalized (multiply × 256 for pixels, matching TILE_SIZE_WORLD).
 * @deprecated Use stitchPlantSprite from sprite-v2/stitcher.ts instead.
 */
export function stitchMultiHarvestCanvas(
  species: string,
  mutations: string[],
  slotOffsets: ReadonlyArray<{ x: number; y: number; rotation?: number }>,
  activeSlotCount: number,
): HTMLCanvasElement | null {
  const id = normalizeSpeciesName(species);
  const normalizedMuts = normalizeMutations(mutations);

  // Base (bush/tree): plant-first order
  const baseCanvas = renderAcrossCategories(PRODUCE_CATEGORIES, id, normalizedMuts, true);
  if (!baseCanvas) return null;

  // Fruit: crop-first order (matches in-game multi-harvest icon logic)
  const fruitCanvas = renderAcrossCategories(MULTIHARVEST_CATEGORIES, id, normalizedMuts, true);

  const SIZE = 256;
  const out = document.createElement('canvas');
  out.width = SIZE;
  out.height = SIZE;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  // Draw base centered
  ctx.drawImage(
    baseCanvas,
    SIZE / 2 - baseCanvas.width / 2,
    SIZE / 2 - baseCanvas.height / 2,
  );

  if (!fruitCanvas) return out; // Base only if no fruit sprite

  // Draw active fruit slots at their normalized offsets (× TILE_SIZE_WORLD = 256)
  const count = Math.min(activeSlotCount, slotOffsets.length);
  for (let i = 0; i < count; i++) {
    const off = slotOffsets[i];
    if (!off) continue;
    const rot = (off.rotation ?? 0) * (Math.PI / 180);
    const dx = SIZE / 2 + off.x * SIZE - fruitCanvas.width / 2;
    const dy = SIZE / 2 + off.y * SIZE - fruitCanvas.height / 2;

    if (rot !== 0) {
      ctx.save();
      ctx.translate(dx + fruitCanvas.width / 2, dy + fruitCanvas.height / 2);
      ctx.rotate(rot);
      ctx.drawImage(fruitCanvas, -fruitCanvas.width / 2, -fruitCanvas.height / 2);
      ctx.restore();
    } else {
      ctx.drawImage(fruitCanvas, dx, dy);
    }
  }

  return out;
}

export function getProduceSpriteCanvas(
  speciesOrTile: string | number | null | undefined
): HTMLCanvasElement | null {
  if (speciesOrTile == null) return null;
  const id = normalizeSpeciesName(speciesOrTile);
  return renderAcrossCategories(PRODUCE_CATEGORIES, id, [], true);
}

export function getProduceSpriteWithMutations(
  speciesOrTile: string | number | null | undefined,
  mutations: string[] = []
): HTMLCanvasElement | null {
  if (speciesOrTile == null) return null;
  const id = normalizeSpeciesName(speciesOrTile);
  const normalizedMutations = normalizeMutations(mutations);
  return renderAcrossCategories(PRODUCE_CATEGORIES, id, normalizedMutations, true);
}

export function getProduceSpriteDataUrl(
  speciesOrTile: string | number | null | undefined
): string {
  const id = speciesOrTile == null ? '' : String(speciesOrTile);
  const key = makeCacheKey('produce', id);
  if (dataUrlCache.has(key)) return dataUrlCache.get(key)!;
  return cacheDataUrl(key, canvasToDataUrl(getProduceSpriteCanvas(speciesOrTile)));
}

export function getProduceSpriteDataUrlWithMutations(
  speciesOrTile: string | number,
  mutations: string[]
): string {
  const normalizedMutations = normalizeMutations(mutations);
  const key = makeCacheKey('produce', String(speciesOrTile), normalizedMutations);
  if (dataUrlCache.has(key)) return dataUrlCache.get(key)!;
  return cacheDataUrl(key, canvasToDataUrl(getProduceSpriteWithMutations(speciesOrTile, mutations)));
}

/**
 * Gets crop sprite canvas by tile ID
 */
export function getCropSpriteByTileId(tileId: string | number | null | undefined): HTMLCanvasElement | null {
  if (tileId == null) return null;
  const id = normalizeSpeciesName(tileId);
  return renderAcrossCategories(['plant', 'tallplant'], id, [], true);
}

/**
 * Gets mutation overlay data URL
 */
export function getMutationOverlayDataUrl(mutation: string): string {
  if (!mutation) return '';
  return canvasToDataUrl(tryRenderCanvas('mutation-overlay', mutation, []));
}

/**
 * Render a sprite by exact runtime key via the "any" category.
 * Example: "ui/Coin", "pet/Cat", "item/WateringCan"
 */
export function getAnySpriteDataUrl(spriteKey: string | null | undefined): string {
  const key = String(spriteKey ?? '').trim();
  if (!key) return '';
  const cacheKey = makeCacheKey('any', key);
  if (dataUrlCache.has(cacheKey)) {
    return dataUrlCache.get(cacheKey)!;
  }
  return cacheDataUrl(cacheKey, canvasToDataUrl(tryRenderCanvas('any', key, [])));
}

/**
 * Renders plant with mutations
 * OLD API: renderPlantWithMutations(base: HTMLCanvasElement, mutations: string[])
 * NOTE: In new system, we need species/id, not a base canvas
 */
export function renderPlantWithMutations(
  baseOrId: HTMLCanvasElement | string,
  mutations: string[]
): HTMLCanvasElement | null {
  if (typeof baseOrId === 'string') {
    const normalized = normalizeSpeciesName(baseOrId);
    const normalizedMutations = normalizeMutations(mutations);
    return tryRenderCanvas('plant', normalized, normalizedMutations);
  }

  // If it's a canvas, we can't easily reverse-engineer the species
  spriteLog(
    'warn',
    'compat-render-plant-with-canvas',
    'renderPlantWithMutations called with canvas; cannot apply mutations without species id'
  );
  return baseOrId;
}

/**
 * Creates sprite element (old API for debug views)
 * OLD API: createSpriteElement(sheet: string, index: number, size?: number)
 */
export function createSpriteElement(sheet: string, index: number, size = 64): HTMLDivElement | null {
  const canvas = tryRenderCanvas('any', `${sheet}/${index}`, []);
  if (!canvas) return null;

  const url = canvasToDataUrl(canvas);
  if (!url) return null;

  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;background:url(${url}) center/contain no-repeat;image-rendering:pixelated;flex-shrink:0;`;
  el.dataset.sheet = sheet;
  el.dataset.index = String(index);
  return el;
}

/**
 * Renders plant sprite
 * OLD API: renderPlantSprite(tileId, species?, mutations?)
 */
export function renderPlantSprite(
  tileId: string | number | null | undefined,
  species?: string | null,
  mutations: string[] = []
): string {
  const id = species || String(tileId ?? '');
  if (!id) return '';
  const normalized = normalizeSpeciesName(id);
  const normalizedMutations = normalizeMutations(mutations);
  return canvasToDataUrl(renderAcrossCategories(['plant', 'tallplant'], normalized, normalizedMutations, true));
}

/**
 * Legacy sprite extractor object for compatibility
 */
export const spriteExtractor = {
  getTile: (sheet: string, index: number): HTMLCanvasElement | null => {
    if (!service) return null;
    try {
      return service.renderToCanvas({ category: 'any', id: `${sheet}/${index}`, mutations: [] });
    } catch (e) {
      return null;
    }
  },

  getCropSprite: (species: string): HTMLCanvasElement | null => getCropSpriteCanvas(species),

  getCropSpriteByTileId,

  getSeedSprite: (seedName: string): HTMLCanvasElement | null => {
    if (!service) return null;
    try {
      return service.renderToCanvas({ category: 'seed', id: seedName, mutations: [] });
    } catch (e) {
      return null;
    }
  },

  getPetSprite: getPetSpriteCanvas,

  renderPlantWithMutations,

  loadSheetFromUrl: async (_url: string, _alias?: string, _forceSize?: 256 | 512): Promise<boolean> => {
    // In new system, all sprites are loaded from manifest automatically
    spriteLog('info', 'compat-deprecated-load-sheet', 'loadSheetFromUrl is deprecated; sprites auto-load from manifest');
    return true;
  },

  init: (): void => {
    spriteLog('info', 'compat-deprecated-init', 'spriteExtractor.init() is deprecated; sprite system initializes automatically');
  },
};

/**
 * Exposes the Sprites object for global access
 */
export const Sprites = {
  init: () => {
    spriteLog('info', 'compat-deprecated-sprites-init', 'Sprites.init() is deprecated');
  },
  clearCaches: () => {
    if (service) {
      (service as any).state?.srcCan?.clear();
      (service as any).state?.lru?.clear();
    }
  },
  lists: () => {
    if (!service) return { all: [], tiles: [] };
    return {
      all: service.list('any').map((it) => it.key),
      tiles: service.list('any').map((it) => it.key),
    };
  },
};

/**
 * Initialize function
 */
export function initSprites(): void {
  spriteLog('info', 'compat-deprecated-init-sprites', 'initSprites() is deprecated; sprite system initializes automatically');
}

// Debug helpers
export async function inspectPetSprites(): Promise<void> {
  if (!service) {
    spriteLog('warn', 'compat-inspect-pets-no-service', 'inspectPetSprites called before service initialization');
    return;
  }

  const pets = service.list('pet');
  spriteLog('info', 'compat-inspect-pets', `Pet sprites loaded: ${pets.length}`, {
    sample: pets.slice(0, 20).map((p) => ({ key: p.key, isAnim: p.isAnim, frames: p.count })),
  });
}

export function renderSpriteGridOverlay(_sheetName = 'plants', _maxTiles = 80): void {
  spriteLog('warn', 'compat-deprecated-grid-overlay', 'renderSpriteGridOverlay is deprecated in sprite-v2');
}

export function renderAllSpriteSheetsOverlay(_maxTilesPerSheet = 80): void {
  spriteLog('warn', 'compat-deprecated-all-overlays', 'renderAllSpriteSheetsOverlay is deprecated in sprite-v2');
}

export function listTrackedSpriteResources(_category = 'all'): Array<{ url: string; families: string[] }> {
  spriteLog('warn', 'compat-deprecated-list-resources', 'listTrackedSpriteResources is deprecated in sprite-v2');
  return [];
}

export function loadTrackedSpriteSheets(_maxSheets = 3, _category = 'all'): Promise<string[]> {
  spriteLog('warn', 'compat-deprecated-load-tracked-sheets', 'loadTrackedSpriteSheets is deprecated in sprite-v2');
  return Promise.resolve([]);
}


