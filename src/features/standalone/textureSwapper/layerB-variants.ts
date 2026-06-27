import { ctx, parseAtlasKey } from './types';
import type { SpriteService, TextureOverrideRule } from './types';
import { renderSpriteToCanvas, applyTintToCanvas, transferTrimGeometry } from './canvas';
import { walkSpriteTree, isTextureRenderable } from './pixi-walk';

// ---------------------------------------------------------------------------
// Layer B — variant texture cache & stage signing
//
// Owns the per-rule variant texture map (keyed by ruleId + revision + sprite
// key + mutations), the retirement queue for textures we no longer need, and
// the stage signature used to detect when a re-apply pass would be wasted.
// ---------------------------------------------------------------------------

type VariantTint = { color: string; alpha: number; saturation: number };

// ---------------------------------------------------------------------------
// Variant texture cache
// ---------------------------------------------------------------------------

export function queueTextureForRetirement(tex: any): void {
  if (!tex) return;
  ctx.retiredTextures.add(tex);
}

export function clearRuleVariantTexturesForRule(ruleId: string): void {
  const prefix = `${ruleId}|`;
  for (const [key, tex] of ctx.ruleVariantTextures.entries()) {
    if (!key.startsWith(prefix)) continue;
    queueTextureForRetirement(tex);
    ctx.ruleVariantTextures.delete(key);
  }
}

export function clearAllRuleVariantTextures(): void {
  for (const tex of ctx.ruleVariantTextures.values()) {
    queueTextureForRetirement(tex);
  }
  ctx.ruleVariantTextures.clear();
}

export function bumpRuleRevision(): void {
  ctx.ruleRevision++;
  clearAllRuleVariantTextures();
}

export function buildVariantTextureForStage(
  cacheKey: string,
  baseSpriteKey: string,
  mutations: string[],
  svc: SpriteService,
  tint?: VariantTint,
): any | null {
  const cached = ctx.ruleVariantTextures.get(cacheKey);
  if (cached && isTextureRenderable(cached)) return cached;
  if (cached) {
    queueTextureForRetirement(cached);
    ctx.ruleVariantTextures.delete(cacheKey);
  }

  const { category, id } = parseAtlasKey(baseSpriteKey);
  let canvas = renderSpriteToCanvas(svc, category, id, mutations);
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
  if (tint && tint.color) {
    canvas = applyTintToCanvas(canvas, tint.color, tint.alpha, tint.saturation);
  }
  try {
    const ctors = svc.state.ctors;
    const tex = ctors?.Texture.from(canvas) ?? null;
    if (!tex) return null;
    // Restore atlas trim geometry so the variant texture renders at the same
    // visible region as the base sprite. Reference = the current state.tex
    // entry: it's either the original (Layer A hasn't run for this key) or a
    // customTex whose geometry was already corrected by transferTrimGeometry
    // in buildCustomTexture. Either way the frame/orig/trim shape is what we
    // want to mirror onto the new variant texture.
    if (ctors) {
      const refTex = svc.state.tex.get(baseSpriteKey) ?? null;
      transferTrimGeometry(tex, refTex, ctors);
    }
    ctx.ruleVariantTextures.set(cacheKey, tex);
    return tex;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage signature & apply tokens
// ---------------------------------------------------------------------------

function getObjectIdentity(value: any): number {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return 0;
  const obj = value as object;
  const existing = ctx.objectIdentity.get(obj);
  if (existing != null) return existing;
  const id = ctx.nextObjectIdentity++;
  ctx.objectIdentity.set(obj, id);
  return id;
}

function mixHash(seed: number, value: number): number {
  let h = (seed ^ value) >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

export function buildStageSignature(stage: any): string {
  let spriteCount = 0;
  let spriteHash = 2166136261 >>> 0;
  let sourceHash = 2166136261 >>> 0;

  walkSpriteTree(stage, (sprite) => {
    spriteCount++;
    spriteHash = mixHash(spriteHash, getObjectIdentity(sprite));
    const tex = sprite?.texture ?? null;
    const source = tex?.source ?? tex?.baseTexture ?? tex?._source ?? tex?._baseTexture ?? null;
    sourceHash = mixHash(sourceHash, getObjectIdentity(source));
  });

  const childCount = Array.isArray(stage?.children) ? stage.children.length : 0;
  return [childCount, spriteCount, spriteHash.toString(16), sourceHash.toString(16)].join('|');
}

export function buildLayerBApplyToken(rules: TextureOverrideRule[], stage: any): string {
  const enabledRuleIds = rules.filter((r) => r.enabled).map((r) => r.id).sort().join(',');
  const stageSig = buildStageSignature(stage);
  return `${ctx.ruleRevision}|${ctx.contextRevision}|${enabledRuleIds}|${stageSig}`;
}
