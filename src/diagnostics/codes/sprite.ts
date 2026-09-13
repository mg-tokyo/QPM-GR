import type { ErrorCodeDefinition } from '../types';

// Keep in sync with CURRENT_VERSION in ../codes.ts (local copy avoids a
// circular import).
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
];
