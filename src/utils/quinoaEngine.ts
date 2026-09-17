// Game engine handle shapes across builds.
//   Pre-1152: engine.getSystem(name) directly.
//   Game 1152: boot.{seatScope,worldScope}.getSystem(name).
//   Game 1202: page.{playerViews,rendererScope}.systemRegistry.getSystem(name) —
//     playerViews = seat scope, rendererScope = world scope. Live-verified against
//     quinoaDevEngineAtom on 2026-09-17.
import { isRecord } from './typeGuards';

export function isQuinoaEngine(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.getSystem === 'function') return true;
  if (isRecord(v.boot) && ('seatScope' in v.boot || 'worldScope' in v.boot)) return true;
  if (isRecord(v.page) && (isRecord(v.page.playerViews) || isRecord(v.page.rendererScope))) return true;
  return false;
}

function registryOf(scope: unknown): { getSystem: (n: string) => unknown } | null {
  if (!isRecord(scope)) return null;
  const registry = (scope as { systemRegistry?: unknown }).systemRegistry;
  if (!isRecord(registry) || typeof registry.getSystem !== 'function') return null;
  return registry as { getSystem: (n: string) => unknown };
}

/** Seat scope first (inventory, petSlots, shop…), then world scope (map, tileObject, pet…). Null when absent (no seat while spectating). */
export function getEngineSystem(engine: unknown, name: string): unknown {
  if (!isRecord(engine)) return null;
  if (typeof engine.getSystem === 'function') {
    try { return (engine.getSystem as (n: string) => unknown)(name) ?? null; } catch { return null; }
  }
  const boot = engine.boot;
  if (isRecord(boot)) {
    for (const scope of [boot.seatScope, boot.worldScope]) {
      if (!isRecord(scope) || typeof scope.getSystem !== 'function') continue;
      try {
        const system = (scope.getSystem as (n: string) => unknown)(name);
        if (system) return system;
      } catch { /* scope disposed mid-walk */ }
    }
  }
  const page = engine.page;
  if (isRecord(page)) {
    for (const registry of [registryOf(page.playerViews), registryOf(page.rendererScope)]) {
      if (!registry) continue;
      try {
        const system = registry.getSystem(name);
        if (system) return system;
      } catch { /* registry disposed mid-walk */ }
    }
  }
  return null;
}
