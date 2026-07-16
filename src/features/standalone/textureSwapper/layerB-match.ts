import { parseAtlasKey } from './types';
import type {
  SpriteVariantInfo,
  PlantSpriteContext,
} from './types';
import type { LayerBRuleIndex, RuleEntry } from './layerB-prepare';
import { extractTileKeyFromSprite, resolveSlotIndexForPetSprite } from './matching';
import {
  normalizeSpriteKeyCandidate,
  makeFrameSignature,
  extractTextureSpriteKeys,
  extractTextureHintStrings,
  extractSpriteNodeSpriteKeys,
  extractSpriteHintStrings,
  extractSpriteClosestLabelHints,
  extractVariantInfoFromTexture,
  extractVariantInfoFromSpriteNode,
  extractPlantContextFromSprite,
  extractMutationPrefixedPlantMatchFromKey,
  extractAncestorSpeciesHints,
  normalizeHintForSearch,
  hintMentionsSlotForSpecies,
  parseSlotIndexFromHint,
  parseSlotContainerHint,
  ruleCanApplyToSprite,
  spriteLooksLikeMutationAsset,
} from './matching';
import { isRiveSprite } from './riveAdapter';
import { isNineSliceOrTiledSprite } from './layerB-apply-helpers';

export interface MatchState {
  index: LayerBRuleIndex;
  hintNormCache: Map<string, string>;
  plantCtxMemo: WeakMap<object, PlantSpriteContext | null>;
  tileKeyMemo: WeakMap<object, string | null>;
  slotIndexMemo: WeakMap<object, 0 | 1 | 2 | null>;
}

export interface MatchResult {
  matches: RuleEntry[];
  isRive: boolean;
  spriteKeys: Set<string>;
  inferredMutations: string[];
  getVariant: () => SpriteVariantInfo | null;
  getPlantContext: () => PlantSpriteContext | null;
  plantContextMatches: number;
  mutationPrefixMatches: number;
  hintIdMatches: number;
  skippedMutationOverlayForBaseRule: number;
}

/**
 * Match one sprite against the rule index via 7 escalating strategies plus
 * scope filter. Returns matched rules + per-sprite lazy accessors so the
 * caller (dispatcher + apply passes) can reuse the same closures without
 * recomputing variant / plant-context data.
 */
export function matchSpriteToRules(sprite: any, mstate: MatchState): MatchResult {
  const {
    index: {
      ruleList,
      ruleBySpriteKey,
      rulesByFrameSig,
      plantRulesBySpecies,
      runtimeRefKeys,
    },
    hintNormCache,
    plantCtxMemo,
    tileKeyMemo,
    slotIndexMemo,
  } = mstate;

  const matches: RuleEntry[] = [];
  const matchedIds = new Set<string>();
  let inferredMutations: string[] = [];
  let plantContextMatches = 0;
  let mutationPrefixMatches = 0;
  let hintIdMatches = 0;
  let skippedMutationOverlayForBaseRule = 0;

  // Hoisted from after Strategy 6 (where it used to live before PASS 1) so
  // Strategy 6 can branch on Rive-vs-not. Rive pet sprites have intermediate
  // wrapper containers between them and the labeled PetView ancestor, so
  // the "closest labeled ancestor" hint scope misses the pet name — leaving
  // live-overlay tint/scale/transparency rules unmatched. See Strategy 6
  // comment block for the original (non-Rive) cascade-prevention rationale.
  const isRive = isRiveSprite(sprite);

  const recordMatch = (entry: RuleEntry, via?: 'plantContext' | 'mutationPrefix' | 'hintId'): void => {
    if (matchedIds.has(entry.rule.id)) return;
    matchedIds.add(entry.rule.id);
    matches.push(entry);
    if (via === 'plantContext') plantContextMatches++;
    else if (via === 'mutationPrefix') mutationPrefixMatches++;
    else if (via === 'hintId') hintIdMatches++;
  };

  // Lazy extraction — expensive data only computed on first access.
  // Most sprites fail Strategy 1 and never need hints/variant/plantContext.
  let _variant: SpriteVariantInfo | null | undefined;
  const getVariant = (): SpriteVariantInfo | null => {
    if (_variant === undefined) {
      _variant = extractVariantInfoFromTexture(sprite.texture) ?? extractVariantInfoFromSpriteNode(sprite);
    }
    return _variant;
  };
  let _plantContext: PlantSpriteContext | null | undefined;
  const getPlantContext = (): PlantSpriteContext | null => {
    if (_plantContext === undefined) {
      _plantContext = plantRulesBySpecies.size > 0 ? extractPlantContextFromSprite(sprite, plantCtxMemo) : null;
    }
    return _plantContext;
  };
  let _spriteHints: string[] | null = null;
  const getSpriteHints = (): string[] => {
    if (!_spriteHints) {
      _spriteHints = [
        ...extractTextureHintStrings(sprite.texture),
        ...extractSpriteHintStrings(sprite),
      ];
    }
    return _spriteHints;
  };
  const spriteKeys = new Set<string>(extractTextureSpriteKeys(sprite.texture));
  for (const key of extractSpriteNodeSpriteKeys(sprite)) {
    spriteKeys.add(key);
  }
  const byRef = runtimeRefKeys.get(sprite.texture as object);
  if (byRef) {
    for (const key of byRef) {
      spriteKeys.add(key);
    }
  }
  const bySourceRef = runtimeRefKeys.get((sprite.texture?.source ?? null) as object);
  if (bySourceRef) {
    for (const key of bySourceRef) {
      spriteKeys.add(key);
    }
  }
  // Cache mutation-asset classification once per sprite (was recomputed per
  // (sprite, rule) pair in ruleCanApplyToSprite).
  let _isMutationAsset: boolean | undefined;
  const isMutationAsset = (): boolean => {
    if (_isMutationAsset === undefined) {
      _isMutationAsset = spriteLooksLikeMutationAsset(spriteKeys, getSpriteHints());
    }
    return _isMutationAsset;
  };

  // Strategy 1: direct sprite key match — record every rule whose targetKeys
  // contain this sprite key (previously first-wins; see ruleBySpriteKey
  // initialization for the rationale).
  for (const key of spriteKeys) {
    const byKey = ruleBySpriteKey.get(key);
    if (!byKey) continue;
    for (const entry of byKey) {
      if (ruleCanApplyToSprite(entry, isMutationAsset())) {
        recordMatch(entry);
      }
      if (entry.isPlantBaseRule) {
        skippedMutationOverlayForBaseRule++;
      }
    }
  }

  // Strategy 2: frame signature match — record every compatible rule sharing the sig.
  {
    const sig = makeFrameSignature(sprite.texture);
    if (sig) {
      const bySig = rulesByFrameSig.get(sig);
      if (bySig) for (const entry of bySig) {
        if (ruleCanApplyToSprite(entry, isMutationAsset())) recordMatch(entry);
      }
    }
  }

  // Strategy 3: variant key match
  {
    const variant = getVariant();
    if (variant?.baseKey) {
      const variantBaseKey = normalizeSpriteKeyCandidate(variant.baseKey)?.toLowerCase() ?? null;
      if (variantBaseKey) {
        const byVariantKey = ruleBySpriteKey.get(variantBaseKey);
        if (byVariantKey) {
          for (const entry of byVariantKey) {
            if (ruleCanApplyToSprite(entry, isMutationAsset())) {
              recordMatch(entry);
            }
          }
        }
      }
      const { id: variantId } = parseAtlasKey(variant.baseKey);
      const normalizedVariantId = variantId.toLowerCase();
      if (normalizedVariantId) {
        for (const entry of ruleList) {
          if (entry.targetIdLower === normalizedVariantId && ruleCanApplyToSprite(entry, isMutationAsset())) {
            recordMatch(entry);
          }
        }
      }
    }
  }

  // Strategy 4: plant context match — texture-replacement rules only.
  // Live-overlay rules excluded for the same reason as Strategy 7: both
  // DawnCelestialPlant and DawnCelestialCrop normalize to the same
  // targetMatchKey, so applying via plantContext would cascade onto sibling
  // sprites and mask the species-specific rule the user actually wants.
  // Live-overlay paths are handled by Strategy 1 (tex.label) and Strategy 6
  // (crop-slot pattern).
  {
    const plantContext = getPlantContext();
    if (plantContext?.speciesKey) {
      const byPlantCtx = plantRulesBySpecies.get(plantContext.speciesKey) ?? null;
      if (byPlantCtx && !byPlantCtx.isLiveOverlay && ruleCanApplyToSprite(byPlantCtx, isMutationAsset())) {
        recordMatch(byPlantCtx, 'plantContext');
      }
    }
  }

  // Strategy 5: mutation-prefixed species match
  if (plantRulesBySpecies.size > 0) {
    for (const key of spriteKeys) {
      const prefixed = extractMutationPrefixedPlantMatchFromKey(key);
      if (!prefixed) continue;
      const bySpecies = plantRulesBySpecies.get(prefixed.speciesKey);
      if (!bySpecies) continue;
      if (!ruleCanApplyToSprite(bySpecies, isMutationAsset())) continue;
      recordMatch(bySpecies, 'mutationPrefix');
      if (inferredMutations.length === 0) inferredMutations = prefixed.mutations;
    }
  }

  // Strategy 6: hint-based match.
  //
  // Live-overlay rules use the *closest* labeled ancestor — the first
  // ancestor (or the sprite itself) that has any label/name. Higher
  // ancestors aren't checked, which prevents a platform's tint rule from
  // cascading onto child crop sprites. Texture-replacement rules use the
  // broader ancestor walk so existing swap workflows aren't affected.
  //
  // Slot-container gate: when a hint matches `${plantSpecies} slot-N`
  // (GrowingCropVisual.ts:165 in beta), the sprite is a CROP held by that
  // plant's harvest container — NOT the plant itself. Without this gate,
  // a plant rule's targetIdLower (e.g. 'dawncelestialplant') would
  // word-boundary-match the slot label and cross-bleed onto baked crops.
  // The gate accepts ONLY crop rules whose family root (targetSpeciesLower
  // after stripping 'crop') aligns with the slot's plant species
  // (`${root}plant`, `${root}tallplant`, or `${root}` itself), and honors
  // the optional rule.slotIndex. Non-crop rules of any kind are rejected
  // for that specific hint, but other hints in the same hintsForEntry list
  // still get checked.
  {
    const spriteHints = getSpriteHints();
    if (spriteHints.length > 0) {
      const closestLabelHintsCache = extractSpriteClosestLabelHints(sprite);
      const spriteRejectsNonLiveSwap = isNineSliceOrTiledSprite(sprite);
      for (const entry of ruleList) {
        if (matchedIds.has(entry.rule.id)) continue;
        if (!ruleCanApplyToSprite(entry, isMutationAsset())) continue;
        if (spriteRejectsNonLiveSwap && !entry.isLiveOverlay) continue;
        const hintsForEntry = entry.isLiveOverlay && !isRive
          ? closestLabelHintsCache
          : spriteHints;
        if (hintsForEntry.length === 0) continue;
        const targetKey = entry.rule.targetSpriteKey.toLowerCase();
        let hit: 'targetKey' | 'hintId' | null = null;
        for (const hint of hintsForEntry) {
          const slot = parseSlotContainerHint(hint);
          if (slot) {
            if (!entry.endsWithCrop) continue;
            const root = entry.targetSpeciesLower;
            if (!root) continue;
            const slotSpecies = slot.plantSpeciesLower;
            const familyMatch = slotSpecies === root
              || slotSpecies === `${root}plant`
              || slotSpecies === `${root}tallplant`;
            if (!familyMatch) continue;
            const wantedIdx = entry.rule.slotIndex;
            if (wantedIdx != null && wantedIdx !== slot.slotIndex) continue;
            hit = 'hintId';
            break;
          }
          let cachedNorm = hintNormCache.get(hint);
          if (cachedNorm === undefined) {
            cachedNorm = normalizeHintForSearch(hint);
            hintNormCache.set(hint, cachedNorm);
          }
          if (cachedNorm.includes(targetKey)) { hit = 'targetKey'; break; }
          if (entry.targetIdRegex && entry.targetIdRegex.test(cachedNorm)) { hit = 'hintId'; break; }
          if (entry.targetSpeciesRegex && entry.targetSpeciesRegex.test(cachedNorm)) {
            hit = 'hintId';
            break;
          }
          if (
            entry.isLiveOverlay
            && entry.endsWithCrop
            && entry.targetSpeciesLower
            && hintMentionsSlotForSpecies(hint, entry.targetSpeciesLower)
          ) {
            const wantedIdx = entry.rule.slotIndex;
            if (wantedIdx != null) {
              const idx = parseSlotIndexFromHint(hint, entry.targetSpeciesLower);
              if (idx !== wantedIdx) continue;
            }
            hit = 'hintId';
            break;
          }
        }
        if (hit === 'targetKey') recordMatch(entry);
        else if (hit === 'hintId') recordMatch(entry, 'hintId');
      }
    }
  }

  // Strategy 7: ancestor species match — texture-replacement rules only.
  {
    const speciesHints = extractAncestorSpeciesHints(sprite);
    if (speciesHints.length > 0 && !isNineSliceOrTiledSprite(sprite)) {
      for (const entry of ruleList) {
        if (entry.isLiveOverlay) continue;
        if (matchedIds.has(entry.rule.id)) continue;
        if (!speciesHints.includes(entry.targetIdLower) && !speciesHints.includes(entry.targetSpeciesLower)) continue;
        if (!ruleCanApplyToSprite(entry, isMutationAsset())) continue;
        recordMatch(entry);
      }
    }
  }

  // Scope filter: drop scoped rules whose scope doesn't match this sprite's
  // context. Resolve tileKey/slotIndex lazily (only when scoped rules exist).
  let hasScopedRules = false;
  for (const m of matches) {
    if (m.rule.scope && m.rule.scope.kind !== 'all') { hasScopedRules = true; break; }
  }
  if (hasScopedRules) {
    const tileKey = extractTileKeyFromSprite(sprite, tileKeyMemo);
    const slotIndex = resolveSlotIndexForPetSprite(sprite, slotIndexMemo);
    for (let i = matches.length - 1; i >= 0; i--) {
      const scope = matches[i]!.rule.scope;
      if (!scope || scope.kind === 'all') continue;
      if (scope.kind === 'tile') {
        if (!tileKey || tileKey !== scope.tileKey) { matches.splice(i, 1); continue; }
      } else if (scope.kind === 'petSlot') {
        if (slotIndex == null || slotIndex !== scope.slotIndex) { matches.splice(i, 1); continue; }
      }
    }
  }

  return {
    matches,
    isRive,
    spriteKeys,
    inferredMutations,
    getVariant,
    getPlantContext,
    plantContextMatches,
    mutationPrefixMatches,
    hintIdMatches,
    skippedMutationOverlayForBaseRule,
  };
}
