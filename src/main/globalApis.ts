import { shareGlobal } from '../core/pageContext';
import { log } from '../utils/logger';
import { storage } from '../utils/storage';
import { DEBUG_GLOBALS_OPT_IN_KEY } from '../utils/debugGlobals';
import { resetFriendsCache } from '../services/ariesPlayers';
import { openInspectorDirect } from '../ui/standalone/publicRoomsWindow';
import { QPM_DEBUG_API, QPM_ACTIVITY_LOG_API } from '../debug/mainApi';

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

export function initializeGlobalApis(debugGlobalsEnabled: boolean): void {
  try {
    shareGlobal('QPM_ACTIVITY_LOG', QPM_ACTIVITY_LOG_API);
    (window as any).QPM_ACTIVITY_LOG = QPM_ACTIVITY_LOG_API;
  } catch (error) {
    log('[Main] Failed to expose QPM_ACTIVITY_LOG API', error);
  }

  if (debugGlobalsEnabled) {
    registerInspectFriendHelper();
    registerInspectPlayerHelper();
  }

  if (debugGlobalsEnabled) {
    shareGlobal('QPM', QPM_DEBUG_API);
    shareGlobal('QPM_DEBUG_API', QPM_DEBUG_API);
    const globalDebugTarget = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    (globalDebugTarget as any).QPM_DEBUG_API = QPM_DEBUG_API;
    (globalDebugTarget as any).QPM = QPM_DEBUG_API;
    log('QPM debug API registered');
  } else {
    log(`[Main] Debug globals disabled. Set ${DEBUG_GLOBALS_OPT_IN_KEY}=true to enable.`);
  }
}

// Simple console helper to force inspector self playerId for friend-level testing
function registerInspectFriendHelper(): void {
  const fn = (playerId: string): void => {
    const pid = (playerId || '').trim();
    if (!pid) {
      console.warn('[QPM Inspector] Provide a playerId string.');
      return;
    }
    try {
      storage.set('quinoa:selfPlayerId', pid);
      resetFriendsCache();
      console.log('[QPM Inspector] self playerId set to', pid, 'friend cache cleared.');
    } catch (err) {
      console.warn('[QPM Inspector] Unable to persist self playerId', err);
    }
  };

  if (!(window as any).QPM_INSPECT_FRIEND) {
    (window as any).QPM_INSPECT_FRIEND = fn;
  }

  try {
    shareGlobal('QPM_INSPECT_FRIEND', fn);
  } catch (err) {
    console.warn('[QPM Inspector] Failed to share helper globally', err);
  }
}

function registerInspectPlayerHelper(): void {
  const fn = (playerId: string, playerName?: string): void => {
    const pid = (playerId || '').trim();
    if (!pid) {
      console.warn('[PublicRooms] Provide a playerId string.');
      return;
    }
    openInspectorDirect(pid, playerName || pid);
  };

  if (!(window as any).QPM_INSPECT_PLAYER) {
    (window as any).QPM_INSPECT_PLAYER = fn;
  }

  try {
    shareGlobal('QPM_INSPECT_PLAYER', fn);
  } catch (err) {
    console.warn('[PublicRooms] Failed to share QPM_INSPECT_PLAYER globally', err);
  }
}
