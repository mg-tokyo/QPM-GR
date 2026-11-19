import type { ErrorCodeDefinition } from '../types';

const V = '3.3.65';
const SUB = 'feature:multiStorage';

export const MULTI_STORAGE_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-MSTORE-001', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Multi-storage panels unavailable (game changed)',
    description: 'A part of the game\'s storage window that multi-storage builds on is missing or changed shape, so the storages were not opened. The normal storage windows are unaffected.',
    userAction: 'None needed. Report it if it persists after a game update.',
    devNotes: 'src/features/multiStorage/gameHooks.ts checkStorageSystem() / checkFirstView(); context.missing names the failed handles (system fields, \'storage-panels\' when the game panel list is unread, \'view.*\' for the first built panel). QPM_DEBUG_API.multiStorage.check() re-runs the check.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-MSTORE-002', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Multi-storage panels failed to open',
    description: 'Opening several storage panels threw or the game\'s own storage window did not land in its panel, so everything was closed again.',
    userAction: 'None needed. The normal storage windows still work.',
    devNotes: 'src/features/multiStorage/session.ts openStorages(); context.stage is \'build\', \'first-panel\' (the real modal did not open inside the first host: decision P1) or \'modal-write\'.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-MSTORE-003', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Multi-storage panels opened without their move bar',
    description: 'The storages opened, but the bar to drag a panel by or its resize corner could not be built, so the panels stay where they opened.',
    userAction: 'None needed. Closing and reopening the storages tries again.',
    devNotes: 'src/features/multiStorage/chrome.ts createPanelChrome(); context.stage is \'kit\' (no plain PIXI sprite found inside the panel hosts, or uiContainer.toLocal / renderer.canvas missing), \'build\' (threw while dressing) or \'sync\' (the per-frame sync threw; header and grip were removed). QPM_DEBUG_API.multiStorage.panels() shows decorated.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-MSTORE-004', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Multi-storage panels opened without their value labels',
    description: 'The storages opened, but the coin value shown on each panel could not be built or failed while drawing, so the panels show no value.',
    userAction: 'None needed. Closing and reopening the storages tries again.',
    devNotes: 'src/features/multiStorage/valueLabels.ts createValueLabels(); context.stage is "kit" (no plain PIXI sprite inside the panel hosts), "build" or "sync" (threw; labels removed). QPM_DEBUG_API.multiStorage.values() lists each label.',
    sinceVersion: V, notifyUser: false,
  },
];
