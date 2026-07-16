// src/features/standalone/textureSwapper/rive/static-fallback.ts
// Phase 6 — Static-fallback toggle. Extracted from riveAdapter.ts during PR #1.
//
// Snippet A confirmed each Rive decor's tile container holds TWO sibling
// sprites: the static atlas sprite (visible=false, atlas-labeled) and the
// SharedRiveSprite (visible=true, empty texture label). When the user opts
// into static fallback for a rule, we invert visibility — re-show the
// static, hide the Rive — so the standard Layer A texture-swap pipeline
// works on the static sprite as it does for non-Rive decor.

import { log, warnFeature } from '../types';
import { staticFallbackToggled } from './state';

/**
 * Walk the Rive sprite's parent container for its sibling static atlas
 * sprite. Static sprites have textureLabel matching 'sprite/decor/<DecorId>'
 * and visible=false when Rive is rendering.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findStaticSpriteForRive(riveSprite: any): any | null {
  const parent = riveSprite?.parent;
  if (!parent || !Array.isArray(parent.children)) return null;
  for (const sib of parent.children) {
    if (sib === riveSprite) continue;
    const tex = sib?.texture;
    const lbl = (tex?.label || tex?._label || '') + '';
    if (lbl.startsWith('sprite/decor/')) return sib;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setRiveStaticFallback(riveSprite: any, enabled: boolean): void {
  if (enabled) {
    if (staticFallbackToggled.has(riveSprite as object)) return; // already toggled
    const staticSprite = findStaticSpriteForRive(riveSprite);
    if (!staticSprite) {
      log('setRiveStaticFallback: no static sibling found');
      warnFeature('QPM-TEXTURESWAP-001', { what: 'staticFallback:noSibling' });
      return;
    }
    riveSprite.visible = false;
    staticSprite.visible = true;
    staticFallbackToggled.set(riveSprite as object, { rive: riveSprite, staticSprite });
  } else {
    const toggle = staticFallbackToggled.get(riveSprite as object);
    if (!toggle) return;
    try { toggle.rive.visible = true; } catch { /* ignore */ }
    try { toggle.staticSprite.visible = false; } catch { /* ignore */ }
    staticFallbackToggled.delete(riveSprite as object);
  }
}
