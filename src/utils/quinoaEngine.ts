// Game engine handle shapes. Pre-1152 the engine exposed getSystem(name)
// directly; since 1152 systems live on boot.seatScope / boot.worldScope and
// each scope exposes getSystem(name). Evidence: spec 2026-09-13-game-1152-drift §3.
import { isRecord } from './typeGuards';

export function isQuinoaEngine(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.getSystem === 'function') return true;
  return isRecord(v.boot) && ('seatScope' in v.boot || 'worldScope' in v.boot);
}

/** Seat scope first (inventory, petSlots, shop…), then world scope (map, tileObject, pet…). Null when absent (no seat while spectating). */
export function getEngineSystem(engine: unknown, name: string): unknown {
  if (!isRecord(engine)) return null;
  if (typeof engine.getSystem === 'function') {
    try { return (engine.getSystem as (n: string) => unknown)(name) ?? null; } catch { return null; }
  }
  const boot = engine.boot;
  if (!isRecord(boot)) return null;
  for (const scope of [boot.seatScope, boot.worldScope]) {
    if (!isRecord(scope) || typeof scope.getSystem !== 'function') continue;
    try {
      const system = (scope.getSystem as (n: string) => unknown)(name);
      if (system) return system;
    } catch { /* scope disposed mid-walk */ }
  }
  return null;
}
