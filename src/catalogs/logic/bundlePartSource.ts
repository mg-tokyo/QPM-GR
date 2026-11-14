// One value parsed from game bundle text, loaded on start and retried once per new chunk until it
// parses (the mutationRulesCatalog.ts pattern as a helper). No persistence: null until parsed.

import { fetchBundleHitContaining, getMarkerMissCount, markBundleConsumerDone, onNewBundleChunk, registerBundleConsumer } from './bundleParser';
import type { BundleMarker } from './bundleParser';
import { createNamedLogger } from '../../diagnostics/logger';

export interface BundlePartStatus {
  started: boolean;
  resolved: boolean;
  chunk: string | null;
  attempts: number;
  parseFailures: number;
  markerMisses: number;
  chunkRetryActive: boolean;
}

export interface BundlePartSource<T> {
  start(): void;
  stop(): void;
  get(): T | null;
  /** Fires once when the value resolves. */
  onChange(cb: () => void): () => void;
  status(): BundlePartStatus;
}

export function createBundlePartSource<T>(consumer: string, marker: BundleMarker, parse: (text: string) => T | null): BundlePartSource<T> {
  const log = createNamedLogger('catalogs');
  let value: T | null = null;
  let chunk: string | null = null;
  let attempts = 0;
  let parseFailures = 0;
  let started = false;
  let inFlight: Promise<void> | null = null;
  let rerun = false;
  let chunkRetry: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const releaseChunkRetry = (): void => {
    if (chunkRetry) { chunkRetry(); chunkRetry = null; }
  };

  const emitChange = (): void => {
    for (const cb of Array.from(listeners)) {
      try { cb(); } catch (error) { log.debug(`${consumer}: listener threw`, { error: String(error) }); }
    }
  };

  // A call during an in-flight load reruns once after it, so a chunk that landed mid-scan is still tried.
  const loadMissing = (): Promise<void> => {
    if (inFlight) { rerun = true; return inFlight; }
    inFlight = (async () => {
      if (value !== null) return;
      registerBundleConsumer(consumer);
      try {
        attempts += 1;
        const hit = await fetchBundleHitContaining(marker);
        if (!hit) return;
        const parsed = parse(hit.text);
        if (parsed === null) { parseFailures += 1; return; }
        value = parsed;
        chunk = hit.url.split('/').pop() ?? hit.url;
        releaseChunkRetry();
        emitChange();
      } catch (error) {
        log.debug(`${consumer}: load failed`, { error: String(error) });
      } finally {
        markBundleConsumerDone(consumer);
      }
    })().finally(() => {
      inFlight = null;
      const again = rerun && started && value === null;
      rerun = false;
      if (again) void loadMissing();
    });
    return inFlight;
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (value === null) chunkRetry = onNewBundleChunk(() => { void loadMissing(); });
      void loadMissing();
    },
    stop() {
      started = false;
      rerun = false;
      releaseChunkRetry();
    },
    get: () => value,
    onChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    status: () => ({
      started,
      resolved: value !== null,
      chunk,
      attempts,
      parseFailures,
      markerMisses: getMarkerMissCount(marker),
      chunkRetryActive: chunkRetry !== null,
    }),
  };
}
