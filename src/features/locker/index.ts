// src/features/locker/index.ts
// Public API for the Action Guard (Locker).

import { registerSendPreflight, clearSendPreflight } from '../../websocket/api';
import { lockerPreflight, startNativeHook, stopNativeHook } from './guard';

let running = false;

export function startLocker(): void {
  if (running) return;
  running = true;
  registerSendPreflight(lockerPreflight);
  startNativeHook();
}

export function stopLocker(): void {
  if (!running) return;
  running = false;
  clearSendPreflight();
  stopNativeHook();
}

export function isLockerRunning(): boolean {
  return running;
}

export { getLockerConfig, updateLockerConfig, resetLockerConfig } from './state';
export type { LockerConfig, GuardResult } from './types';
