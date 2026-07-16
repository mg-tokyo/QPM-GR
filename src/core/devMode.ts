import { storage } from '../utils/storage';
import { isDebugGlobalsEnabled } from '../utils/debugGlobals';
import { dispatchCustomEventAll } from './pageContext';

const KEY = 'qpm.dev.enabled';
const EVENT = 'qpm:dev-mode-changed';

// Dev mode unlocks the Garden Painter's extra picker tabs (Catalog / UI /
// World / Weather). It is on whenever either the standalone `qpm.dev.enabled`
// flag is set OR debug mode is on — matches the original ask "gate the whole
// expansion behind qpm boot debug enabled" while keeping the standalone flag
// usable on its own.
export function isDevModeEnabled(): boolean {
  if (storage.get<boolean>(KEY, false) === true) return true;
  return isDebugGlobalsEnabled();
}

export function setDevModeEnabled(enabled: boolean): void {
  const next = !!enabled;
  storage.set(KEY, next);
  dispatchCustomEventAll(EVENT, { enabled: next });
}

export type DevModeListener = (enabled: boolean) => void;

export function onDevModeChange(cb: DevModeListener): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
    cb(!!detail?.enabled);
  };
  window.addEventListener(EVENT, handler);
  return () => {
    window.removeEventListener(EVENT, handler);
  };
}
