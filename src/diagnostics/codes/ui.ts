import type { ErrorCodeDefinition } from '../types';

const V = '3.2.29';

export const UI_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-UI-001',
    subsystem: 'ui.window',
    category: 'ui',
    severity: 'error',
    title: 'Window render failed',
    description: 'A modal window threw during render. The shell remains intact; the body shows a structured error card via the error boundary.',
    devNotes: 'src/ui/core/modalWindow.ts try/catch around render() — context.id names the failing window; cause carries the original throw. src/ui/core/modalWindowErrorBoundary.ts paints the user-visible card.',
    sinceVersion: V,
  },
  {
    code: 'QPM-UI-002',
    subsystem: 'ui.window',
    category: 'ui',
    severity: 'warn',
    title: 'Window/panel helper failed',
    description: 'A window/panel helper threw. Parent op continues; fallbacks shown where present.',
    devNotes: 'src/ui/core/{modalWindow,originalPanel}.ts + src/ui/panel/{panelFooter,tileRegistry,standaloneTiles}.ts. context.what names the site; context.id/tile narrows.',
    sinceVersion: V,
  },
  {
    code: 'QPM-TILE-001',
    subsystem: 'ui.tileStatuses',
    category: 'ui',
    severity: 'warn',
    title: 'Tile provider import failed',
    description: 'A dynamic import inside a tile-status provider rejected. The tile keeps its last status text instead of updating.',
    devNotes: 'src/ui/panel/tileStatuses{Core,New}.ts — context.tile names the affected tile.',
    sinceVersion: V,
  },
  {
    code: 'QPM-TILE-002',
    subsystem: 'ui.tileStatuses',
    category: 'ui',
    severity: 'warn',
    title: 'Tile provider async work failed',
    description: 'An async operation inside a tile-status provider threw (fetch, store start, atom read). The tile keeps its last status text.',
    devNotes: 'src/ui/panel/tileStatuses{Core,New}.ts — context.tile + context.op identify the call site.',
    sinceVersion: V,
  },
  {
    code: 'QPM-TOUR-001',
    subsystem: 'ui.tour',
    category: 'ui',
    severity: 'warn',
    title: 'Tour overlay step failed',
    description: 'The tour engine swallowed an exception in an overlay render or step-progression path. The active tour is torn down so the user can keep using the app; previous behaviour silently dropped the rejection on the floor.',
    devNotes: 'src/ui/tour/engine.ts — context.phase identifies the call site (createOverlay | updateOverlayStep | destroyOverlay | showStep | teardown | startTour | positionTracking). src/ui/tour/help/panel.ts also uses phase=helpPanelSpriteImport / helpPanelReplayImport for its lazy-import failure paths. notifyUser intentionally false — a broken tour does not block the user\'s current task (criterion 1 of §9 fails).',
    sinceVersion: V,
  },
  // UI: Notification hub itself (§4.4 borderline → promoted Phase 5.4). The hub
  // is the user-facing end of the logger pipeline; if it breaks, the user gets
  // zero feedback for everything else, so its own degradation is uniquely
  // meta-critical and not surfaced anywhere else on the bus.
  {
    code: 'QPM-NOTIF-001',
    subsystem: 'ui.notifications',
    category: 'ui',
    severity: 'warn',
    title: 'Notification subscriber threw',
    description: 'A subscriber registered via onNotifications() threw during fan-out or its initial replay. The hub stays subscribed and the next notify() call will re-emit; the misbehaving subscriber may still be running.',
    devNotes: 'src/core/notifications.ts emit() / onNotifications() — context.at identifies the path (emit | initial). notifyUser intentionally false — a misbehaving subscriber typically belongs to a single UI surface that is already broken; the notification hub itself keeps working.',
    sinceVersion: V,
  },
];
