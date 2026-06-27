// src/ui/panel/tileHealth.ts
// Tile-status diagnostics integration (Phase 3.1).
//
// - Registers the `ui.tileStatuses` bus entry so Diagnostics has a meta row
//   for "tile providers are running".
// - Replaces silent `.catch(() => {})` with coded logger calls so dynamic-
//   import + async-work failures inside providers surface in the bus +
//   Diagnostics window instead of vanishing.
// - Provides `makeDepGuard()` — wraps a tile's render fn so that when a
//   dependent subsystem is `degraded`/`failed` on the bus, the tile shows
//   an alert message instead of stale data, and the bus drives re-renders
//   on dependency status changes.

import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import type { Subsystem, SubsystemStatus } from '../../diagnostics/types';
import { setStatusText } from './tileStatuses';

const log = createNamedLogger('ui.tileStatuses');

let busRegistered = false;

export function registerTileStatusesBusEntry(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register('ui.tileStatuses', {
    category: 'ui',
    status: 'ok',
    message: 'Tile providers running',
  });
}

export function logTileImportFailed(tile: string, err: unknown): void {
  log.warn('QPM-TILE-001', { tile }, err);
}

export function logTileAsyncFailed(tile: string, op: string, err: unknown): void {
  log.warn('QPM-TILE-002', { tile, op }, err);
}

interface DepGuard {
  /** Call this instead of the raw render function. Honours bus state. */
  readonly guardedRender: () => void;
  /** Unsubscribes from the bus. Add to the tile's live cleanup. */
  readonly cleanup: () => void;
}

/**
 * Wraps `render` so that whenever any subsystem in `dependsOn` is currently
 * `degraded` or `failed`, the tile shows a one-line alert instead. When the
 * dependency recovers (or any one of multiple deps is bad → all clear), the
 * normal render runs again on the next subscribe event.
 *
 * `depLabel` is the user-facing name shown in the alert text — short, e.g.
 * "catalogs" or "inventory".
 *
 * Multiple bad deps collapse to "first bad" — the tile is binary {ok, alert};
 * the full breakdown lives in the Diagnostics window.
 */
export function makeDepGuard(
  el: HTMLElement,
  render: () => void,
  dependsOn: readonly Subsystem[],
  depLabel: string,
): DepGuard {
  const firstBadDep = (): { dep: Subsystem; status: SubsystemStatus } | null => {
    for (const dep of dependsOn) {
      const h = healthBus.read(dep);
      if (h && (h.status === 'failed' || h.status === 'degraded')) {
        return { dep, status: h.status };
      }
    }
    return null;
  };

  const guardedRender = (): void => {
    const bad = firstBadDep();
    if (bad) {
      setStatusText(el, `${depLabel} ${bad.status}`, 'alert');
      return;
    }
    render();
  };

  const unsub = healthBus.subscribe((h) => {
    if (!dependsOn.includes(h.subsystem)) return;
    guardedRender();
  });

  return { guardedRender, cleanup: unsub };
}
