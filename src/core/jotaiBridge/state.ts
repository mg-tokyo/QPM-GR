// Module-scope mutable state shared by the jotaiBridge split. Accessors
// instead of bare exports so the sibling files never form an import cycle.
import type { AtomCacheLike, CaptureMode, JotaiStore } from './types';

export const STORE_GLOBAL_KEY = '__qpmJotaiStore__';
export const CACHE_GLOBAL_KEY = '__qpmJotaiAtomCache__';
export const SHARED_STORE_KEYS = [
  '__jotaiStore',      // Aries Mod primary
  'jotaiStore',        // Aries Mod alternate
  '__MG_SHARED_JOTAI__',
  '__MGTOOLS_JOTAI_STORE__',
  '__QPM_SHARED_JOTAI__',
  '__QPM_JOTAI_STORE__',
] as const;
export const STORE_FAILURE_THRESHOLD = 3;

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let liveAtomCache: AtomCacheLike | null = null;
let storeRef: JotaiStore | null = null;
let captureInFlight = false;
let lastCaptureMode: Exclude<CaptureMode, 'none'> | null = null;
let consecutiveStoreGetFailures = 0;

export function getLiveAtomCache(): AtomCacheLike | null { return liveAtomCache; }
export function setLiveAtomCache(v: AtomCacheLike | null): void { liveAtomCache = v; }
export function getStoreRef(): JotaiStore | null { return storeRef; }
export function setStoreRef(v: JotaiStore | null): void { storeRef = v; }
export function isCaptureInFlight(): boolean { return captureInFlight; }
export function setCaptureInFlight(v: boolean): void { captureInFlight = v; }
export function getLastCaptureMode(): Exclude<CaptureMode, 'none'> | null { return lastCaptureMode; }
export function setLastCaptureMode(v: Exclude<CaptureMode, 'none'> | null): void { lastCaptureMode = v; }
export function getConsecutiveStoreGetFailures(): number { return consecutiveStoreGetFailures; }
export function setConsecutiveStoreGetFailures(v: number): void { consecutiveStoreGetFailures = v; }
