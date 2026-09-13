import type { ErrorCodeDefinition } from '../types';

// Keep in sync with CURRENT_VERSION in ../codes.ts (local copy avoids a
// circular import). Ships in 3.3.47 alongside the reactive seat watcher.
const V = '3.3.47';

export const GAMESTATE_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-ATOM-005',
    subsystem: 'gameState',
    category: 'core',
    severity: 'info',
    title: 'Seat topology transition',
    description: 'The player\'s myUserSlotIdx crossed the null↔number boundary. The reactive seat watcher signals the topology reason "identity:seat" so the resolver re-walks {myIdx}-dependent keys within one userSlots patch batch.',
    devNotes: 'src/core/gameState/seatWatcher.ts — informational; correlate rebind spikes with seat transitions. context.phase === "attach" means subscribeToPatches threw during install (escalated to warn at the call site).',
    sinceVersion: V,
    notifyUser: false,
  },
];
