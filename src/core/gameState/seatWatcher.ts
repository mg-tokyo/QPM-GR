// Reactive seat watcher: on every state event that touches userSlots, detects
// whether the resolved myIdx crossed the null↔number boundary and fires
// topology so the resolver re-walks {myIdx}-dependent keys. Rides the
// stateTree patch fan-out, which fires on both the room-patch and the
// stateAtom-fallback source and only after the snapshot has been updated.

import { createNamedLogger } from '../../diagnostics/logger';
import { subscribeToPatches, type PatchOp } from '../stateTree';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';
import { refreshIdentityAndDetectSeat } from './identity';
import { signalTopology } from './topology';

const log = createNamedLogger('gameState');
let unsubscribe: (() => void) | null = null;
let lastUserSlots: unknown = undefined;

function touchesUserSlots(patches: readonly PatchOp[]): boolean {
  for (const p of patches) {
    if (typeof p.path === 'string' && p.path.startsWith('/child/data/userSlots')) return true;
  }
  return false;
}

// Empty patch array = full snapshot with no patch data (stateAtom fallback,
// welcome); fall back to reference-comparing the userSlots array.
function userSlotsChanged(patches: readonly PatchOp[], state: QuinoaStateSnapshot): boolean {
  if (patches.length > 0) return touchesUserSlots(patches);
  const slots = (state as { child?: { data?: { userSlots?: unknown } } }).child?.data?.userSlots;
  const changed = slots !== lastUserSlots;
  lastUserSlots = slots;
  return changed;
}

export function startSeatWatcher(): void {
  if (unsubscribe) return;
  lastUserSlots = undefined;
  unsubscribe = subscribeToPatches((patches, state) => {
    if (!userSlotsChanged(patches, state)) return;
    const { seatTransition, ctx } = refreshIdentityAndDetectSeat();
    if (seatTransition) {
      signalTopology('identity:seat');
      log.info('QPM-ATOM-005', { myIdx: ctx.myIdx });
    }
  });
}

export function stopSeatWatcher(): void {
  try { unsubscribe?.(); } catch { /* ignore */ }
  unsubscribe = null;
  lastUserSlots = undefined;
}
