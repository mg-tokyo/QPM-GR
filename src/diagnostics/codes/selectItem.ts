import type { ErrorCodeDefinition } from '../types';

const V = '3.3.65';
const SUB = 'feature:selectItem';

export const SELECT_ITEM_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-SELECTITEM-001', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Pick-up animation unavailable (game changed)',
    description: 'A QPM key picked up or put away an item, but the game\'s avatar animation trigger was not found or refused the write, so the avatar did not animate. The item still moved to or from the hand.',
    userAction: 'None needed. Report it if it persists after a game update.',
    devNotes: 'src/features/input/selectItem/run.ts playCosmetics(); key avatarTriggerAnimation (avatarTriggerAnimationAtom). context.reason is \'no-player\' (playerId unread) or \'write\' (unbound or threw). Raised once per session.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-SELECTITEM-002', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Pick-up sound unavailable (game changed)',
    description: 'A QPM key picked up or put away an item, but the game\'s pick-up or drop sound is missing from the sound list, so no sound played. The item still moved to or from the hand.',
    userAction: 'None needed. Report it if it persists after a game update.',
    devNotes: 'src/features/input/selectItem/run.ts playCosmetics(); context.sfx names the missing sound (hasSfx false). Raised once per session per sound.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-SELECTITEM-003', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Item key pick did not take',
    description: 'A QPM key asked the server to put an item in the hand (or empty the hand), but the hand did not change. The game may have renamed the message or changed how items are identified.',
    userAction: 'Pick the item by hand. Report it if it keeps happening after a game update.',
    devNotes: 'src/features/input/selectItem/run.ts confirmHand(); context: expected (item id or null), held (selectedItemId after the wait), reply (\'ok\' | server code | \'none\' when no envelope result or it timed out).',
    sinceVersion: V, notifyUser: false,
  },
];
