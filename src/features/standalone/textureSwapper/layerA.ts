import {
  log,
  ctx,
} from './types';
import type {
  TextureOverrideRule,
  SpriteService,
} from './types';
import { buildCustomTexture } from './canvas';
import { invalidateSpriteKeyCache } from '../../../sprite-v2/compat';
import {
  clearRuleVariantTexturesForRule,
  queueTextureForRetirement,
} from './layerB-variants';
import {
  destroyAllSpriteOverlays,
  isLiveOverlayRule,
} from './layerB-overlay';
import { clearRiveOverrideTextureCache } from './riveAdapter';

// ---------------------------------------------------------------------------
// Layer A — QPM UI texture override
//
// Replaces svc.state.tex[key] (and the matching item.first reference) with a
// custom-built texture, so any code path that resolves the key through the
// sprite service gets the overridden texture. Live-overlay rules skip Layer A
// — they apply entirely in Layer B via sprite.tint/scale/alpha.
// ---------------------------------------------------------------------------

/**
 * Compute a stable fingerprint over the inputs that buildCustomTexture
 * depends on. Same fingerprint → cached texture can be reused (PR #4 task 18 /
 * audit HIGH #14). Drag ticks that don't change params become free.
 */
function computeTextureFingerprint(rule: TextureOverrideRule): string {
  const src = rule.source ?? {};
  const p = rule.params ?? {};
  return [
    src.librarySpriteKey ?? '',
    src.uploadAssetId ?? '',
    p.tintColor ?? '',
    p.tintAlpha ?? '',
    p.tintSaturation ?? '',
    // size / scaleX / scaleY all affect the resize math
    p.scaleX ?? '',
    p.scaleY ?? '',
    p.alpha ?? '',
    rule.forceNoMutations ? '1' : '0',
    (rule.cosmeticMutations ?? []).slice().sort().join(','),
    rule.targetSpriteKey,
  ].join('|');
}

export async function applyLayerA(rule: TextureOverrideRule, svc: SpriteService): Promise<void> {
  const isScoped = !!(rule.scope && rule.scope.kind !== 'all');

  log(`applyLayerA: starting rule ${rule.id} target=${rule.targetSpriteKey} scoped=${isScoped}`);

  // Live-overlay rules (tint/scale/alpha only — no source swap, no mutation
  // override) are applied entirely in Layer B via sprite.tint/scale/alpha.
  // Skipping Layer A keeps svc.state.tex / item.first pointing at the original
  // texture so mutation overlays and sibling sprites render unaffected.
  if (isLiveOverlayRule(rule)) {
    log(`applyLayerA: live-overlay rule ${rule.id} — skipping texture replacement`);
    return;
  }

  // Fingerprint cache (audit HIGH #14). Skip the rebuild when nothing relevant
  // changed since the last successful apply.
  const fingerprint = computeTextureFingerprint(rule);
  const cachedFingerprint = ctx.ruleTextureFingerprints.get(rule.id);
  const cachedTex = ctx.ruleTextures.get(rule.id);
  if (cachedFingerprint === fingerprint && cachedTex) {
    log(`applyLayerA: fingerprint hit — reusing cached texture for rule ${rule.id}`);
    return;
  }

  // Run-token (audit CRITICAL #6). Bump per rule before awaiting; if a newer
  // apply ran during our await window, discard the stale texture instead of
  // overwriting the newer one (and leaking the newer one in ctx.ruleTextures).
  const nextToken = (ctx.lastLayerAApplyTokenByRule.get(rule.id) ?? 0) + 1;
  ctx.lastLayerAApplyTokenByRule.set(rule.id, nextToken);

  const customTex = await buildCustomTexture(rule, svc);
  if (!customTex) {
    log(`applyLayerA: buildCustomTexture returned null — rule ${rule.id} not applied`);
    return;
  }

  // Stale-apply guard. A later drag tick may have already resolved and written
  // its own (newer) texture into ctx.ruleTextures — overwriting it would leak
  // the newer one. Queue our stale texture for retirement and exit.
  if (ctx.lastLayerAApplyTokenByRule.get(rule.id) !== nextToken) {
    log(`applyLayerA: stale apply for rule ${rule.id} — discarding`);
    queueTextureForRetirement(customTex);
    return;
  }

  const origItem = svc.state.items.find(it => it.key === rule.targetSpriteKey);
  log(`applyLayerA: origItem found=${origItem !== undefined}, state.tex has key=${svc.state.tex.has(rule.targetSpriteKey)}, items total=${svc.state.items.length}`);
  const origTex = svc.state.tex.get(rule.targetSpriteKey) ?? origItem?.first ?? null;
  log(`applyLayerA: origTex=${origTex ? 'ok' : 'null'}, origTex.baseTexture=${origTex?.baseTexture ? 'ok' : 'null/undefined'}, origTex.frame=${JSON.stringify(origTex?.frame ?? origTex?._frame ?? null)}`);
  ctx.origTextures.set(rule.id, origTex);
  if (origItem !== undefined) ctx.origItemFirsts.set(rule.id, origItem.first);
  clearRuleVariantTexturesForRule(rule.id);
  const prevCustom = ctx.ruleTextures.get(rule.id);
  if (prevCustom && prevCustom !== customTex) {
    queueTextureForRetirement(prevCustom);
  }
  ctx.ruleTextures.set(rule.id, customTex);
  ctx.ruleTextureFingerprints.set(rule.id, fingerprint);

  // Scoped rules: cache the texture for Layer B but do NOT swap the shared
  // texture in svc.state.tex — that would affect every tile/pet, not just the
  // target scope. Layer B applies the cached texture per-sprite after scope
  // filtering.
  if (!isScoped) {
    svc.state.tex.set(rule.targetSpriteKey, customTex);
    if (origItem !== undefined) origItem.first = customTex;
    invalidateSpriteKeyCache(rule.targetSpriteKey);
  }
  log(`applyLayerA: done — origTex stored for Layer B matching`);
}

export function revertLayerA(rule: TextureOverrideRule, svc: SpriteService): void {
  const isScoped = !!(rule.scope && rule.scope.kind !== 'all');
  clearRuleVariantTexturesForRule(rule.id);
  // The Rive-override clean texture wraps the rule's source canvas — if Layer A
  // is about to rebuild that canvas, the cached clean texture is stale.
  clearRiveOverrideTextureCache(rule.id);

  // Scoped rules never swapped the shared texture — skip global restore.
  if (!isScoped && ctx.origTextures.has(rule.id)) {
    const origTex = ctx.origTextures.get(rule.id);
    if (origTex !== null && origTex !== undefined) {
      svc.state.tex.set(rule.targetSpriteKey, origTex);
    } else {
      svc.state.tex.delete(rule.targetSpriteKey);
    }
    invalidateSpriteKeyCache(rule.targetSpriteKey);
  }
  ctx.origTextures.delete(rule.id);

  if (!isScoped) {
    const origItem = svc.state.items.find(it => it.key === rule.targetSpriteKey);
    if (origItem !== undefined && ctx.origItemFirsts.has(rule.id)) {
      origItem.first = ctx.origItemFirsts.get(rule.id);
    }
  }
  ctx.origItemFirsts.delete(rule.id);

  const customTex = ctx.ruleTextures.get(rule.id);
  if (customTex) {
    queueTextureForRetirement(customTex);
    ctx.ruleTextures.delete(rule.id);
  }
  // Drop the fingerprint so the next apply rebuilds (per PR #4 task 18).
  ctx.ruleTextureFingerprints.delete(rule.id);

  // NOTE: this function deliberately does NOT touch the ColorOverlay filter
  // cache. Silent slider/colour updates funnel through updateRule which calls
  // revertLayerA(old) → applyLayerA(new); destroying the filter here would
  // force a fresh PIXI Filter on every drag tick. The filter is preserved
  // and re-used (uniforms updated in place) by Layer B's reapply. Filter
  // disposal happens explicitly from deleteRule / revertAll paths via
  // disposeRuleOverlayFilter below.
}

/**
 * Tear down a live-overlay rule's runtime artifacts: destroy any per-sprite
 * child overlays it spawned. Called explicitly on rule deletion and teardown
 * — NOT during update, which preserves the overlay for reuse and just tweaks
 * its tint/alpha in place.
 */
export function disposeRuleOverlayFilter(_ruleId: string): void {
  // Current UX allows only one tint rule per sprite, so we don't tag
  // overlays by ruleId — simply destroy every tracked overlay. If the same
  // rule is being silently updated (uniform tweak), this path is NOT taken;
  // see comments in revertLayerA.
  destroyAllSpriteOverlays();
}

export async function applyAllLayerA(rules: TextureOverrideRule[]): Promise<void> {
  const svc = ctx.currentSvc;
  if (!svc) return;
  for (const rule of rules) {
    if (rule.targetCategory === 'avatar') continue;
    if (!ctx.ruleTextures.has(rule.id)) {
      await applyLayerA(rule, svc);
    }
  }
}

export function flushPendingTextureDestroy(): void {
  if (ctx.retiredTextures.size === 0) return;
  const queued = [...ctx.retiredTextures];
  ctx.retiredTextures.clear();
  for (const tex of queued) {
    try { tex.destroy(true); } catch {}
  }
}

/**
 * Return the original (pre-override) texture for a sprite key, if any active
 * rule has stored one. After applyLayerA, svc.state.tex and item.first point
 * at the customTex — this map is the only place the pre-rule texture survives
 * for preview-style reads.
 */
export function getStoredOriginalForKey(spriteKey: string): any | null {
  for (const [ruleId, origTex] of ctx.origItemFirsts.entries()) {
    const rule = ctx.state.rules.find(r => r.id === ruleId);
    if (rule?.targetSpriteKey === spriteKey && origTex) return origTex;
  }
  for (const [ruleId, origTex] of ctx.origTextures.entries()) {
    const rule = ctx.state.rules.find(r => r.id === ruleId);
    if (rule?.targetSpriteKey === spriteKey && origTex) return origTex;
  }
  return null;
}
