import type { WindowState } from './types';

let globalState: WindowState | null = null;
let filtersCleanup: (() => void) | null = null;

export function getGlobalState(): WindowState | null {
  return globalState;
}

export function setGlobalState(state: WindowState | null): void {
  globalState = state;
}

export function clearFiltersCleanup(): void {
  filtersCleanup?.();
  filtersCleanup = null;
}

export function setFiltersCleanup(cleanup: (() => void) | null): void {
  filtersCleanup = cleanup;
}
