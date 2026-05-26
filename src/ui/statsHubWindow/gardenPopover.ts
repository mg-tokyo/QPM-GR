// src/ui/statsHubWindow/gardenPopover.ts
// Floating popover — used for tile slot detail on multi-harvest cards.

import { t } from '../../i18n';
import { getPlantSpecies } from '../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../utils/cropMultipliers';
import type { TileEntry } from './types';
import { plantSprite } from './spriteHelpers';
import { mutBadge, makeCoinValueEl, makeWhenCompleteHint } from './styleHelpers';
import {
  mutsMatch,
  filterCompatibleMutations,
  simulateMutationsAfterApplying,
} from './mutationCompat';

// ---------------------------------------------------------------------------
// Floating popover state
// ---------------------------------------------------------------------------

let _activePopover: HTMLElement | null = null;
let _popoverCleanup: (() => void) | null = null;

export function closePopover(): void {
  _activePopover?.remove();
  _activePopover = null;
  _popoverCleanup?.();
  _popoverCleanup = null;
}

export function getActivePopover(): HTMLElement | null {
  return _activePopover;
}

export function getPopoverCleanup(): (() => void) | null {
  return _popoverCleanup;
}

export function setPopoverCleanup(fn: (() => void) | null): void {
  _popoverCleanup = fn;
}

export function openPopover(anchor: HTMLElement, content: HTMLElement): void {
  closePopover();

  const pop = document.createElement('div');
  pop.style.cssText = [
    'position:fixed',
    'z-index:99999',
    'background:rgba(14,16,22,0.98)',
    'border:1px solid rgba(143,130,255,0.45)',
    'border-radius:10px',
    'padding:10px 12px',
    'min-width:180px',
    'max-width:260px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
    'backdrop-filter:blur(6px)',
  ].join(';');
  pop.appendChild(content);
  document.body.appendChild(pop);
  _activePopover = pop;

  // Position: prefer below-right of anchor, flip if near viewport edge
  const r = anchor.getBoundingClientRect();
  const gap = 8;
  const popW = 260;
  const spaceBelow = window.innerHeight - r.bottom;
  const spaceRight = window.innerWidth - r.right;

  pop.style.top  = spaceBelow >= 120 ? `${r.bottom + gap}px` : '';
  pop.style.bottom = spaceBelow < 120 ? `${window.innerHeight - r.top + gap}px` : '';
  pop.style.left  = spaceRight >= popW ? `${r.left}px` : '';
  pop.style.right = spaceRight < popW ? `${window.innerWidth - r.right}px` : '';

  const onOutside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      closePopover();
    }
  };
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closePopover();
  };

  // Slight delay so this click doesn't immediately close the popover
  const timer = setTimeout(() => {
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onEscape);
  }, 0);

  _popoverCleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onEscape);
  };
}

// ---------------------------------------------------------------------------
// Slot detail content (shown inside popovers)
// ---------------------------------------------------------------------------

export function buildSlotDetailContent(tile: TileEntry, selectedMutations: string[] = []): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  // When filtering, only show slots that are missing at least one compatible filter mutation
  const visibleSlots = selectedMutations.length === 0
    ? tile.slots
    : tile.slots.filter((slot) => {
        const missing = selectedMutations.filter((sel) => !slot.mutations.some((m) => mutsMatch(m, sel)));
        return filterCompatibleMutations(slot.mutations, missing).length > 0;
      });

  const title = document.createElement('div');
  title.style.cssText = 'font-size:12px;font-weight:700;color:rgba(224,224,224,0.55);margin-bottom:2px;';
  title.textContent = selectedMutations.length > 0
    ? t('feature.statsHub.garden.slotsEligible', { visible: String(visibleSlots.length), total: String(tile.slots.length) })
    : t('feature.statsHub.garden.slotCount', { count: String(tile.slots.length) });
  wrap.appendChild(title);

  if (visibleSlots.length === 0) {
    const none = document.createElement('div');
    none.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.3);padding:2px 0;';
    none.textContent = t('feature.statsHub.garden.allSlotsHaveMutations');
    wrap.appendChild(none);
    return wrap;
  }

  for (const slot of visibleSlots) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;';
    row.appendChild(plantSprite(slot.species, slot.mutations, 32, true));

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:12px;color:var(--qpm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    nameEl.textContent = slot.fruitCount > 1 ? `${slot.species} ×${slot.fruitCount}` : slot.species;
    info.appendChild(nameEl);

    if (slot.mutations.length > 0) {
      const mutRow = document.createElement('div');
      mutRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;margin-top:3px;';
      for (const m of slot.mutations) {
        const b = mutBadge(m);
        b.style.fontSize = '9px';
        b.style.padding = '1px 5px';
        mutRow.appendChild(b);
      }
      info.appendChild(mutRow);
    }

    // Current slot value (always shown)
    try {
      const plantSpec = getPlantSpecies(slot.species);
      const baseSell = typeof plantSpec?.crop?.baseSellPrice === 'number' ? plantSpec.crop.baseSellPrice : 0;
      if (baseSell > 0) {
        const slotVal = Math.round(baseSell * slot.targetScale * computeMutationMultiplier(slot.mutations).totalMultiplier);
        if (slotVal > 0) {
          const valEl = makeCoinValueEl(slotVal, '', 'font-size:10px;color:rgba(255,215,0,0.7);margin-top:3px;');
          info.appendChild(valEl);
        }

        // Per-slot gain hint — only when a mutation filter is active and slot is missing it
        if (selectedMutations.length > 0) {
          const missing = selectedMutations.filter(
            (sel) => !slot.mutations.some((m) => mutsMatch(m, sel)),
          );
          if (missing.length > 0) {
            const toAdd = filterCompatibleMutations(slot.mutations, missing);
            if (toAdd.length > 0) {
              const withMissing = simulateMutationsAfterApplying(slot.mutations, toAdd);
              const potentialVal = Math.round(baseSell * slot.targetScale * computeMutationMultiplier(withMissing).totalMultiplier);
              const slotGain = potentialVal - slotVal;
              if (slotGain > 0) {
                info.appendChild(makeWhenCompleteHint(slotGain, 'margin-top:2px;'));
              }
            }
          }
        }
      }
    } catch { /* ignore */ }

    row.appendChild(info);
    wrap.appendChild(row);
  }
  return wrap;
}
