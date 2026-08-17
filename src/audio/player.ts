import { createNamedLogger } from '../diagnostics/logger';
import { getAudioBridge } from './bridge';
import { getRoute, getSubroute, hasSfx, retryCatalogNow } from './catalog';
import { fallbackHas, fallbackPlay, fallbackStartLoop, fallbackStopAll } from './fallback';
import type { FallbackLoopHandle } from './fallback';
import {
  fetchedHas, fetchedPlay, fetchedStartLoop, fetchedStopAll, fetchedResumeContext,
  fetchedActiveCount,
} from './audiosprite';
import type { FetchedLoopHandle } from './audiosprite';
import { getEffectiveVolume } from './settings';
import type { BridgeLoopHandle, PlaySfxOptions, SfxLoopHandle } from './types';

const audioLog = createNamedLogger('audio');
const warnedUnknown = new Set<string>();

const bridgeLoops = new Set<BridgeLoopHandle>();
const fallbackLoops = new Set<FallbackLoopHandle>();
const fetchedLoops = new Set<FetchedLoopHandle>();

export function playSfx(name: string, opts?: PlaySfxOptions): void {
  const volume = getEffectiveVolume(opts?.feature, opts?.volumeMultiplier, opts?.volumeOverride);
  if (volume <= 0) return;

  const route = getRoute();
  if (route === 'audiosprite') {
    if (!hasSfx(name)) { warnUnknown(name); return; }
    const bridgeOpts: { volume: number; pan?: number } = { volume };
    if (opts?.pan !== undefined) bridgeOpts.pan = opts.pan;
    if (getSubroute() === 'fetched') {
      if (!fetchedHas(name)) { warnUnknown(name); return; }
      fetchedPlay(name, bridgeOpts);
      return;
    }
    const b = getAudioBridge();
    if (!b) return;
    b.play(name, bridgeOpts);
    return;
  }

  if (route === 'fallback') {
    if (!fallbackHas(name)) { warnUnknown(name); return; }
    const fbOpts: { volume: number; pan?: number } = { volume };
    if (opts?.pan !== undefined) fbOpts.pan = opts.pan;
    fallbackPlay(name, fbOpts);
    return;
  }
}

export function startLoop(name: string, opts?: PlaySfxOptions): SfxLoopHandle | null {
  const volume = getEffectiveVolume(opts?.feature, opts?.volumeMultiplier, opts?.volumeOverride);
  const route = getRoute();

  if (route === 'audiosprite') {
    if (!hasSfx(name)) { warnUnknown(name); return null; }
    const loopOpts: { volume: number; pan?: number } = { volume };
    if (opts?.pan !== undefined) loopOpts.pan = opts.pan;
    if (getSubroute() === 'fetched') {
      const fh = fetchedStartLoop(name, loopOpts);
      if (!fh) return null;
      fetchedLoops.add(fh);
      return wrapFetchedLoop(fh);
    }
    const b = getAudioBridge();
    if (!b) return null;
    const h = b.startLoop(name, loopOpts);
    if (!h) return null;
    bridgeLoops.add(h);
    return wrapBridgeLoop(h);
  }

  if (route === 'fallback') {
    if (!fallbackHas(name)) { warnUnknown(name); return null; }
    const fbOpts: { volume: number; pan?: number } = { volume };
    if (opts?.pan !== undefined) fbOpts.pan = opts.pan;
    const h = fallbackStartLoop(name, fbOpts);
    if (!h) return null;
    fallbackLoops.add(h);
    return wrapFallbackLoop(h);
  }

  return null;
}

export function stopAllLoops(): void {
  const b = getAudioBridge();
  if (b) { try { b.stopAll(); } catch { /* boundary */ } }
  bridgeLoops.clear();
  fetchedStopAll();
  fetchedLoops.clear();
  fallbackStopAll();
  fallbackLoops.clear();
}

export function getActiveLoopCount(): number {
  let count = 0;
  for (const h of bridgeLoops) if (h.isActive()) count++;
  for (const h of fallbackLoops) if (h.isActive()) count++;
  count += fetchedActiveCount();
  return count;
}

export function primeUnlock(): void {
  fetchedResumeContext();
  const route = getRoute();
  if (route === 'audiosprite' && getSubroute() !== 'fetched') {
    const b = getAudioBridge();
    if (b) { try { b.primeUnlock(); } catch { /* boundary */ } }
  }
}

let gestureAttached = false;

export function attachGesturePrimer(): void {
  if (gestureAttached) return;
  gestureAttached = true;
  const handler = (): void => {
    document.removeEventListener('pointerdown', handler, true);
    document.removeEventListener('keydown', handler, true);
    // Gesture is often what triggers the game's own SFX load; give the
    // catalog one immediate re-check so we don't wait for the next poll tick.
    retryCatalogNow();
    primeUnlock();
  };
  document.addEventListener('pointerdown', handler, { capture: true, once: true });
  document.addEventListener('keydown', handler, { capture: true, once: true });
}

function wrapBridgeLoop(h: BridgeLoopHandle): SfxLoopHandle {
  return {
    get isActive(): boolean { return h.isActive(); },
    setVolume: (v: number) => h.setVolume(v),
    setPan: (p: number) => h.setPan(p),
    stop: () => { try { h.stop(); } finally { bridgeLoops.delete(h); } },
  };
}

function wrapFallbackLoop(h: FallbackLoopHandle): SfxLoopHandle {
  return {
    get isActive(): boolean { return h.isActive(); },
    setVolume: (v: number) => h.setVolume(v),
    setPan: (p: number) => h.setPan(p),
    stop: () => { try { h.stop(); } finally { fallbackLoops.delete(h); } },
  };
}

function wrapFetchedLoop(h: FetchedLoopHandle): SfxLoopHandle {
  return {
    get isActive(): boolean { return h.isActive(); },
    setVolume: (v: number) => h.setVolume(v),
    setPan: (p: number) => h.setPan(p),
    stop: () => { try { h.stop(); } finally { fetchedLoops.delete(h); } },
  };
}

function warnUnknown(name: string): void {
  if (warnedUnknown.has(name)) return;
  warnedUnknown.add(name);
  audioLog.warn('QPM-AUDIO-001', { name });
}
