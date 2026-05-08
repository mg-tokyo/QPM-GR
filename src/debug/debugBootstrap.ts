import { shareGlobal } from '../core/pageContext';
import { DEBUG_GLOBALS_OPT_IN_KEY, isDebugGlobalsEnabled } from '../utils/debugGlobals';
import { getStorageRuntime, storage } from '../utils/storage';
import { setLocaleMode, getCurrentLocale, getLocaleMode } from '../i18n';

declare const GM_registerMenuCommand: ((caption: string, commandFunc: () => void) => void) | undefined;

export interface QpmBootStatus {
  debugEnabled: boolean;
  storageRuntime: string;
  optInKey: string;
  optInValue: unknown;
  hasDebugApi: boolean;
}

export interface QpmBootApi {
  status: () => QpmBootStatus;
  enableDebug: (reload?: boolean) => QpmBootStatus;
  disableDebug: (reload?: boolean) => QpmBootStatus;
  reload: () => void;
  setLocale: (locale: string, reload?: boolean) => void;
  getLocale: () => { locale: string; mode: string };
}

function readStatus(): QpmBootStatus {
  return {
    debugEnabled: isDebugGlobalsEnabled(),
    storageRuntime: getStorageRuntime(),
    optInKey: DEBUG_GLOBALS_OPT_IN_KEY,
    optInValue: storage.get<unknown>(DEBUG_GLOBALS_OPT_IN_KEY, null),
    hasDebugApi: typeof (window as Window & typeof globalThis & { QPM_DEBUG_API?: unknown }).QPM_DEBUG_API !== 'undefined',
  };
}

function reloadPage(): void {
  try {
    window.location.reload();
  } catch {
    // no-op
  }
}

export function createDebugBootstrapApi(): QpmBootApi {
  return {
    status: () => {
      const status = readStatus();
      console.info('[QPM_BOOT] status', status);
      return status;
    },
    enableDebug: (reload = true) => {
      storage.set(DEBUG_GLOBALS_OPT_IN_KEY, true);
      const status = readStatus();
      console.info('[QPM_BOOT] Debug API enabled. Reload required for QPM_DEBUG_API.', status);
      if (reload) reloadPage();
      return status;
    },
    disableDebug: (reload = true) => {
      storage.set(DEBUG_GLOBALS_OPT_IN_KEY, false);
      const status = readStatus();
      console.info('[QPM_BOOT] Debug API disabled. Reload required to remove debug globals.', status);
      if (reload) reloadPage();
      return status;
    },
    reload: reloadPage,
    setLocale: (locale: string, reload = true) => {
      setLocaleMode(locale === 'follow-game' ? 'follow-game' : locale as import('../i18n').QpmLocale);
      console.info(`[QPM_BOOT] Locale mode set to "${locale}". Current locale: ${getCurrentLocale()}`);
      if (reload) reloadPage();
    },
    getLocale: () => {
      const info = { locale: getCurrentLocale(), mode: getLocaleMode() as string };
      console.info('[QPM_BOOT] locale', info);
      return info;
    },
  };
}

export function registerDebugBootstrap(): QpmBootApi {
  const api = createDebugBootstrapApi();
  shareGlobal('QPM_BOOT', api);
  (window as Window & typeof globalThis & { QPM_BOOT?: QpmBootApi }).QPM_BOOT = api;

  try {
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('QPM: Enable Debug API', () => { api.enableDebug(true); });
      GM_registerMenuCommand('QPM: Disable Debug API', () => { api.disableDebug(true); });
      GM_registerMenuCommand('QPM: Show Debug Status', () => { api.status(); });
    }
  } catch {
    // no-op
  }

  return api;
}
