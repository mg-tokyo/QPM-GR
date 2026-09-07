import type { ReactiveHook } from './types';
import { getStoreRef } from './state';
import { batchedSubscriptionManager } from './polling';

let _reactiveHook: ReactiveHook | null = null;

/**
 * Called once during boot (see main.ts) to install the reactive manager's
 * subscribe route. Idempotent — subsequent calls replace the hook.
 */
export function installReactiveHook(hook: ReactiveHook | null): void {
  _reactiveHook = hook;
}

export function getReactiveHook(): ReactiveHook | null {
  return _reactiveHook;
}

/**
 * Diagnostic — exposed via __QPM_INTERNAL__. Returns the current reactive
 * hook state so we can debug why kill switches aren't routing.
 */
export function debugReactiveRouting(): {
  hookInstalled: boolean;
  storeSource: string | undefined;
  storeIsPolyfill: boolean | undefined;
  batchedSubscribers: number;
} {
  const store = getStoreRef();
  return {
    hookInstalled: _reactiveHook !== null,
    storeSource: store?.__source,
    storeIsPolyfill: store?.__polyfill,
    batchedSubscribers: batchedSubscriptionManager.getStats().count,
  };
}
