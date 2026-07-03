// src/integrations/ariesDetection.ts
// Detects whether Aries Mod (github.com/Ariedam64/MG-AriesMod) is installed
// alongside QPM. Used by src/features/shop/enhancer to gate startup when
// Aries is already providing the same Buy-All + shop-reorder features
// (verified upstream at src/utils/shopUtility.ts:33 RESCAN_MS=20 + doc-root
// observers at 720 & 867 in shopUtility.ts@main).
//
// Detection signals (all realm-shared, so this works identically on
// magicgarden.gg and on <appId>.discordsays.com):
//   1. `.qws2`                      — Aries HUD root (verified hud.ts:174)
//   2. pageWindow.__tmMessageHookInstalled  — Aries WS-hook (ws-hook.ts:466)
//   3. pageWindow.__tmHarvestHookInstalled  — Aries WS-hook (ws-hook.ts:954)
//   4. [data-aries-value-row] / [data-aries-coin-value] — Aries tooltip rows
//      (already used by src/features/standalone/tooltipInjection/ariesCompat.ts:11,12)
//
// One positive signal → detected. Result cached for the session.

import { pageWindow } from '../core/pageContext';
import { onAdded } from '../utils/dom/dom';

type DetectionSource =
  | '.qws2'
  | '__tmMessageHookInstalled'
  | '__tmHarvestHookInstalled'
  | 'data-aries-*';

interface PageWithAriesHooks {
  __tmMessageHookInstalled?: unknown;
  __tmHarvestHookInstalled?: unknown;
}

let cachedDetected = false;
let cachedSource: DetectionSource | null = null;
let hasResolvedOnce = false;
let inflight: Promise<boolean> | null = null;

function checkSignals(): DetectionSource | null {
  try {
    if (typeof document !== 'undefined') {
      if (document.querySelector('.qws2')) return '.qws2';
      if (document.querySelector('[data-aries-value-row],[data-aries-coin-value]')) {
        return 'data-aries-*';
      }
    }
    const pw = pageWindow as unknown as PageWithAriesHooks;
    if (pw.__tmMessageHookInstalled) return '__tmMessageHookInstalled';
    if (pw.__tmHarvestHookInstalled) return '__tmHarvestHookInstalled';
  } catch {
    // Realm access can throw in exotic sandboxes — treat as negative.
  }
  return null;
}

function commit(source: DetectionSource | null): boolean {
  cachedDetected = source !== null;
  cachedSource = source;
  hasResolvedOnce = true;
  return cachedDetected;
}

/** Sync cached result. Runs a cheap check on first call if wait hasn't fired. */
export function isAriesInstalled(): boolean {
  if (!hasResolvedOnce) {
    const s = checkSignals();
    if (s !== null) commit(s);
  }
  return cachedDetected;
}

/**
 * Resolves true if Aries is detected within `timeoutMs`, otherwise false.
 * Idempotent: concurrent calls share one in-flight promise. Uses the shared
 * DOM observer via `onAdded` so the retry window costs no dedicated polling.
 */
export function waitForAriesDetection(timeoutMs = 3000): Promise<boolean> {
  if (hasResolvedOnce) return Promise.resolve(cachedDetected);
  if (inflight) return inflight;

  inflight = new Promise<boolean>((resolve) => {
    // Sync fast path.
    const immediate = checkSignals();
    if (immediate !== null) {
      commit(immediate);
      inflight = null;
      resolve(true);
      return;
    }

    let handle: { disconnect(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (source: DetectionSource | null): void => {
      if (handle) { handle.disconnect(); handle = null; }
      if (timer !== null) { clearTimeout(timer); timer = null; }
      const wasDetected = commit(source);
      inflight = null;
      resolve(wasDetected);
    };

    // Use the shared observer via onAdded — the predicate fires when any node
    // matching an Aries-injected marker appears anywhere in the document. The
    // predicate also matches when such a node is a descendant of an added
    // element (Aries's HUD tree lands as a single mount).
    handle = onAdded(
      (el) =>
        el instanceof Element &&
        (
          el.classList?.contains('qws2') === true ||
          el.matches?.('[data-aries-value-row],[data-aries-coin-value]') === true ||
          el.querySelector?.('.qws2,[data-aries-value-row],[data-aries-coin-value]') !== null
        ),
      () => {
        const s = checkSignals();
        if (s !== null) finish(s);
      },
      { callForExisting: false },
    );

    timer = setTimeout(() => finish(null), timeoutMs);
  });

  return inflight;
}

/** For the healthBus subsystem publish. */
export function getAriesDetectionInfo(): { detected: boolean; detectedVia: string | null } {
  return { detected: cachedDetected, detectedVia: cachedSource };
}
