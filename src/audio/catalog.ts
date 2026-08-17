import { visibleInterval } from '../utils/scheduling/timerManager';
import { dispatchCustomEventAll } from '../core/pageContext';
import { getAudioBridge } from './bridge';
import { isFetchedReady, fetchedNames, tryInitAudiosprite } from './audiosprite';
import type { AudioRoute, SfxName } from './types';

export type AudioSubroute = 'bridge' | 'fetched' | null;
let subroute: AudioSubroute = null;
export function getSubroute(): AudioSubroute { return subroute; }

const POLL_MS = 500;
// Audio load is deferred by the game until the useQuinoaAudio effect fires
// (which requires isPixiInitialized + a mounted Quinoa canvas). On a slow
// join or a delayed first interaction that can be well past 30s.
const HARD_DEADLINE_MS = 90_000;

let ready = false;
let route: AudioRoute = 'none';
let names: ReadonlySet<string> = new Set();
let stopPoll: (() => void) | null = null;
let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
const readyCbs: Array<() => void> = [];
const timedOutCbs: Array<() => void> = [];

export function isAudioReady(): boolean { return ready; }
export function getRoute(): AudioRoute { return route; }
export function getSfxNames(): readonly string[] { return Array.from(names); }
export function hasSfx(name: string): boolean { return names.has(name); }

export function onAudioReady(cb: () => void): () => void {
  if (ready) { try { cb(); } catch { /* boundary */ } return () => { /* noop */ }; }
  readyCbs.push(cb);
  return () => {
    const i = readyCbs.indexOf(cb);
    if (i >= 0) readyCbs.splice(i, 1);
  };
}

export function onAudioTimedOut(cb: () => void): () => void {
  timedOutCbs.push(cb);
  return () => {
    const i = timedOutCbs.indexOf(cb);
    if (i >= 0) timedOutCbs.splice(i, 1);
  };
}

export function waitForAudio(timeoutMs = HARD_DEADLINE_MS): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let done = false;
    const off = onAudioReady(() => { if (done) return; done = true; resolve(true); });
    setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve(ready);
    }, timeoutMs);
  });
}

function markReady(newRoute: AudioRoute, catalog: readonly string[], sub: AudioSubroute = null): void {
  if (ready) return;
  route = newRoute;
  subroute = sub;
  names = new Set(catalog);
  ready = true;
  stopPollLoop();
  clearDeadline();
  dispatchCustomEventAll('qpm:audio-ready', { route: newRoute, count: catalog.length, subroute: sub });
  const list = readyCbs.splice(0);
  for (const cb of list) { try { cb(); } catch { /* boundary */ } }
}

export function markFallbackReady(catalog: readonly string[]): void {
  markReady('fallback', catalog);
}

export function markNone(): void {
  if (ready) return;
  route = 'none';
  ready = true;
  stopPollLoop();
  clearDeadline();
  const list = timedOutCbs.splice(0);
  for (const cb of list) { try { cb(); } catch { /* boundary */ } }
}

function tryResolveBridge(): boolean {
  if (ready) return true;
  const b = getAudioBridge();
  if (!b || !b.hasAtlas()) return false;
  const atlas = b.getAtlas();
  if (!atlas) return false;
  const keys = Object.keys(atlas);
  if (keys.length === 0) return false;
  markReady('audiosprite', keys as SfxName[], 'bridge');
  return true;
}

function tryResolveFetched(): boolean {
  if (ready) return true;
  if (!isFetchedReady()) return false;
  const keys = fetchedNames();
  if (keys.length === 0) return false;
  markReady('audiosprite', keys as SfxName[], 'fetched');
  return true;
}

export function startCatalogPoll(): void {
  if (stopPoll || ready) return;
  // Kick off the audiosprite fetch route in parallel; it resolves via
  // performance.getEntriesByType so it fires as soon as the game has cached
  // the sfx MP3 + atlas JSON.
  void tryInitAudiosprite().then((ok) => { if (ok) tryResolveFetched(); });

  const tryResolve = (): void => {
    if (ready) return;
    if (tryResolveBridge()) return;
    // Re-attempt fetch discovery on each tick: the sfx resources may load
    // late (deferred by useQuinoaAudio effect firing after canvas mount).
    void tryInitAudiosprite().then((ok) => { if (ok) tryResolveFetched(); });
  };
  tryResolve();
  if (ready) return;
  stopPoll = visibleInterval('qpm.audio.catalog.poll', tryResolve, POLL_MS);
  deadlineTimer = setTimeout(() => {
    deadlineTimer = null;
    if (ready) return;
    stopPollLoop();
    const list = timedOutCbs.splice(0);
    for (const cb of list) { try { cb(); } catch { /* boundary */ } }
  }, HARD_DEADLINE_MS);
}

function stopPollLoop(): void {
  if (stopPoll) { try { stopPoll(); } catch { /* boundary */ } stopPoll = null; }
}

/** Force a one-shot re-check; used by the gesture primer. Async so it can
 *  await the audiosprite fetch/decode when discovery hasn't fired yet. */
export function retryCatalogNow(): void {
  if (ready && route !== 'none') return;
  if (tryResolveBridge()) return;
  if (tryResolveFetched()) return;
  void tryInitAudiosprite().then((ok) => { if (ok) tryResolveFetched(); });
}

function clearDeadline(): void {
  if (deadlineTimer !== null) { clearTimeout(deadlineTimer); deadlineTimer = null; }
}

export function stopCatalog(): void {
  stopPollLoop();
  clearDeadline();
  readyCbs.length = 0;
  timedOutCbs.length = 0;
  ready = false;
  route = 'none';
  subroute = null;
  names = new Set();
}
