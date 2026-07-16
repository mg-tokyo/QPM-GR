import type { SuperCleanseSnapshot } from './types';

export const cleanups: Array<() => void> = [];
export const listeners = new Set<(s: SuperCleanseSnapshot) => void>();

let initializedFlag = false;

export function isInitialized(): boolean {
  return initializedFlag;
}

export function markInitialized(v: boolean): void {
  initializedFlag = v;
}
