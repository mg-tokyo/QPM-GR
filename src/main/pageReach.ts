import { pageWindow } from '../core/pageContext';
import { warnCore } from './_diagnostics';

export type PageReach = 'page' | 'unreachable' | 'unknown';

// Page globals the game sets before its first render and QPM's Jotai bridge reads from
// pageWindow (src/core/jotaiBridge/cache.ts, state.ts NATIVE_STORE_KEY). An isolated script
// world shares the DOM, so it sees the game canvas, but not the page's globals.
const GAME_PAGE_GLOBALS: readonly string[] = ['jotaiAtomCache', '__jotaiStore'];

export function findPageReach(win: Window): PageReach {
  try {
    if (!win.document.querySelector('canvas')) return 'unknown';
    const globals = win as unknown as Record<string, unknown>;
    return GAME_PAGE_GLOBALS.some((name) => globals[name] != null) ? 'page' : 'unreachable';
  } catch {
    return 'unknown';
  }
}

let checked = false;

/** Call once the game UI is up: by then the game has set its page globals. */
export function reportIfPageUnreachable(): PageReach {
  if (checked) return 'unknown';
  checked = true;
  const reach = findPageReach(pageWindow);
  if (reach === 'unreachable') warnCore('QPM-INIT-003', {});
  return reach;
}
