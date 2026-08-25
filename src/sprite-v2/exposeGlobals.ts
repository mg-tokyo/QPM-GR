// Publishes the sprite service to shared window globals. Collision-safe:
// QPM tags its own service (__qpmService) and never shadows a foreign
// __MG_SPRITE_SERVICE__ (Aries) — QPM itself reads that global as a PIXI
// fallback (service/pixiResolve.ts checkAriesService), so clobbering it
// would break the very coexistence path it exists for.

import type { SpriteService } from './types';
import { getRuntimeWindow } from './detector';

function collectTargets(): Array<Record<string, unknown>> {
  const targets = new Set<unknown>([getRuntimeWindow(), window]);
  const out: Array<Record<string, unknown>> = [];
  for (const t of targets) {
    if (t) out.push(t as Record<string, unknown>);
  }
  return out;
}

function isQpmOwnedService(value: unknown): boolean {
  if (value === undefined || value === null) return true; // absent — free to claim
  return !!value && typeof value === 'object' && (value as Record<string, unknown>).__qpmService === true;
}

export function exposeSpriteGlobals(service: SpriteService): void {
  (service as unknown as Record<string, unknown>).__qpmService = true;

  for (const target of collectTargets()) {
    // Namespaced handle — always published, never contested.
    target.__QPM_SPRITE_SERVICE__ = service;

    // MG_* family: claim only if absent or previously claimed by QPM.
    let ownsFamily = false;
    try {
      ownsFamily = isQpmOwnedService(target.__MG_SPRITE_SERVICE__);
    } catch {
      ownsFamily = false;
    }
    if (ownsFamily) {
      target.__MG_SPRITE_STATE__ = service.state;
      target.__MG_SPRITE_CFG__ = service.cfg;
      target.__MG_SPRITE_SERVICE__ = service;
      target.MG_SPRITE_HELPERS = service;
    }

    // Bare-name console helpers: if-absent aliases only — these names are
    // generic enough that another mod may legitimately own them.
    const aliases: Record<string, unknown> = {
      getSpriteWithMutations: service.getSpriteWithMutations,
      getBaseSprite: service.getBaseSprite,
      buildSpriteVariant: service.buildVariant,
      listSpritesByCategory: service.list,
      renderSpriteToCanvas: service.renderToCanvas,
      renderSpriteToDataURL: service.renderToDataURL,
    };
    for (const [name, fn] of Object.entries(aliases)) {
      try {
        if (target[name] === undefined || target[name] === null) {
          target[name] = fn;
        }
      } catch { /* locked global — skip */ }
    }
  }
}

export function exposeSpriteCatalogApi(api: Record<string, unknown>): void {
  for (const target of collectTargets()) {
    target.MGSpriteCatalog = api;
  }
}
