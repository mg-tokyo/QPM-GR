// src/features/tooltipInjection/atoms.ts
// Single shared atom subscription for tooltip injection.
// Merges the duplicate subscription logic from cropSizeIndicator + tileValueIndicator
// with retry support (from tileValueIndicator).

import { readAtomValue, subscribeAtomValue } from '../../../core/atomRegistry';
import { log } from '../../../utils/logger';
import { isRecord } from '../../../utils/typeGuards';
import type { ResolvedSlot } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETRY_DELAY_MS = 2500;
const MAX_RETRIES = 8;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cachedGardenObject: Record<string, unknown> | null = null;
let cachedSelectedSlotId = 0;
let retryCount = 0;
let retryTimer: number | null = null;

const cleanups: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSlot(raw: unknown): ResolvedSlot | null {
  if (!isRecord(raw)) return null;

  const species = raw.species;
  if (typeof species !== 'string' || !species) return null;

  const targetScale = raw.targetScale ?? raw.scale;
  if (typeof targetScale !== 'number') return null;

  const slotId = typeof raw.slotId === 'number' ? raw.slotId : 0;
  const endTime = typeof raw.endTime === 'number' ? raw.endTime : 0;

  const mutations = Array.isArray(raw.mutations)
    ? raw.mutations.filter((m): m is string => typeof m === 'string')
    : [];

  return { species, targetScale, mutations, slotId, endTime };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Resolve the currently selected slot from the cached garden object + selected slot ID. */
export function resolveCurrentSlot(): ResolvedSlot | null {
  if (!cachedGardenObject) return null;
  if (cachedGardenObject.objectType !== 'plant') return null;

  const slots = cachedGardenObject.slots;
  if (!Array.isArray(slots) || slots.length === 0) return null;

  // Find slot matching the selected slot ID (C/X key cycling)
  for (const raw of slots) {
    if (!isRecord(raw)) continue;
    if (raw.slotId === cachedSelectedSlotId) {
      return parseSlot(raw);
    }
  }

  // Fallback: first slot (no match means single-harvest or initial state)
  return parseSlot(slots[0]);
}

/**
 * Subscribe to garden object + selected slot ID atoms.
 * Calls `onChange` whenever slot data changes.
 * Returns an unsubscribe function.
 */
export async function subscribeTooltipAtoms(onChange: () => void): Promise<() => void> {
  const attemptSubscribe = async (): Promise<void> => {
    // Try gardenObject first, fall back to ownGardenObject
    let gardenUnsub = await subscribeAtomValue('gardenObject', (value) => {
      cachedGardenObject = isRecord(value) ? value : null;
      onChange();
    });
    if (!gardenUnsub) {
      gardenUnsub = await subscribeAtomValue('ownGardenObject', (value) => {
        cachedGardenObject = isRecord(value) ? value : null;
        onChange();
      });
    }

    if (!gardenUnsub) {
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          attemptSubscribe().catch(() => {});
        }, RETRY_DELAY_MS);
      } else {
        log('[TooltipAtoms] Garden object atom not found after retries');
      }
      return;
    }

    log('[TooltipAtoms] Found garden object atom');
    cleanups.push(gardenUnsub);

    // Read initial garden value
    try {
      let initial = await readAtomValue('gardenObject');
      if (initial == null) initial = await readAtomValue('ownGardenObject');
      cachedGardenObject = isRecord(initial) ? initial : null;
    } catch { /* ignore */ }

    // Subscribe to selected slot ID changes (C/X key)
    const slotIdUnsub = await subscribeAtomValue('selectedSlotId', (value) => {
      cachedSelectedSlotId = typeof value === 'number' ? value : 0;
      onChange();
    });
    if (slotIdUnsub) {
      cleanups.push(slotIdUnsub);
      try {
        const initial = await readAtomValue('selectedSlotId');
        cachedSelectedSlotId = typeof initial === 'number' ? initial : 0;
      } catch { /* ignore */ }
      log('[TooltipAtoms] Found mySelectedSlotIdAtom');
    }

    // Fire initial change
    onChange();
  };

  await attemptSubscribe();

  return () => {
    for (const cleanup of cleanups) {
      try { cleanup(); } catch { /* ignore */ }
    }
    cleanups.length = 0;
    cachedGardenObject = null;
    cachedSelectedSlotId = 0;
    retryCount = 0;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
}
