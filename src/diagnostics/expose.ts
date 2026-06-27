// src/diagnostics/expose.ts — window.QPM_DIAGNOSTICS_V1 (§11)
//
// Read-only contract surfaced to QPM FULL PRIVATE (and any other consumer)
// in both sandbox and page realms. Diagnostics data is always available —
// the qpm.debug.globals.v1 gate covers the QPM.* console power-API only.

import { shareGlobal } from '../core/pageContext';
import { lookupCode } from './codes';
import { healthBus } from './healthBus';
import type { DiagnosticsPublicApi } from './types';

const PUBLIC_VERSION = '1.0.0';

export function exposeDiagnosticsApi(): void {
  const api: DiagnosticsPublicApi = {
    version: PUBLIC_VERSION,
    healthBus: {
      read: (subsystem) => healthBus.read(subsystem),
      readAll: () => healthBus.readAll(),
      subscribe: (cb) => healthBus.subscribe(cb),
      aggregate: () => healthBus.aggregate(),
    },
    codes: {
      lookup: (code) => lookupCode(code),
    },
  };

  try {
    shareGlobal('QPM_DIAGNOSTICS_V1', api);
  } catch {
    // shareGlobal swallows its own errors; this is a defence-in-depth catch.
  }
}
