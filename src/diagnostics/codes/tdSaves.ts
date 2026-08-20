// src/diagnostics/codes/tdSaves.ts — TD save-system codes, split out of
// codes.ts to stay under the 750-line hard cap.

import type { ErrorCodeDefinition } from '../types';

// Keep in sync with CURRENT_VERSION in ../codes.ts (local copy avoids a
// circular import).
const V = '3.3.27';

export const TD_SAVES_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-TDSAVE-001',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'TD saves: store shape mismatch',
    description: 'qpm.td.saves.v1 was not a v1 saves document; it was backed up and replaced with an empty store.',
    devNotes: 'src/features/towerDefense/saves/store.ts loadFromStorage(). Backup key: qpm.td.saves.v1.corrupt.<timestamp>.',
    sinceVersion: V,
  },
  {
    code: 'QPM-TDSAVE-002',
    subsystem: 'feature',
    category: 'feature',
    severity: 'info',
    title: 'TD saves: balance-version wipe',
    description: 'One or more saved runs were dropped because TD_BALANCE_VERSION changed since they were written.',
    devNotes: 'src/features/towerDefense/saves/store.ts initTdSaves(); context.wiped is the count. launch.ts toasts feature.towerDefense.saveWipeToast once when > 0.',
    sinceVersion: V,
  },
];
