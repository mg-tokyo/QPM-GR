import type { ErrorCodeDefinition } from '../types';

const V = '3.2.29';

export const SPRITE_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-SPRITE-007',
    subsystem: 'spriteV2',
    category: 'core',
    severity: 'warn',
    title: 'Sprite constructor capture suspect',
    description: 'The PIXI Sprite class captured from the game stage does not define a `texture` accessor on its own prototype, so `new Sprite(texture)` may throw and every render path (QPM-SPRITE-004) fails.',
    userAction: 'Refresh the game tab. If it persists after a game update, report it.',
    devNotes: 'src/sprite-v2/utils.ts resolveBaseSpriteCtor: game 1152 put a Rive sprite subclass first in stage order; the resolver walks to the class that owns `texture`. If this fires, PIXI changed where `texture` lives — re-probe the constructor chain of __MG_SPRITE_STATE__.ctors.Sprite.',
    sinceVersion: V,
    notifyUser: false,
  },
  {
    code: 'QPM-SPRITE-008',
    subsystem: 'spriteV2',
    category: 'core',
    severity: 'warn',
    title: 'Pet Rive: no species discovered',
    description: 'Neither the asset manifest nor the game\'s own .riv fetches yielded any pet species file, so every pet species sprite falls back to the emoji placeholder.',
    userAction: 'Refresh the game tab. If it persists after a game update, report it.',
    devNotes: 'src/sprite-v2/petRive/bundleLoader.ts discoverPetRiveSources: game ≥1973 lists bundle `pets` with alias `rive/pets/<Species>.riv` → `/runtime-assets/<Species>.<hash>.riv`; older builds list one `rive/pets` asset. Check the manifest `pets` bundle shape and `listSeenRivUrls()` from src/rive-engine/fetchInterceptor.ts.',
    sinceVersion: '3.3.63',
    notifyUser: false,
  },
];
