// src/features/standalone/textureSwapper/assetFamily.ts
//
// Asset-family detection — links a "base" sprite (DawnCelestialPlant) to its
// runtime variants (DawnCelestialPlantActive triggered by weather, HayBale →
// HayBaleSideways when rotated, MiniWizardTower → MiniWizardTowerOrnamentDawn
// when a holiday event swaps the texture, etc.).
//
// Built once after sprite-v2 is ready by walking svc.state.items and pairing
// each entry whose id ends in a known variant suffix to a sibling entry that
// is its strict prefix at a capital-letter split point. One-way only:
//
//   rule on BASE        → cascades to every variant
//   rule on VARIANT     → does NOT cascade back to base (user explicitly opted
//                         into customising the variant)
//
// Suffix categories sourced from runtime catalog spot-checks documented in
// the 2026-06-27 conversation:
//
//   EXACT  : Active, Lit, On, Off, Sideways, Backwards
//            — sprite/plant/DawnCelestialPlant ↔ ...Active
//              sprite/decor/MiniFairyCastle    ↔ ...Lit
//              sprite/decor/HayBale            ↔ ...Sideways / ...Backwards
//
//   PREFIX : Ornament
//            — sprite/decor/MiniWizardTower    ↔ ...OrnamentDawn / ...OrnamentAmberMoon
//
// Consumer: layerB-prepare.ts (live-overlay rules only in this PR; mutation-/
// swap-rule cascade will need per-variant customTex at Layer A and is a
// follow-up).
//
// Standing rule: NEVER commit, NEVER push.

import type { SpriteService } from './types';
import { log } from './types';

const EXACT_VARIANT_SUFFIXES = new Set<string>([
  'Active',
  'Lit',
  'On',
  'Off',
  'Sideways',
  'Backwards',
]);

const PREFIX_VARIANT_SUFFIXES = ['Ornament'] as const;

// Module-scope state. Cleared on stop via clearAssetFamily().
let familyByBase = new Map<string, Set<string>>();
let parentByVariant = new Map<string, string>();
let isInitialized = false;

/**
 * Walk svc.state.items once and build the base→variants map. Idempotent —
 * safe to call again on catalog refresh; we replace the map atomically.
 */
export function initAssetFamily(svc: SpriteService): void {
  try {
    const items = svc?.state?.items;
    if (!Array.isArray(items) || items.length === 0) {
      familyByBase = new Map();
      parentByVariant = new Map();
      isInitialized = true;
      return;
    }

    const allKeys = new Set<string>();
    for (const it of items) {
      if (it?.key) allKeys.add(it.key);
    }

    const nextFamilyByBase = new Map<string, Set<string>>();
    const nextParentByVariant = new Map<string, string>();
    let pairCount = 0;

    for (const it of items) {
      const key = it?.key;
      if (!key) continue;
      const parent = detectFamilyParent(key, allKeys);
      if (!parent || parent === key) continue;
      let variants = nextFamilyByBase.get(parent);
      if (!variants) {
        variants = new Set<string>();
        nextFamilyByBase.set(parent, variants);
      }
      if (!variants.has(key)) {
        variants.add(key);
        nextParentByVariant.set(key, parent);
        pairCount++;
      }
    }

    familyByBase = nextFamilyByBase;
    parentByVariant = nextParentByVariant;
    isInitialized = true;
    log(`assetFamily: built ${nextFamilyByBase.size} base→variants groups (${pairCount} pairs) from ${items.length} sprite items`);
  } catch (e) {
    log('assetFamily: init failed', e);
    familyByBase = new Map();
    parentByVariant = new Map();
    isInitialized = true;
  }
}

/**
 * Return the variant sprite keys for a base key, or undefined when the base
 * has no variants. Returns the live Set reference — DO NOT mutate.
 */
export function getAssetFamilyVariants(baseKey: string): ReadonlySet<string> | undefined {
  return familyByBase.get(baseKey);
}

/**
 * Return the base sprite key that this variant belongs to, or undefined when
 * `key` is itself a base (or wasn't detected as a variant). Used by callers
 * that need to walk variant → base.
 */
export function getAssetFamilyParent(variantKey: string): string | undefined {
  return parentByVariant.get(variantKey);
}

/** True once initAssetFamily has run (succeeded or no-oped). */
export function isAssetFamilyReady(): boolean {
  return isInitialized;
}

/** Reset state on textureSwapper teardown. */
export function clearAssetFamily(): void {
  familyByBase = new Map();
  parentByVariant = new Map();
  isInitialized = false;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Walk the id right-to-left, preferring the longest matching prefix that is
 * itself a catalog entry. Returns the parent's full sprite key, or null when
 * the id is not a recognised variant.
 *
 * Why longest-match: when both `MiniWizardTower` and (hypothetically)
 * `MiniWizardTowerOrnament` exist, a Dawn-coloured variant should anchor to
 * the deeper parent if it is also a real catalog entity. Splits where the
 * suffix is not on the allowlist are skipped, so the next-shorter prefix
 * gets a chance.
 */
function detectFamilyParent(itemKey: string, allKeys: Set<string>): string | null {
  const lastSlash = itemKey.lastIndexOf('/');
  if (lastSlash < 0) return null;
  const pathPrefix = itemKey.slice(0, lastSlash + 1);
  const id = itemKey.slice(lastSlash + 1);
  if (id.length < 2) return null;

  for (let i = id.length - 1; i >= 1; i--) {
    if (!isUpperAscii(id.charCodeAt(i))) continue;
    const parentId = id.slice(0, i);
    const suffix = id.slice(i);
    if (!isVariantSuffix(suffix)) continue;
    const parentKey = pathPrefix + parentId;
    if (allKeys.has(parentKey)) return parentKey;
  }
  return null;
}

function isVariantSuffix(suffix: string): boolean {
  if (EXACT_VARIANT_SUFFIXES.has(suffix)) return true;
  for (const p of PREFIX_VARIANT_SUFFIXES) {
    if (suffix.length > p.length && suffix.startsWith(p)) {
      // Require what follows the prefix to start with a capital so we don't
      // match accidental partial words ("Ornamentation").
      if (isUpperAscii(suffix.charCodeAt(p.length))) return true;
    }
  }
  return false;
}

function isUpperAscii(code: number): boolean {
  return code >= 0x41 && code <= 0x5A;
}
