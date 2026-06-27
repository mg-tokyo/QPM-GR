// src/features/standalone/textureSwapper/layerB-prepare.ts
// Layer B rule-index preparation. Extracted from layerB-apply.ts during PR #3
// of the 2026-06-27 texture-swapper perf refactor to keep apply.ts under the
// 750-line hard limit and to give PR #6 a clean home for precomputed RuleEntry
// classification fields (HIGH #10 of the audit).

import {
  ctx,
  parseAtlasKey,
  normalizeSpeciesMatchKey,
} from './types';
import type { TextureOverrideRule } from './types';
import {
  normalizeSpriteKeyCandidate,
  isMutationSpriteKey,
  isPlantBaseSpriteKey,
  makeFrameSignature,
  extractTextureSpriteKeys,
  buildRuntimeTextureRefKeyMap,
} from './matching';
import { isLiveOverlayRule } from './layerB-overlay';
import { isTextureRenderable } from './pixi-walk';
import { getAssetFamilyVariants } from './assetFamily';

export interface RuleEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  origTex: any;
  origSig: string | null;
  targetKeys: Set<string>;
  targetIdLower: string;
  targetMatchKey: string;
  targetSpeciesLower: string;
  rule: TextureOverrideRule;
  /** Null for live-overlay rules — they apply via sprite.tint, not texture replacement. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customTex: any | null;
  /** When true, apply via sprite.tint/scale/alpha instead of swapping sprite.texture. */
  isLiveOverlay: boolean;
  /**
   * Precomputed: this rule targets a crop (id ends with 'crop'). Enables
   * the slot-pattern hint match used for baked crop sprites whose tex.label
   * is gone after bakeSprite() and whose closest entity ancestor is
   * `${species} slot-N`.
   */
  endsWithCrop: boolean;
  /**
   * Asset-family variant sprite keys, mapping lowercase-normalized form →
   * original-case atlas key. Lowercase form matches the sprite key set
   * produced by extractTextureSpriteKeys (which lowercases for case-
   * insensitive matching); original case is needed when we feed the key
   * back into svc.renderToCanvas / parseAtlasKey for a variant-specific
   * mutation rebuild. The rule's own targetSpriteKey is NOT in this map.
   *
   * Layer B uses this to distinguish "matched the base sprite" from
   * "matched a variant the game swapped in for an active/lit/rotated/
   * ornament state", and to bake the customTex against the variant's
   * atlas geometry rather than stretching the base bake. See
   * assetFamily.ts for the mapping source.
   */
  familyVariantKeyByLower: Map<string, string>;
}

export interface LayerBRuleIndex {
  ruleList: RuleEntry[];
  ruleBySpriteKey: Map<string, RuleEntry[]>;
  rulesByFrameSig: Map<string, RuleEntry[]>;
  plantRulesBySpecies: Map<string, RuleEntry>;
  runtimeRefKeys: ReturnType<typeof buildRuntimeTextureRefKeyMap>;
  hasMutationAssetRules: boolean;
}

/**
 * Build the per-rule index Layer B uses to match sprites against rules.
 * Returns null when no rules are applicable (the empty case the apply loop
 * was already short-circuiting on).
 *
 * Pipeline:
 *   1. For each rule, resolve its origTex + customTex (skip rules whose
 *      texture cache is missing) and accumulate every cache key the texture
 *      is reachable under (including animation-frame keys).
 *   2. Build ruleBySpriteKey: a key → rules[] map so Strategy 1 can match
 *      directly by sprite key.
 *   3. Build rulesByFrameSig: a frame-signature → rules[] map so Strategy 2
 *      can match by texture frame coords (handles unlabeled / mid-anim sprites).
 *   4. Build plantRulesBySpecies: a species → rule map so Strategy 4 can
 *      match plant base sprites by their species-normalized key.
 *   5. Build runtimeRefKeys: walks the PIXI cache once and indexes every
 *      texture container so Strategy 5 can resolve runtime refs.
 */
export function buildLayerBRuleIndex(
  rules: ReadonlyArray<TextureOverrideRule>,
): LayerBRuleIndex | null {
  if (rules.length === 0) return null;

  const ruleList: RuleEntry[] = [];
  for (const rule of rules) {
    const isLive = isLiveOverlayRule(rule);

    // SpriteItem for this rule's target. For animated items (atlas.ts:144-152)
    // origItem.frames holds N per-frame textures and origItem.first is frames[0];
    // for static items origItem.first is the single texture.
    const origItem = ctx.currentSvc?.state.items.find(it => it.key === rule.targetSpriteKey) ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let customTex: any | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let origTex: any = null;
    if (isLive) {
      // Live-overlay rules skipped Layer A — fetch origTex straight from the
      // sprite cache so frame-signature matching (strategy #2) still works.
      // For animated items the baseKey isn't in svc.state.tex (only the
      // per-frame keys are), so fall back to origItem.first.
      origTex = ctx.currentSvc?.state.tex.get(rule.targetSpriteKey) ?? origItem?.first ?? null;
      if (!origTex) continue;
    } else {
      customTex = ctx.ruleTextures.get(rule.id);
      if (!customTex || !isTextureRenderable(customTex)) {
        // Scoped rules with cosmetic mutations (or forceNoMutations) skip
        // Layer A entirely, so customTex is never built. Include them
        // anyway — Layer B will build the variant texture on-the-fly using
        // buildVariantTextureForStage. Resolve origTex from the sprite
        // cache (same path as live-overlay rules).
        const hasScopedMutations = rule.scope && rule.scope.kind !== 'all'
          && ((rule.cosmeticMutations?.length ?? 0) > 0 || rule.forceNoMutations);
        if (!hasScopedMutations) continue;
        customTex = null;
        origTex = ctx.currentSvc?.state.tex.get(rule.targetSpriteKey) ?? origItem?.first ?? null;
        if (!origTex) continue;
      } else {
        origTex = ctx.origTextures.get(rule.id);
        if (!origTex) continue;
      }
    }

    const targetKeys = new Set<string>();
    const target = normalizeSpriteKeyCandidate(rule.targetSpriteKey);
    if (target) targetKeys.add(target.toLowerCase());
    for (const key of extractTextureSpriteKeys(origTex)) {
      targetKeys.add(key);
    }
    // Animated items: origTex is just frames[0], so the targetKeys set only
    // sees frame-0's label. Walk every frame and accumulate its labels so
    // Strategy 1 matches the sprite at any animation frame — without this,
    // scale/alpha rules flicker off every refresh tick that fires while the
    // sprite is mid-cycle. atlas.ts assigns each frame texture's label to the
    // exact per-frame key via `t.label = k` at atlas.ts:91, so the labels
    // round-trip through extractTextureSpriteKeys correctly.
    if (origItem?.isAnim && Array.isArray(origItem.frames)) {
      for (const frameTex of origItem.frames) {
        if (!frameTex) continue;
        for (const key of extractTextureSpriteKeys(frameTex)) {
          targetKeys.add(key);
        }
      }
    }

    // Asset-family propagation — base → variants cascade.
    //
    // The game swaps in a different sprite key for the same logical decor /
    // plant / pet when state changes — DawnCelestialPlant → ...Active during
    // a weather event, HayBale → HayBaleSideways when rotated 90°,
    // MiniWizardTower → ...OrnamentDawn during a holiday — and the variant
    // sprite is a *different* atlas entry with *different* trim geometry.
    //
    // We expand targetKeys with every family member so Strategy 1 (sprite-key
    // match) catches the variant sprite. For live-overlay rules the rule's
    // effect (tint / scale / alpha) is texture-agnostic — the variant just
    // gets the same overlay treatment. For non-live rules (mutation /
    // library swap) the walker uses `familyVariantKeyByLower` (populated alongside)
    // to detect "this match was a variant" and rebuild a per-variant texture
    // baked against the variant's atlas geometry (see PASS 1 in apply.ts).
    //
    // One-way contract: only baseKey → variants is in the family map. A rule
    // whose target is already a variant gets `variants === undefined` here,
    // so customised active/lit/rotated assets stay fully decoupled from
    // their base. This matches the user's standing requirement:
    //   "if an active asset is customised, don't couple it with the base."
    const familyVariantKeyByLower = new Map<string, string>();
    const familyMembers = getAssetFamilyVariants(rule.targetSpriteKey);
    if (familyMembers && familyMembers.size > 0) {
      for (const variantKey of familyMembers) {
        // variantKey is the original-case atlas key from svc.state.items.key;
        // we store it as the Map value so PASS 1's mutation rebuild gets the
        // exact key the atlas knows.
        const variantNormalized = normalizeSpriteKeyCandidate(variantKey);
        if (variantNormalized) {
          const lowered = variantNormalized.toLowerCase();
          targetKeys.add(lowered);
          if (!familyVariantKeyByLower.has(lowered)) {
            familyVariantKeyByLower.set(lowered, variantKey);
          }
        }
        const variantTex = ctx.currentSvc?.state.tex.get(variantKey) ?? null;
        if (variantTex) {
          for (const key of extractTextureSpriteKeys(variantTex)) {
            targetKeys.add(key);
            if (!familyVariantKeyByLower.has(key)) {
              familyVariantKeyByLower.set(key, variantKey);
            }
          }
        }
        const variantItem = ctx.currentSvc?.state.items.find(it => it.key === variantKey);
        if (variantItem?.isAnim && Array.isArray(variantItem.frames)) {
          for (const frameTex of variantItem.frames) {
            if (!frameTex) continue;
            for (const key of extractTextureSpriteKeys(frameTex)) {
              targetKeys.add(key);
              if (!familyVariantKeyByLower.has(key)) {
                familyVariantKeyByLower.set(key, variantKey);
              }
            }
          }
        }
      }
    }

    const targetIdLower = parseAtlasKey(rule.targetSpriteKey).id.toLowerCase();
    ruleList.push({
      origTex,
      origSig: makeFrameSignature(origTex),
      targetKeys,
      targetIdLower,
      targetMatchKey: normalizeSpeciesMatchKey(parseAtlasKey(rule.targetSpriteKey).id),
      targetSpeciesLower: targetIdLower.replace(/(seed|plant|baby|fruit|crop)$/i, ''),
      rule,
      customTex,
      isLiveOverlay: isLive,
      endsWithCrop: targetIdLower.endsWith('crop'),
      familyVariantKeyByLower,
    });
  }

  if (ruleList.length === 0) return null;

  const hasMutationAssetRules = ruleList.some((entry) => isMutationSpriteKey(entry.rule.targetSpriteKey));

  // Multi-rule per sprite key — previously first-wins, which silently lost
  // every rule beyond the first sharing a target. E.g., a Rainbow mutation
  // rule and an advanced scale rule both targeting sprite/decor/MarbleArch:
  // the scale rule lost Strategy 1, and Strategy 6's word-boundary regex
  // couldn't match decor sprites because the stripped hint
  // ("spritedecormarblearch") has the targetId surrounded by alphanumerics,
  // never reaching the boundary. Result: scale rule never applied. Multi-rule
  // per key lets Strategy 1 record every rule whose targetKeys contain the
  // sprite's key.
  const ruleBySpriteKey = new Map<string, RuleEntry[]>();
  const rulesByFrameSig = new Map<string, RuleEntry[]>();
  for (const entry of ruleList) {
    for (const key of entry.targetKeys) {
      const arr = ruleBySpriteKey.get(key) ?? [];
      arr.push(entry);
      ruleBySpriteKey.set(key, arr);
    }
    if (entry.origSig) {
      const arr = rulesByFrameSig.get(entry.origSig) ?? [];
      arr.push(entry);
      rulesByFrameSig.set(entry.origSig, arr);
    }
  }

  const plantRulesBySpecies = new Map<string, RuleEntry>();
  for (const entry of ruleList) {
    if (!isPlantBaseSpriteKey(entry.rule.targetSpriteKey)) continue;
    if (!entry.targetMatchKey) continue;
    if (!plantRulesBySpecies.has(entry.targetMatchKey)) {
      plantRulesBySpecies.set(entry.targetMatchKey, entry);
    }
  }

  const runtimeRefKeys = buildRuntimeTextureRefKeyMap();

  return {
    ruleList,
    ruleBySpriteKey,
    rulesByFrameSig,
    plantRulesBySpecies,
    runtimeRefKeys,
    hasMutationAssetRules,
  };
}
