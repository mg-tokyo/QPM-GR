import type { GetSpriteParams, SpriteState, SpriteConfig, SpriteCategory, SpriteItem } from './types';
import { normalizeKey, baseNameOf } from './utils';
import { buildVariantFromMutations, renderMutatedTexture } from './renderer';
import { cacheGet, cacheSet } from './cache';

const categoryAlias: Record<string, string[]> = {
  plant: ['plant'],
  tallplant: ['tallplant'],
  crop: ['crop'],
  decor: ['decor'],
  item: ['item'],
  pet: ['pet'],
  seed: ['seed'],
  mutation: ['mutation'],
  'mutation-overlay': ['mutation-overlay'],
  any: [],
};

function keyCategoryOf(key: string): string {
  const parts = key.split('/').filter(Boolean);
  if (parts[0] === 'sprite' || parts[0] === 'sprites') return parts[1] ?? '';
  return parts[0] ?? '';
}

// --- Lookup maps ---------------------------------------------------------
// findItem previously scanned state.items (1000-3000 entries) linearly per
// lookup with normalizeKey recomputed per entry. Build once per state.items
// rebuild and cache misses per (category, id).
type CategoryBucket = {
  byNormFull: Map<string, SpriteItem>;
  byNormBase: Map<string, SpriteItem>;
};

let cachedLookupState: SpriteState | null = null;
let cachedLookupItemCount = -1;
const categoryLookupMaps = new Map<string, CategoryBucket>();
const missCache = new Map<string, true>();
const MISS_CACHE_MAX = 2000;

function ensureLookupMaps(state: SpriteState): void {
  if (state === cachedLookupState && state.items.length === cachedLookupItemCount) return;
  categoryLookupMaps.clear();
  missCache.clear();
  cachedLookupState = state;
  cachedLookupItemCount = state.items.length;
  for (const it of state.items) {
    const normCat = normalizeKey(keyCategoryOf(it.key));
    let bucket = categoryLookupMaps.get(normCat);
    if (!bucket) {
      bucket = { byNormFull: new Map(), byNormBase: new Map() };
      categoryLookupMaps.set(normCat, bucket);
    }
    const normFull = normalizeKey(String(it.key || '').replace(/^\/+/, ''));
    if (!bucket.byNormFull.has(normFull)) bucket.byNormFull.set(normFull, it);
    const normBase = normalizeKey(baseNameOf(it.key));
    if (!bucket.byNormBase.has(normBase)) bucket.byNormBase.set(normBase, it);
  }
}

function categoryBucketsFor(category: SpriteCategory): CategoryBucket[] {
  if (category === 'any') return Array.from(categoryLookupMaps.values());
  const aliases = categoryAlias[category] || [category];
  const result: CategoryBucket[] = [];
  for (const alias of aliases) {
    const b = categoryLookupMaps.get(normalizeKey(alias));
    if (b) result.push(b);
  }
  return result;
}

function recordMiss(missKey: string): void {
  missCache.set(missKey, true);
  if (missCache.size > MISS_CACHE_MAX) {
    const firstKey = missCache.keys().next().value;
    if (firstKey !== undefined) missCache.delete(firstKey);
  }
}

function findItem(state: SpriteState, category: SpriteCategory, id: string): SpriteItem | null {
  ensureLookupMaps(state);
  const normId = normalizeKey(id);
  const normFullId = normalizeKey(String(id || '').replace(/^\/+/, ''));
  const missKey = `${category}|${normFullId}`;
  if (missCache.has(missKey)) return null;

  const buckets = categoryBucketsFor(category);

  for (const bucket of buckets) {
    const it = bucket.byNormFull.get(normFullId);
    if (it) return it;
  }
  for (const bucket of buckets) {
    const it = bucket.byNormBase.get(normId);
    if (it) return it;
  }
  // Prefix-match fallback: "ChrysanthemumBush" matches species "Chrysanthemum"
  for (const bucket of buckets) {
    for (const [base, it] of bucket.byNormBase) {
      if (base.length > normId.length && base.length - normId.length <= 6 && base.startsWith(normId)) {
        return it;
      }
    }
  }

  recordMiss(missKey);
  return null;
}

export function listItemsByCategory(state: SpriteState, category: SpriteCategory = 'any'): SpriteItem[] {
  if (category === 'any') return state.items.slice();
  ensureLookupMaps(state);
  const buckets = categoryBucketsFor(category);
  const out: SpriteItem[] = [];
  const seen = new Set<SpriteItem>();
  for (const bucket of buckets) {
    for (const it of bucket.byNormFull.values()) {
      if (seen.has(it)) continue;
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

export function buildVariant(mutations: string[]) {
  return buildVariantFromMutations(mutations);
}

export function getSpriteWithMutations(params: GetSpriteParams, state: SpriteState, cfg: SpriteConfig): any {
  const it = findItem(state, params.category, params.id);
  if (!it) return null;

  const tex = it.isAnim ? it.frames?.[0] : it.first;
  if (!tex) return null;

  const V = buildVariantFromMutations(params.mutations || []);

  // Fast path: zero-mutation renders are just the base texture — no compositing
  // needed. Skips cache lookup + Texture.from + 2× canvas allocation per call.
  if (V.muts.length === 0 && V.overlayMuts.length === 0 && V.selectedMuts.length === 0) {
    return tex;
  }

  const cacheKey = `${it.key}|${V.sig}`;
  const cached = cacheGet(state, cacheKey);
  if (cached) {
    return cached.isAnim ? (cached.frames?.[0] ?? null) : (cached.tex ?? null);
  }

  const rendered = renderMutatedTexture(tex, it.key, V, state, cfg);

  if (rendered) {
    cacheSet(state, cfg, cacheKey, {
      isAnim: false,
      tex: rendered
    });
  }

  return rendered;
}

export function getBaseSprite(params: GetSpriteParams, state: SpriteState): any {
  const it = findItem(state, params.category, params.id);
  if (!it) return null;

  return it.isAnim ? it.frames?.[0] ?? null : it.first;
}
