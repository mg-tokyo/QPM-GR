import type { ErrorCodeDefinition } from '../types';

// Keep in sync with CURRENT_VERSION in ../codes.ts (local copy avoids a
// circular import).
const V = '3.3.27';

export const PATCH_STAGE_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-STAGE-005',
    subsystem: 'patchStage',
    category: 'core',
    severity: 'error',
    title: 'Patch stage: onWelcome hook threw',
    description: 'The staging feature\'s Welcome hook threw; the doctored Welcome fan-out still ran.',
    devNotes: 'src/core/patchStage.ts welcomeMitm. Hook is supplied via enterPatchStage(doctor, suppress, { onWelcome }).',
    sinceVersion: V,
  },
  {
    code: 'QPM-STAGE-006',
    subsystem: 'patchStage',
    category: 'core',
    severity: 'error',
    title: 'Patch stage: Welcome doctoring failed',
    description: 'Doctoring the reconnect Welcome snapshot threw; the raw snapshot was passed through so the game could rebuild.',
    devNotes: 'src/core/patchStage.ts welcomeMitm catch. Expect the real garden to repaint until the next synthetic dispatch.',
    sinceVersion: V,
  },
  {
    code: 'QPM-STAGE-007',
    subsystem: 'patchStage',
    category: 'core',
    severity: 'error',
    title: 'Patch stage: late-subscriber doctored replay failed',
    description: 'A game system subscribed to Welcome mid-stage; replaying the doctored snapshot to it threw.',
    devNotes: 'src/core/patchStage.ts installSetOverrides onAdded microtask. Fires after a QuinoaEngine rebuild (transient reconnect).',
    sinceVersion: V,
  },
  {
    code: 'QPM-TD-STAGE-012',
    subsystem: 'td',
    category: 'feature',
    severity: 'warn',
    title: 'TD stage: player slot changed on reconnect',
    description: 'A Welcome snapshot seated the player in a different garden slot (or none). The stage went pass-through and the match was autosaved and closed.',
    devNotes: 'src/features/towerDefense/render/stage.ts onWelcome(). context.was / context.now are slot indices (-1 = not seated). launch.ts onStageLost() handles the quit + toast.',
    sinceVersion: V,
  },
];
