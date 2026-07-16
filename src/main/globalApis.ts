import { shareGlobal } from '../core/pageContext';
import { writeShimConsole } from '../diagnostics/logger';
import { storage } from '../utils/storage';
import { DEBUG_GLOBALS_OPT_IN_KEY } from '../utils/debugGlobals';
import { resetFriendsCache } from '../services/ariesPlayers';
import { openInspectorDirect } from '../ui/standalone/publicRoomsWindow';
import { QPM_DEBUG_API, QPM_ACTIVITY_LOG_API } from '../debug/mainApi';
import { diag, warnCore } from './_diagnostics';

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

export function initializeGlobalApis(debugGlobalsEnabled: boolean): void {
  try {
    shareGlobal('QPM_ACTIVITY_LOG', QPM_ACTIVITY_LOG_API);
    (window as any).QPM_ACTIVITY_LOG = QPM_ACTIVITY_LOG_API;
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'globalApis:exposeActivityLog' }, error);
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
    diag.debug('QPM debug API registered');
  } else {
    diag.debug('Debug globals disabled', { optInKey: DEBUG_GLOBALS_OPT_IN_KEY });
  }
}

// Dev-tool console helpers exposed on window when debug globals are on. The
// fn bodies keep raw-style console output (via writeShimConsole) because they
// respond to interactive `QPM_INSPECT_*(...)` calls the user typed at the
// devtools prompt — routing that feedback through diag.debug would gate it
// behind verbose-logs and break the tool's UX. Registration-side share
// failures still route through warnCore so the `init` bus row degrades.
function registerInspectFriendHelper(): void {
  const fn = (playerId: string): void => {
    const pid = (playerId || '').trim();
    if (!pid) {
      writeShimConsole('QPM Inspector', ['Provide a playerId string.']);
      return;
    }
    try {
      storage.set('quinoa:selfPlayerId', pid);
      resetFriendsCache();
      writeShimConsole('QPM Inspector', ['self playerId set to', pid, 'friend cache cleared.']);
    } catch (err) {
      writeShimConsole('QPM Inspector', ['Unable to persist self playerId', err]);
    }
  };

  if (!(window as any).QPM_INSPECT_FRIEND) {
    (window as any).QPM_INSPECT_FRIEND = fn;
  }

  try {
    shareGlobal('QPM_INSPECT_FRIEND', fn);
  } catch (err) {
    warnCore('QPM-INIT-001', { what: 'inspector:friendShare' }, err);
  }
}

function registerInspectPlayerHelper(): void {
  const fn = (playerId: string, playerName?: string): void => {
    const pid = (playerId || '').trim();
    if (!pid) {
      writeShimConsole('PublicRooms', ['Provide a playerId string.']);
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
    warnCore('QPM-INIT-001', { what: 'inspector:playerShare' }, err);
  }
}
