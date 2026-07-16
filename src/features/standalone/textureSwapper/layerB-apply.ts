import { log, ctx } from './types';
import type {
  TextureOverrideRule,
  SpriteVariantInfo,
  PlantSpriteContext,
} from './types';
import { buildLayerBRuleIndex } from './layerB-prepare';
import {
  makeFrameSignature,
  extractTextureSpriteKeys,
  extractTextureHintStrings,
  extractSpriteNodeSpriteKeys,
  extractSpriteHintStrings,
  extractVariantInfoFromTexture,
  extractVariantInfoFromSpriteNode,
  extractPlantContextFromSprite,
} from './matching';
import { walkSpriteTree, getPixiApp, isTextureRenderable } from './pixi-walk';
import { restoreSpriteSnapshot } from './layerB-overlay';
import { buildVariantTextureForStage } from './layerB-variants';
import {
  captureFromScene,
  revertAllRiveOverlays,
  syncRiveMutationsForActiveSprites,
} from './riveAdapter';
import { snapshotAnimFrameTextures, replaceAnimFrameTextures } from './layerB-anim-frames';
import { matchSpriteToRules, type MatchState } from './layerB-match';
import { applyTextureAndOverlayPass, applyScaleAndAlphaPass } from './layerB-apply-passes';

// ---------------------------------------------------------------------------
// Layer B — main matching loop + revert
//
// Walks the live PIXI stage, identifies which sprites match each enabled rule
// via 7 escalating strategies, and either swaps the sprite's texture (asset
// rules) or attaches a child overlay sprite (live-overlay rules). On revert,
// restores every modified sprite from its snapshot.
// ---------------------------------------------------------------------------

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
  const { ruleList, runtimeRefKeys, plantRulesBySpecies, hasMutationAssetRules } = index;

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

  const matchState: MatchState = {
    index,
    hintNormCache,
    plantCtxMemo,
    tileKeyMemo,
    slotIndexMemo,
  };

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

    const result = matchSpriteToRules(sprite, matchState);
    const {
      matches,
      isRive,
      spriteKeys,
      inferredMutations,
      getVariant,
      getPlantContext,
    } = result;
    plantContextMatchCount += result.plantContextMatches;
    mutationPrefixMatchCount += result.mutationPrefixMatches;
    hintIdMatchCount += result.hintIdMatches;
    skippedMutationOverlayForBaseRule += result.skippedMutationOverlayForBaseRule;

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

    applyTextureAndOverlayPass(sprite, ordered, {
      isRive,
      spriteKeys,
      inferredMutations,
      getVariant,
      getPlantContext,
      svc,
    });
    applyScaleAndAlphaPass(sprite, ordered, isRive);
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
