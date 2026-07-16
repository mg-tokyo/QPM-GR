import { ctx, warnFeature } from './types';
import type {
  SpriteVariantInfo,
  PlantSpriteContext,
  SpriteService,
} from './types';
import type { RuleEntry } from './layerB-prepare';
import { isTextureRenderable } from './pixi-walk';
import {
  getOrCreateSpriteOverlay,
  registerScaleTarget,
} from './layerB-overlay';
import { buildVariantTextureForStage } from './layerB-variants';
import {
  isRiveDecorSprite,
  setRiveSpriteScale,
  applyRiveColorMutation,
  applyRiveRainbowLite,
  applyRiveMutationBadge,
  setRiveStaticFallback,
  setRiveTextureOverride,
  getOrBuildRiveOverrideTexture,
  applyRiveAlpha,
  applyRivePetGoldFilter,
  applyRivePetRainbowFilter,
} from './riveAdapter';
import { getMutationColor } from './mutationColors';
import { findMatchedFamilyVariantKey, findScaleContainer } from './layerB-apply-helpers';
import { replaceAnimFrameTextures } from './layerB-anim-frames';

export interface ApplyPassContext {
  isRive: boolean;
  spriteKeys: Set<string>;
  inferredMutations: string[];
  getVariant: () => SpriteVariantInfo | null;
  getPlantContext: () => PlantSpriteContext | null;
  svc: SpriteService | null;
}

/**
 * PASS 1 — textures and overlays. Texture swaps may recompute sprite.scale
 * (PIXI v8's texture setter calls _setWidth, which derives scale from the
 * cached _width and the new texture's frame width). Doing all swaps first
 * means PASS 2's scale/alpha writes are the LAST writes, and stick.
 */
export function applyTextureAndOverlayPass(
  sprite: any,
  ordered: RuleEntry[],
  passCtx: ApplyPassContext,
): void {
  const { isRive, spriteKeys, inferredMutations, getVariant, getPlantContext, svc } = passCtx;

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
}

/**
 * PASS 2 — scale and alpha. Last-wins by iteration order, AFTER all
 * texture swaps so PIXI's auto-rescale-on-texture-change can't clobber us.
 */
export function applyScaleAndAlphaPass(
  sprite: any,
  ordered: RuleEntry[],
  isRive: boolean,
): void {
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
      } catch (e) {
        warnFeature('QPM-TEXTURESWAP-001', { what: 'layerB:scale' }, e);
      }
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
}
