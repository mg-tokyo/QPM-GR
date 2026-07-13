import { HYDRATION_EVENT, TARGET_COMPRESSED_COVERAGE } from './constants';
import type { SpriteHydrationStatus } from './types';

export function computeHydrationStatus(coverage: number): SpriteHydrationStatus {
  if (coverage >= TARGET_COMPRESSED_COVERAGE) return 'ok';
  if (coverage > 0) return 'degraded';
  return 'failed';
}

let lastHydrationDispatchFingerprint = '';
let lastHydrationDispatchAt = 0;
const HYDRATION_DEDUPE_WINDOW_MS = 500;

export function dispatchHydrationEvent(reason: string, detail: Record<string, unknown>): void {
  const coverageBucket = typeof detail.coverage === 'number'
    ? Math.round(detail.coverage * 100)
    : -1;
  const statusToken = typeof detail.status === 'string' ? detail.status : '';
  const fingerprint = `${reason}|${coverageBucket}|${statusToken}`;
  const now = Date.now();
  if (
    fingerprint === lastHydrationDispatchFingerprint &&
    now - lastHydrationDispatchAt < HYDRATION_DEDUPE_WINDOW_MS
  ) {
    return;
  }
  lastHydrationDispatchFingerprint = fingerprint;
  lastHydrationDispatchAt = now;

  const payload = {
    reason,
    at: now,
    ...detail,
  };
  const evt = new CustomEvent(HYDRATION_EVENT, { detail: payload });
  try {
    window.dispatchEvent(evt);
  } catch {
    // ignore event dispatch errors
  }
}
