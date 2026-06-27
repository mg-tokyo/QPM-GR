// src/diagnostics/init.ts — Diagnostics layer bootstrap.

import { registerWindowOpener, toggleWindow } from '../ui/core/modalWindow';
import {
  DIAGNOSTICS_WINDOW_ID,
  DIAGNOSTICS_WINDOW_TITLE,
  renderDiagnosticsWindow,
} from './diagnosticsWindow';
import { errorBuffer } from './errorBuffer';
import { exposeDiagnosticsApi } from './expose';
import { startGameVersionCapture } from './gameVersionCapture';
import { healthBus } from './healthBus';
import { mountPanelBadge, unmountPanelBadge } from './panelBadge';

let initialised = false;

/**
 * Bring the diagnostics layer online. Idempotent — safe to call multiple times.
 *
 * Must run BEFORE any module attempts to register with the bus (currently a
 * no-op as no subsystems publish in Phase 1, but Phase 2 starts wiring them).
 */
export function initDiagnostics(): void {
  if (initialised) return;
  initialised = true;

  startGameVersionCapture();
  errorBuffer.hydrate();

  registerWindowOpener(DIAGNOSTICS_WINDOW_ID, () => {
    toggleWindow(DIAGNOSTICS_WINDOW_ID, DIAGNOSTICS_WINDOW_TITLE, renderDiagnosticsWindow, '720px', '78vh');
  });

  exposeDiagnosticsApi();
}

/**
 * Mount the titlebar badge once the panel exists. Call this AFTER
 * createOriginalUI() so the titlebar DOM is in the document.
 */
export function mountDiagnosticsBadge(): void {
  mountPanelBadge();
}

export function teardownDiagnostics(): void {
  if (!initialised) return;
  unmountPanelBadge();
  healthBus.teardown();
  errorBuffer.flush();
  initialised = false;
}
