// Intercepts the game's native "Instant Feed" buttons (data-instant-feed-btn="1" / aria-label="Instant Feed: <Species>")
// to use QPM's inventory-aware food selection. Single document-level capture listener fires
// synchronously before React's delegated bubble-phase handler — no MutationObserver, no debounce, no WeakSet.

import { log } from '../../utils/logger';
import { getActivePetInfos } from '../../store/pets';
import { feedPetInstantly } from './instantFeed';

const SELECTOR_DATA = '[data-instant-feed-btn="1"]';
const SELECTOR_ARIA = '[aria-label^="Instant Feed:"]';

let captureListener: ((e: Event) => void) | null = null;

// petId resolution — triple fallback
function resolvePetSlotIndex(btn: HTMLElement): number {
  const pets = getActivePetInfos();
  if (pets.length === 0) return -1;

  const rawId = btn.dataset.petId ?? '';

  // Fallback 1: match btn.dataset.petId against ActivePetInfo.petId (entity UUID)
  if (rawId) {
    const byPetId = pets.find(p => p.petId === rawId);
    if (byPetId) return byPetId.slotIndex;
  }

  // Fallback 2: match against slotId (item UUID)
  if (rawId) {
    const bySlotId = pets.find(p => p.slotId === rawId);
    if (bySlotId) return bySlotId.slotIndex;
  }

  // Fallback 3: parse species from aria-label="Instant Feed: <Species>"
  const ariaLabel = btn.getAttribute('aria-label') ?? '';
  const match = ariaLabel.match(/^Instant Feed:\s*(.+)$/i);
  if (match) {
    const species = match[1]!.trim().toLowerCase();
    const bySpecies = pets.find(p => (p.species ?? '').toLowerCase() === species);
    if (bySpecies) return bySpecies.slotIndex;
  }

  // Fallback 4: only one pet active — feed it
  if (pets.length === 1) return pets[0]?.slotIndex ?? -1;

  return -1;
}

async function handleFeed(btn: HTMLElement): Promise<void> {
  const slotIndex = resolvePetSlotIndex(btn);

  if (slotIndex < 0) {
    log('⚠️ [NativeFeedIntercept] Could not resolve pet from button — skipping');
    return;
  }

  const pets = getActivePetInfos();
  const pet = pets.find((entry) => entry.slotIndex === slotIndex);
  log(`🎯 [NativeFeedIntercept] Intercepted — feeding slot ${slotIndex} (${pet?.species ?? '?'})`);

  const result = await feedPetInstantly(slotIndex);

  if (result.success) {
    log(`✅ [NativeFeedIntercept] Fed ${result.petName ?? result.petSpecies ?? 'pet'} with ${result.foodSpecies}`);
  } else {
    log(`⚠️ [NativeFeedIntercept] Feed failed: ${result.error}`);
  }
}

function onDocumentClick(e: Event): void {
  const target = e.target as Element | null;
  if (!target) return;

  const btn = target.closest(`${SELECTOR_DATA}, ${SELECTOR_ARIA}`) as HTMLElement | null;
  if (!btn) return;

  // Block native behavior immediately, before React's handler
  e.stopPropagation();
  e.stopImmediatePropagation();
  e.preventDefault();

  void handleFeed(btn);
}

export function startNativeFeedIntercept(): void {
  if (captureListener) return; // idempotent

  captureListener = onDocumentClick;
  document.addEventListener('click', captureListener, { capture: true });

  log('✅ [NativeFeedIntercept] Started (document capture mode)');
}

export function stopNativeFeedIntercept(): void {
  if (!captureListener) return;
  document.removeEventListener('click', captureListener, { capture: true });
  captureListener = null;
  log('🛑 [NativeFeedIntercept] Stopped');
}
