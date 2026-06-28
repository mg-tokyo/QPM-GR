import {
  log,
  ctx,
  parseAtlasKey,
} from './types';
import type {
  TextureOverrideRule,
  SpriteVariantInfo,
  PlantSpriteContext,
} from './types';
import { extractTileKeyFromSprite, resolveSlotIndexForPetSprite } from './matching';
import { buildLayerBRuleIndex, type RuleEntry } from './layerB-prepare';
import {
  normalizeSpriteKeyCandidate,
  isPlantBaseSpriteKey,
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
import { walkSpriteTree, getPixiApp, isTextureRenderable } from './pixi-walk';
import {
  restoreSpriteSnapshot,
  hexToPixiTint,
  lerpTint,
  isLiveOverlayRule,
  getOrCreateSpriteOverlay,
  registerScaleTarget,
} from './layerB-overlay';
import { buildVariantTextureForStage } from './layerB-variants';
import {
  isRiveSprite,
  isRiveDecorSprite,
  setRiveSpriteScale,
  captureFromScene,
  applyRiveColorMutation,
  applyRiveRainbowLite,
  applyRiveMutationBadge,
  setRiveStaticFallback,
  setRiveTextureOverride,
  getOrBuildRiveOverrideTexture,
  applyRiveAlpha,
  syncRiveMutationsForActiveSprites,
  revertAllRiveOverlays,
  applyRivePetGoldFilter,
  applyRivePetRainbowFilter,
} from './riveAdapter';
import { getMutationColor } from './mutationColors';

// ---------------------------------------------------------------------------
// Layer B — main matching loop + revert
//
// Walks the live PIXI stage, identifies which sprites match each enabled rule
// via 7 escalating strategies, and either swaps the sprite's texture (asset
// rules) or attaches a child overlay sprite (live-overlay rules). On revert,
// restores every modified sprite from its snapshot.
// ---------------------------------------------------------------------------

/**
 * Detect PIXI sprite classes whose texture is NOT rendered as a single
 * atlas region: NineSliceSprite tiles a texture in nine pieces and
 * TilingSprite tiles it across its bounds. Swapping their texture to a
 * rule's customTex produces tiled garbage — the visible bug here was an
 * inventory slot's NineSliceSprite background matched via Strategy 6's
 * `(Daisy)` ancestor-label hint and ended up 9-slice-tiling the Daisy
 * rainbow bake across a 224×224 panel.
 *
 * Detection is duck-typed against PIXI v8's NineSlice / TilingSprite props
 * so it survives constructor-name minification. We DON'T block direct
 * sprite-key matches (Strategy 1) — if the user explicitly targets a UI
 * atlas key the game uses on a 9-slice, the swap is still their choice.
 * This gate only suppresses *hint-based* matches (Strategy 6 / 7), which
 * are the broad ancestor-walk paths that misfire on shared parent labels.
 */
function isNineSliceOrTiledSprite(sprite: any): boolean {
  if (!sprite) return false;
  // NineSliceSprite: four border-width props PIXI v8 owns directly.
  const hasNineSliceProps =
    typeof sprite.leftWidth === 'number'
    && typeof sprite.rightWidth === 'number'
    && typeof sprite.topHeight === 'number'
    && typeof sprite.bottomHeight === 'number';
  if (hasNineSliceProps) return true;
  // TilingSprite: tileScale + tilePosition + tileTransform PIXI v8 owns.
  const hasTilingProps =
    sprite.tileScale != null
    && sprite.tilePosition != null
    && sprite.tileTransform != null;
  if (hasTilingProps) return true;
  return false;
}

// ---------------------------------------------------------------------------
// AnimatedSprite helpers
//
// PIXI AnimatedSprite stores per-frame textures internally and overwrites
// sprite.texture on every animation tick. A one-shot sprite.texture = X is
// clobbered within 16ms. To persist a texture swap we must replace every
// entry in the frames array. Restore path reverses the replacement.
// ---------------------------------------------------------------------------

/**
 * Save the original per-frame textures from a PIXI AnimatedSprite.
 * Returns null for non-animated sprites (no `.textures` array).
 */
function snapshotAnimFrameTextures(sprite: any): any[] | null {
  const textures = sprite?.textures;
  if (!Array.isArray(textures) || textures.length <= 1) return null;
  return textures.map((f: any) =>
    f && typeof f === 'object' && 'texture' in f
      ? { texture: f.texture, time: f.time }
      : f,
  );
}

/**
 * Replace every frame in an AnimatedSprite's internal textures array
 * with `tex` so the swap persists through animation cycles. Handles
 * both FrameObject format (`{ texture, time }`) and plain Texture[].
 */
function replaceAnimFrameTextures(sprite: any, tex: any): void {
  const textures = sprite?.textures;
  if (!Array.isArray(textures) || textures.length <= 1) return;
  for (let i = 0; i < textures.length; i++) {
    if (textures[i] && typeof textures[i] === 'object' && 'texture' in textures[i]) {
      textures[i].texture = tex;
    } else {
      textures[i] = tex;
    }
  }
}

/**
 * Restore an AnimatedSprite's frame textures from a snapshot taken at
 * Layer B snapshot time.
 */
function restoreAnimFrameTextures(sprite: any, saved: any[]): void {
  const textures = sprite?.textures;
  if (!Array.isArray(textures)) return;
  for (let i = 0; i < saved.length && i < textures.length; i++) {
    const s = saved[i];
    if (s && typeof s === 'object' && 'texture' in s && textures[i] && typeof textures[i] === 'object' && 'texture' in textures[i]) {
      textures[i].texture = s.texture;
    } else {
      textures[i] = s;
    }
  }
}

/**
 * Asset-family helper (2026-06-27 Phase C). Returns the ORIGINAL-CASE atlas
 * key for the first family variant whose lowercase form appears in the
 * sprite's lowercase key set — or null when the sprite matched the rule's
 * base (or via a non-family strategy). Lowercase form is used for the
 * intersection because extractTextureSpriteKeys lowercases everything for
 * case-insensitive matching; the original-case value is what gets passed
 * back into svc.renderToCanvas, where atlas IDs are case-sensitive.
 *
 * O(1) per spriteKey thanks to the Map.get lookup; iterates the smaller
 * side of the comparison.
 */
function findMatchedFamilyVariantKey(
  spriteKeys: Set<string>,
  familyVariantKeyByLower: Map<string, string>,
): string | null {
  if (familyVariantKeyByLower.size === 0) return null;
  if (spriteKeys.size <= familyVariantKeyByLower.size) {
    for (const key of spriteKeys) {
      const original = familyVariantKeyByLower.get(key);
      if (original) return original;
    }
    return null;
  }
  for (const [low, original] of familyVariantKeyByLower) {
    if (spriteKeys.has(low)) return original;
  }
  return null;
}

/**
 * For plant/crop leaf sprites, find the ancestor container that should
 * receive scale instead so children (crops under plant, mutation icons
 * under crop) transform together.
 *
 * Hierarchy (confirmed via live probe):
 *   PlantBody → PlantBodyBase (plant tex) + slot-N → CropVisual → Sprite (crop tex)
 *
 * - Plant rules → scale PlantBody (contains plant sprite + all crop slots)
 * - Crop rules  → scale CropVisual (contains crop sprite + mutation icons)
 */
function findScaleContainer(sprite: unknown, entry: RuleEntry): unknown | null {
  const id = entry.targetIdLower;
  const isPlant = id.endsWith('plant') || id.endsWith('tallplant');
  const isCrop = id.endsWith('crop');
  if (!isPlant && !isCrop) return null;

  let cur = (sprite as { parent?: unknown })?.parent;
  let depth = 0;
  while (cur && typeof cur === 'object' && depth < 5) {
    const label = typeof (cur as { label?: unknown }).label === 'string'
      ? (cur as { label: string }).label : '';
    if (isPlant && label.endsWith('PlantBody')) return cur;
    if (isCrop && label === 'CropVisual') return cur;
    cur = (cur as { parent?: unknown }).parent;
    depth++;
  }
  return null;
}

export function applyAllLayerB(rules: TextureOverrideRule[]): void {
  // Rive sprites bypass the standard snapshot/restore path — setting
  // sprite.texture on a SharedRiveSprite with a stale snapshot crashes the
  // game's _setWidth override (`Cannot read properties of null (reading 'x')`,
  // verified live). Instead we tear down every Rive overlay/scale/override/
  // alpha snapshot in one pass here, then let the walker re-apply them below
  // for sprites that still match an active rule. Idempotent — no-op when no
  // Rive sprites are tracked.
  revertAllRiveOverlays();

  for (const sprite of ctx.layerBModified) {
    const orig = ctx.layerBOriginals.get(sprite);
    if (orig) {
      restoreSpriteSnapshot(sprite, orig);
      ctx.layerBOriginals.delete(sprite);
    }
  }
  ctx.layerBModified = [];

  if (rules.length === 0) return;

  const index = buildLayerBRuleIndex(rules);
  if (!index) return;
  const {
    ruleList,
    ruleBySpriteKey,
    rulesByFrameSig,
    plantRulesBySpecies,
    runtimeRefKeys,
    hasMutationAssetRules,
  } = index;

  log(`applyAllLayerB: ${ruleList.length} active rules`);

  const app = getPixiApp();
  if (!app?.stage) {
    log('applyAllLayerB: no PIXI app/stage found');
    return;
  }

  let spriteCount = 0;
  let matchCount = 0;
  let plantContextMatchCount = 0;
  let mutationPrefixMatchCount = 0;
  let hintIdMatchCount = 0;
  let skippedMutationOverlayForBaseRule = 0;
  let firstSpriteTex: any = null;
  let firstSpriteKeys: string[] = [];
  let firstSpriteCacheKeys: string[] = [];
  let firstSpriteSig: string | null = null;
  let firstSpriteVariant: SpriteVariantInfo | null = null;
  let firstSpritePlantContext: PlantSpriteContext | null = null;
  let firstSpriteHints: string[] = [];
  let firstSpriteNodeKeys: string[] = [];
  const plantCtxMemo = new WeakMap<object, PlantSpriteContext | null>();
  const tileKeyMemo = new WeakMap<object, string | null>();
  const slotIndexMemo = new WeakMap<object, 0 | 1 | 2 | null>();
  const svc = ctx.currentSvc;

  const stateRulesOrder = new Map<string, number>();
  ctx.state.rules.forEach((r, i) => stateRulesOrder.set(r.id, i));
  const hintNormCache = new Map<string, string>();

  walkSpriteTree(app.stage, (sprite) => {
    // Skip our own per-sprite tint overlays — they share the parent sprite's
    // texture and would re-match the same rule on every pass, spawning more
    // overlays inside themselves until MAX_WALK_DEPTH. See marker setup in
    // getOrCreateSpriteOverlay (layerB-overlay.ts).
    if ((sprite as { __qpmOverlay?: true }).__qpmOverlay) return;
    spriteCount++;
    if (!firstSpriteTex) {
      firstSpriteTex = sprite.texture;
      firstSpriteKeys = extractTextureSpriteKeys(sprite.texture);
      firstSpriteCacheKeys = [
        ...(runtimeRefKeys.get(sprite.texture as object) ?? []),
        ...(runtimeRefKeys.get((sprite.texture?.source ?? null) as object) ?? []),
      ];
      firstSpriteSig = makeFrameSignature(sprite.texture);
      firstSpriteVariant = extractVariantInfoFromTexture(sprite.texture) ?? extractVariantInfoFromSpriteNode(sprite);
      firstSpriteHints = [
        ...extractTextureHintStrings(sprite.texture),
        ...extractSpriteHintStrings(sprite),
      ];
      firstSpriteNodeKeys = extractSpriteNodeSpriteKeys(sprite);
      if (plantRulesBySpecies.size > 0) {
        firstSpritePlantContext = extractPlantContextFromSprite(sprite, plantCtxMemo);
      }
    }

    // Multi-rule matching: collect every rule that matches this sprite via any
    // strategy. Dedup by rule.id (same rule can be reached via multiple
    // strategies). After matching, apply each rule's contribution in
    // state.rules order — attribute conflicts resolved by last-wins.
    const matches: RuleEntry[] = [];
    const matchedIds = new Set<string>();
    let inferredMutations: string[] = [];

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
      if (via === 'plantContext') plantContextMatchCount++;
      else if (via === 'mutationPrefix') mutationPrefixMatchCount++;
      else if (via === 'hintId') hintIdMatchCount++;
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

    if (matches.length === 0) {
      // Mutation-only variant path (preserved from original behavior): when no
      // rule matched but the sprite has a mutation variant and there are
      // mutation-asset rules elsewhere, rebuild the variant texture so the
      // mutation visuals composite correctly.
      const mutVariant = hasMutationAssetRules ? getVariant() : null;
      if (hasMutationAssetRules && svc && mutVariant && mutVariant.mutations.length > 0) {
        const cacheKey = `mutation-only|${ctx.ruleRevision}|${mutVariant.baseKey}|${mutVariant.sig}`;
        const nextTexture = buildVariantTextureForStage(cacheKey, mutVariant.baseKey, mutVariant.mutations, svc);
        if (nextTexture && isTextureRenderable(nextTexture)) {
          if (!ctx.layerBOriginals.has(sprite)) {
            ctx.layerBOriginals.set(sprite, {
              texture: sprite.texture,
              scaleX: sprite.scale?.x ?? 1,
              scaleY: sprite.scale?.y ?? 1,
              alpha: sprite.alpha ?? 1,
              tint: typeof sprite.tint === 'number' ? sprite.tint : 0xffffff,
              frameSig: makeFrameSignature(sprite.texture),
              keyHints: [...spriteKeys],
              animFrameTextures: snapshotAnimFrameTextures(sprite),
            });
          }
          ctx.layerBModified.push(sprite);
          sprite.texture = nextTexture;
          replaceAnimFrameTextures(sprite, nextTexture);
        }
      }
      return;
    }

    matchCount += matches.length;

    // Snapshot baseline once per non-Rive sprite. Rive sprites bypass this
    // path entirely — their textures are dynamically managed by
    // SharedRiveSprite.syncTextureFromBacking and any restore attempt crashes
    // the game's _setWidth override. Rive teardown is handled by
    // revertAllRiveOverlays() at the top of applyAllLayerB.
    if (!isRive && !ctx.layerBOriginals.has(sprite)) {
      ctx.layerBOriginals.set(sprite, {
        texture: sprite.texture,
        scaleX: sprite.scale?.x ?? 1,
        scaleY: sprite.scale?.y ?? 1,
        alpha: sprite.alpha ?? 1,
        tint: typeof sprite.tint === 'number' ? sprite.tint : 0xffffff,
        frameSig: makeFrameSignature(sprite.texture),
        keyHints: [...spriteKeys],
        animFrameTextures: snapshotAnimFrameTextures(sprite),
      });
    }
    if (!isRive) {
      ctx.layerBModified.push(sprite);
    }

    // Apply each matched rule's contribution in state.rules order. Later rules
    // override earlier ones on shared attributes (last-wins for tint, scale,
    // alpha, and texture replacement). stateRulesOrder is hoisted above the
    // walk (per PR #4). For the common single-match case skip the sort.
    // Scoped rules sort after all-instances rules at the same position so
    // scoped-wins via last-write.
    const ordered = matches.length > 1
      ? matches.slice().sort((a, b) => {
          const aScoped = a.rule.scope && a.rule.scope.kind !== 'all' ? 1 : 0;
          const bScoped = b.rule.scope && b.rule.scope.kind !== 'all' ? 1 : 0;
          if (aScoped !== bScoped) return aScoped - bScoped;
          return (stateRulesOrder.get(a.rule.id) ?? 0) - (stateRulesOrder.get(b.rule.id) ?? 0);
        })
      : matches;

    // PASS 1 — textures and overlays. Texture swaps may recompute sprite.scale
    // (PIXI v8's texture setter calls _setWidth, which derives scale from the
    // cached _width and the new texture's frame width). Doing all swaps first
    // means PASS 2's scale/alpha writes are the LAST writes, and stick.
    for (const entry of ordered) {
      const params = entry.rule.params;

      if (!entry.isLiveOverlay) {
        // Rive static-fallback toggle — opt-in per rule, hides Rive +
        // re-shows static atlas sprite so standard texture swap works.
        // Decor-only — pets have no static atlas sibling to fall back to.
        if (isRive && isRiveDecorSprite(sprite) && entry.rule.useStaticFallback) {
          setRiveStaticFallback(sprite, true);
          // Fall through to standard texture-replacement path so it runs on
          // the now-visible static sprite next iteration (handled below).
        }
        // Rive cosmetic-mutation path. Split by class:
        //   • Decor (SharedRiveSprite): overlay-child + lite gradient, as
        //     before. v8 render-group bug prevents direct sprite.filters use.
        //   • Pet (RiveSprite): direct sprite.filters with ColorOverlayFilter
        //     (Gold/single-color) or RainbowFilter — matches the game's
        //     PetView.applyMutationFilters path exactly (PetView.ts:434-461).
        //     Falls back to the lite-overlay path when PIXI Filter ctors
        //     haven't been captured yet.
        if (isRive && !entry.rule.useStaticFallback && entry.rule.cosmeticMutations?.length) {
          const usePetFilters = !isRiveDecorSprite(sprite);
          for (const mutName of entry.rule.cosmeticMutations) {
            if (usePetFilters) {
              if (mutName === 'Rainbow') {
                if (!applyRivePetRainbowFilter(sprite, entry.rule.id)) {
                  applyRiveRainbowLite(sprite, entry.rule.id);
                }
              } else if (mutName === 'Gold') {
                const color = getMutationColor('Gold');
                if (!color || !applyRivePetGoldFilter(sprite, color.color, 0.7, entry.rule.id)) {
                  applyRiveColorMutation(sprite, mutName, entry.rule.id);
                  applyRiveMutationBadge(sprite, mutName, entry.rule.id);
                }
              } else {
                // Other mutations (Wet, Chilled, Frozen, etc.) — the game
                // doesn't recolor pets for these. We still show our overlay
                // approximation + badge so users see the rule worked.
                applyRiveColorMutation(sprite, mutName, entry.rule.id);
                applyRiveMutationBadge(sprite, mutName, entry.rule.id);
              }
            } else {
              if (mutName === 'Rainbow') {
                applyRiveRainbowLite(sprite, entry.rule.id);
              } else {
                applyRiveColorMutation(sprite, mutName, entry.rule.id);
                applyRiveMutationBadge(sprite, mutName, entry.rule.id);
              }
            }
          }
          // Scale/alpha still flow through PASS 2 below.
        } else if (isRive && !entry.rule.useStaticFallback && entry.customTex) {
          // Rive texture-swap path — DECOR ONLY.
          //   • Decor (SharedRiveSprite): Phase 7 draw hook — sprite.texture
          //     IS the visible render output, so swapping it shows the swap.
          //     Uses a clean texture wrapping the source canvas to avoid
          //     atlas-trim mismatch.
          //   • Pet (RiveSprite): DISABLED. The sibling-overlay attempt
          //     produced misaligned/wrong-sized output in testing and the
          //     rive batch renderer's interaction with PIXI's child-of-parent
          //     render order didn't reliably place our overlay where the pet
          //     visually was. Pet mutations + scale still work via their own
          //     paths; swap is a no-op so the original rive pet renders
          //     unchanged.
          if (isRiveDecorSprite(sprite)) {
            const cleanTex = getOrBuildRiveOverrideTexture(entry.rule.id, entry.customTex);
            if (cleanTex && isTextureRenderable(cleanTex)) {
              setRiveTextureOverride(sprite, cleanTex);
            }
          }
          // Else: pet — skip swap apply. Mutation + scale rules on the same
          // pet still apply via their respective branches above and PASS 2.
        } else {
          // Standard texture-replacement contribution. Multiple texture-
          // replacement rules → the later one's texture wins (last write to
          // sprite.texture).
          const behavior = entry.rule.mutationBehavior ?? 'preserve';
          const v = getVariant();
          const pc = getPlantContext();
          const preserveMutations = v?.mutations.length
            ? v.mutations
            : (pc?.mutations.length ? pc.mutations : inferredMutations);
          // Asset-family variant detection — Phase C of the 2026-06-27 work.
          // When the rule was matched via a family-variant sprite key (e.g.
          // rule on DawnCelestialPlant matched DawnCelestialPlantActive after
          // weather), bake/re-bake the variant's atlas at the variant's
          // geometry rather than stretching the base customTex. Falls back to
          // variant.baseKey (label-parsed) and then the rule's own target,
          // preserving every existing pre-family code path.
          const matchedFamilyVariantKey =
            entry.familyVariantKeyByLower.size > 0
              ? findMatchedFamilyVariantKey(spriteKeys, entry.familyVariantKeyByLower)
              : null;
          const preserveBaseKey =
            v?.baseKey ?? matchedFamilyVariantKey ?? entry.rule.targetSpriteKey;
          const cosmeticMutations = entry.rule.cosmeticMutations ?? [];
          let nextTexture: any | null = null;
          if (entry.rule.forceNoMutations && svc) {
            // Force-none: build a clean variant against the base with no
            // mutations, ignoring the in-game mutation state. Used by both
            // pure mutation rules (no customTex) and swap rules combined
            // with force-none.
            const cacheKey = `${entry.rule.id}|${ctx.ruleRevision}|${preserveBaseKey}|FN`;
            nextTexture = buildVariantTextureForStage(cacheKey, preserveBaseKey, [], svc, undefined)
              ?? entry.customTex;
          } else if (behavior === 'preserve' && svc && preserveMutations.length > 0) {
            const tint = params.tintColor
              ? {
                color: params.tintColor,
                alpha: params.tintAlpha ?? 0.5,
                saturation: params.tintSaturation ?? 0,
              }
              : undefined;
            const cacheKey = `${entry.rule.id}|${ctx.ruleRevision}|${preserveBaseKey}|PM:${preserveMutations.join(',')}`;
            nextTexture = buildVariantTextureForStage(cacheKey, preserveBaseKey, preserveMutations, svc, tint)
              ?? entry.customTex;
          } else if (matchedFamilyVariantKey && svc && cosmeticMutations.length > 0) {
            // Family-variant fallthrough for cosmetic-mutation rules:
            // entry.customTex was baked against the BASE atlas at Layer A,
            // so stretching it onto the variant clips/distorts the visual.
            // Rebuild specifically for this variant key + the rule's
            // cosmetic mutations so the active/lit/rotated sprite shows the
            // mutation effect at the correct atlas geometry.
            const tint = params.tintColor
              ? {
                color: params.tintColor,
                alpha: params.tintAlpha ?? 0.5,
                saturation: params.tintSaturation ?? 0,
              }
              : undefined;
            const cacheKey = `${entry.rule.id}|${ctx.ruleRevision}|${matchedFamilyVariantKey}|CM:${cosmeticMutations.join(',')}`;
            nextTexture = buildVariantTextureForStage(cacheKey, matchedFamilyVariantKey, cosmeticMutations, svc, tint)
              ?? entry.customTex;
          } else if (cosmeticMutations.length > 0 && svc) {
            // Cosmetic-mutation rules on non-family-variant sprites (e.g.
            // scoped rules where Layer A skipped texture building). Build
            // the variant texture against the base key with the user's
            // chosen mutations applied.
            const tint = params.tintColor
              ? {
                color: params.tintColor,
                alpha: params.tintAlpha ?? 0.5,
                saturation: params.tintSaturation ?? 0,
              }
              : undefined;
            const cacheKey = `${entry.rule.id}|${ctx.ruleRevision}|${preserveBaseKey}|CM:${cosmeticMutations.join(',')}`;
            nextTexture = buildVariantTextureForStage(cacheKey, preserveBaseKey, cosmeticMutations, svc, tint)
              ?? entry.customTex;
          } else {
            // No mutations + no family-variant rebuild path → use the rule's
            // Layer A customTex. For library-swap rules this means the
            // user's chosen image is shown on the variant sprite; the
            // geometry mirrors the base's atlas so some scale offset is
            // possible but the swap is visibly applied either way.
            nextTexture = entry.customTex;
          }
          if (nextTexture && isTextureRenderable(nextTexture)) {
            sprite.texture = nextTexture;
            replaceAnimFrameTextures(sprite, nextTexture);
          }
        }
      } else if (params.tintColor) {
        // Live-overlay tint: per-sprite overlay child. getOrCreateSpriteOverlay
        // is idempotent — if multiple live-overlay rules with tintColor reach
        // the same sprite, the later one (in state.rules order) wins because
        // the WeakMap<sprite, overlay> slot is single-valued.
        getOrCreateSpriteOverlay(sprite, entry.rule);
      }
    }

    // PASS 2 — scale and alpha. Last-wins by iteration order, AFTER all
    // texture swaps so PIXI's auto-rescale-on-texture-change can't clobber us.
    for (const entry of ordered) {
      const params = entry.rule.params;

      if (params.scaleX != null) {
        try {
          if (isRive) {
            // Rive sprites have their width/height reset every frame by
            // SharedRiveWorldRenderer.syncDisplaySize. Direct sprite.scale.set
            // is overwritten on the next render tick. riveAdapter intercepts
            // the width/height setters at the Sprite prototype level so our
            // multiplier is applied every frame, not just once.
            setRiveSpriteScale(sprite, params.scaleX, params.scaleY ?? params.scaleX);
          } else {
            const sy = params.scaleY ?? params.scaleX;
            // For plant/crop sprites, scale the container so children
            // (crop slots under plant, mutation icons under crop) transform
            // together via PIXI's parent→child inheritance.
            const container = findScaleContainer(sprite, entry);
            const scaleNode = container ?? sprite;
            // Snapshot the container's original state for restoration.
            if (container && !ctx.layerBOriginals.has(container)) {
              ctx.layerBOriginals.set(container, {
                texture: (container as { texture?: unknown }).texture as never,
                scaleX: (container as { scale?: { x?: number } }).scale?.x ?? 1,
                scaleY: (container as { scale?: { y?: number } }).scale?.y ?? 1,
                alpha: (container as { alpha?: number }).alpha ?? 1,
                tint: typeof (container as { tint?: unknown }).tint === 'number'
                  ? (container as { tint: number }).tint : 0xffffff,
                frameSig: null,
                keyHints: [],
                animFrameTextures: null,
              });
              ctx.layerBModified.push(container);
            }
            // Preserve the current scale sign so game-applied flips survive.
            const curX = (scaleNode as { scale?: { x?: number } }).scale?.x ?? 1;
            const curY = (scaleNode as { scale?: { y?: number } }).scale?.y ?? 1;
            const signX = curX < 0 ? -1 : 1;
            const signY = curY < 0 ? -1 : 1;
            (scaleNode as { scale?: { set?(x: number, y: number): void } }).scale?.set?.(
              params.scaleX * signX, sy * signY,
            );
            // Re-assert per-frame against the game's tile renderer that
            // clobbers sprite.width / sprite.scale every ~16-100ms.
            registerScaleTarget(scaleNode, params.scaleX, sy);
          }
        } catch { /* ignore */ }
      }
      if (params.alpha != null) {
        if (isRive) {
          // Snapshot original alpha so revertAllRiveOverlays restores it when
          // the rule is removed. Direct sprite.alpha = params.alpha won't
          // round-trip on revert otherwise — Rive sprites are skipped by the
          // standard snapshot loop.
          applyRiveAlpha(sprite, params.alpha);
        } else {
          sprite.alpha = params.alpha;
        }
      }
    }
  });

  // Lazy install the Rive adapter the first time a Rive sprite is observed.
  // No-op when already installed or when no Rive decor is on screen.
  captureFromScene();
  // Sync mutation-overlay textures with Rive's per-frame reallocations.
  syncRiveMutationsForActiveSprites();

  log(
    `applyAllLayerB: walked ${spriteCount} sprites, matched ${matchCount}, plantContextMatches ${plantContextMatchCount}, mutationPrefixMatches ${mutationPrefixMatchCount}, hintIdMatches ${hintIdMatchCount}, skippedMutationOverlayForBaseRule ${skippedMutationOverlayForBaseRule}`,
  );
  if (spriteCount > 0 && matchCount === 0 && ruleList.length > 0) {
    const firstEntry = ruleList[0]!;
    log('applyAllLayerB: NO MATCH - origTex structure:', {
      ref: firstEntry.origTex,
      baseTexture: firstEntry.origTex?.baseTexture,
      source: firstEntry.origTex?.source,
      frame: firstEntry.origTex?.frame ?? firstEntry.origTex?._frame,
      keys: [...firstEntry.targetKeys],
      frameSig: firstEntry.origSig,
    });
    log('applyAllLayerB: NO MATCH - first stage sprite texture structure:', {
      ref: firstSpriteTex,
      baseTexture: firstSpriteTex?.baseTexture,
      source: firstSpriteTex?.source,
      frame: firstSpriteTex?.frame ?? firstSpriteTex?._frame,
      keys: firstSpriteKeys,
      nodeKeys: firstSpriteNodeKeys,
      cacheKeys: firstSpriteCacheKeys,
      frameSig: firstSpriteSig,
      variant: firstSpriteVariant,
      plantContext: firstSpritePlantContext,
      hints: firstSpriteHints,
    });
  }
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

export function revertAllLayerB(): void {
  // Rive sprites bypass the snapshot/restore path — tear down their
  // overlays/scales/overrides/alphas via the Rive adapter's own teardown.
  revertAllRiveOverlays();
  for (const sprite of ctx.layerBModified) {
    const orig = ctx.layerBOriginals.get(sprite);
    if (orig) {
      restoreSpriteSnapshot(sprite, orig);
      ctx.layerBOriginals.delete(sprite);
    }
  }
  ctx.layerBModified = [];
  ctx.layerBOriginals = new WeakMap();
  ctx.lastLayerBApplyToken = null;
}
