// src/features/standalone/textureSwapper/rive/pet-swap.ts
// Public wrappers for Rive pet swap — resolve PIXI ctors and forward to
// rivePetOverlay implementation. Extracted from riveAdapter.ts during PR #1.

import { ctx, log } from '../types';
import {
  applyRivePetSwap as _applyRivePetSwap,
  clearRivePetSwap as _clearRivePetSwap,
} from '../rivePetOverlay';
import { getBasePixiSpriteCtor } from './detection';

/**
 * Public entry — apply a pet swap as a sibling overlay (hides rive pet,
 * adds a sibling Sprite with customTex). Resolves the base PIXI ctors so
 * callers don't have to pass them in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRivePetSwap(sprite: any, ruleId: string, customTex: any): void {
  const Sprite = getBasePixiSpriteCtor(sprite);
  const Container = ctx.currentSvc?.state.ctors?.Container;
  if (!Sprite || !Container) {
    log('applyRivePetSwap: PIXI ctors not ready');
    return;
  }
  _applyRivePetSwap(sprite, ruleId, customTex, Sprite, Container);
}

/** Public entry — tear down one rule's pet swap overlay. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearRivePetSwap(sprite: any, ruleId: string): void {
  _clearRivePetSwap(sprite, ruleId);
}
