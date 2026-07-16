// src/ui/statsHubWindow/gardenTileCard.ts
// Tile card + tile section builders for the garden tab.

import { t } from '../../../i18n';
import { getPlantSpecies } from '../../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../../utils/game/cropMultipliers';
import { createToggle } from '../../components';
import type { TileEntry } from './types';
import { plantSprite } from './spriteHelpers';
import { mutBadge, makeCoinValueEl, makeWhenCompleteHint } from './styleHelpers';
import { tileSpecies, tileMutations, tileFruitCount, tileValue } from './tileHelpers';
import {
  mutsMatch,
  filterCompatibleMutations,
  simulateMutationsAfterApplying,
  isTileActionable,
} from './mutationCompat';
import {
  openPopover,
  closePopover,
  getActivePopover,
  getPopoverCleanup,
  setPopoverCleanup,
  buildSlotDetailContent,
} from './gardenPopover';

// ---------------------------------------------------------------------------
// Tile card
// ---------------------------------------------------------------------------

export function buildTileCard(
  tile: TileEntry,
  selectedMutations: string[],
  isComplete: boolean,
  tileFilter: { active: boolean; onFilter: () => void } = { active: false, onFilter: () => {} },
): HTMLElement {
  const species = tileSpecies(tile);
  const mutations = tileMutations(tile);
  const fruitCount = tileFruitCount(tile);
  const isMulti = tile.slots.length > 1 || fruitCount > 1;

  const outer = document.createElement('div');
  outer.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'border-radius:10px',
    'border:1px solid rgba(143,130,255,0.14)',
    'background:rgba(255,255,255,0.03)',
    'overflow:hidden',
    'width:100%',
    'cursor:pointer',
    'transition:border-color 0.12s,background 0.12s,box-shadow 0.12s',
  ].join(';');

  if (tileFilter.active) {
    outer.style.borderColor = 'rgba(143,130,255,0.6)';
    outer.style.background = 'rgba(143,130,255,0.1)';
    outer.style.boxShadow = '0 0 0 2px rgba(143,130,255,0.35)';
  }

  outer.addEventListener('mouseenter', () => {
    if (!tileFilter.active) {
      outer.style.borderColor = 'rgba(143,130,255,0.35)';
      outer.style.background = 'rgba(143,130,255,0.07)';
    }
  });
  outer.addEventListener('mouseleave', () => {
    if (!tileFilter.active) {
      outer.style.borderColor = 'rgba(143,130,255,0.14)';
      outer.style.background = 'rgba(255,255,255,0.03)';
    }
  });
  // Single-harvest cards: full card click = highlight toggle in stats window (no in-game garden filter)
  if (!isMulti) {
    outer.addEventListener('click', (e) => {
      e.stopPropagation();
      tileFilter.onFilter();
    });
  }

  // Store earliest ready time for live badge updates
  const earliestReady = tile.slots.reduce<number>(
    (min, s) => s.endTime !== null && s.endTime < min ? s.endTime : min,
    Infinity,
  );
  if (Number.isFinite(earliestReady)) {
    outer.dataset.readyAt = String(earliestReady);
  }

  // Card content
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 8px;text-align:center;';

  // Ready badge — set initial state immediately so it doesn't flash on render
  const readyBadge = document.createElement('div');
  readyBadge.dataset.readyBadge = '1';
  const isAlreadyReady = Number.isFinite(earliestReady) && earliestReady <= Date.now();
  readyBadge.style.cssText = [
    isAlreadyReady ? 'display:flex' : 'display:none',
    'align-items:center',
    'gap:4px',
    'padding:2px 8px',
    'border-radius:20px',
    'font-size:10px',
    'font-weight:700',
    'background:rgba(74,222,128,0.18)',
    'border:1px solid rgba(74,222,128,0.45)',
    'color:#4ade80',
    'white-space:nowrap',
  ].join(';');
  readyBadge.textContent = `✓ ${t('feature.statsHub.garden.ready')}`;
  header.appendChild(readyBadge);

  // Sprite: use plant-first (bush/tree) for the tile card.
  header.appendChild(plantSprite(species, mutations, 56, false));

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--qpm-text);word-break:break-word;';
  nameEl.textContent = species;
  header.appendChild(nameEl);

  if (isMulti) {
    const countEl = document.createElement('div');
    countEl.style.cssText = 'font-size:10px;font-weight:600;color:rgba(143,130,255,0.75);';
    countEl.textContent = t('feature.statsHub.garden.slotsTap', { count: String(fruitCount) });
    header.appendChild(countEl);
  }

  // Tile value
  const val = tileValue(tile);
  if (val > 0) {
    const valEl = makeCoinValueEl(val, '', 'font-size:10px;color:rgba(255,215,0,0.65);');
    header.appendChild(valEl);
  }

  if (mutations.length > 0) {
    const mutRow = document.createElement('div');
    mutRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;justify-content:center;';
    for (const m of mutations) mutRow.appendChild(mutBadge(m));
    header.appendChild(mutRow);
  }

  if (!isComplete && selectedMutations.length > 0) {
    const missing = selectedMutations.filter(
      (sel) => !mutations.some((m) => mutsMatch(m, sel)),
    );
    if (missing.length > 0) {
      const misRow = document.createElement('div');
      misRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;justify-content:center;';
      for (const m of missing) misRow.appendChild(mutBadge(m, true));
      header.appendChild(misRow);

      try {
        const plantSpec = getPlantSpecies(species);
        const baseSell = typeof plantSpec?.crop?.baseSellPrice === 'number' ? plantSpec.crop.baseSellPrice : 0;
        if (baseSell > 0) {
          let gain = 0;
          for (const slotData of tile.slots) {
            const currentMult = computeMutationMultiplier(slotData.mutations).totalMultiplier;
            const slotMissing = missing.filter(
              (sel) => !slotData.mutations.some((m) => mutsMatch(m, sel)),
            );
            const toAdd = filterCompatibleMutations(slotData.mutations, slotMissing);
            if (toAdd.length === 0) continue;
            const withAll = simulateMutationsAfterApplying(slotData.mutations, toAdd);
            const potentialMult = computeMutationMultiplier(withAll).totalMultiplier;
            gain += Math.round(baseSell * slotData.targetScale * potentialMult) - Math.round(baseSell * slotData.targetScale * currentMult);
          }
          if (gain > 0) {
            header.appendChild(makeWhenCompleteHint(gain));
          }
        }
      } catch { /* mutation gain hint is best-effort — skip hint when sim math fails */ }
    }
  }

  // Multi-harvest: small garden filter button in header corner
  if (isMulti) {
    header.style.position = 'relative';
    const filterBtn = document.createElement('button');
    filterBtn.type = 'button';
    filterBtn.title = tileFilter.active ? t('feature.statsHub.garden.clearFilter') : t('feature.statsHub.garden.filterSpecies');
    filterBtn.textContent = '◎';
    filterBtn.style.cssText = [
      'position:absolute', 'top:4px', 'right:4px',
      'background:none', 'border:none', 'cursor:pointer',
      'font-size:12px', 'padding:2px', 'line-height:1',
      tileFilter.active ? 'opacity:1;color:var(--qpm-accent)' : 'opacity:0.3;color:inherit',
    ].join(';');
    filterBtn.addEventListener('mouseenter', () => { filterBtn.style.opacity = '0.8'; });
    filterBtn.addEventListener('mouseleave', () => { filterBtn.style.opacity = tileFilter.active ? '1' : '0.3'; });
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tileFilter.onFilter();
    });
    header.appendChild(filterBtn);
  }

  outer.appendChild(header);

  // Multi-harvest: open floating popover on click
  if (isMulti) {
    outer.addEventListener('click', (e) => {
      e.stopPropagation();
      if (getActivePopover() && outer.dataset.popoverOpen === '1') {
        closePopover();
        outer.dataset.popoverOpen = '0';
        return;
      }
      outer.dataset.popoverOpen = '1';
      const prev = getPopoverCleanup();
      openPopover(outer, buildSlotDetailContent(tile, selectedMutations));
      const origCleanup = getPopoverCleanup();
      setPopoverCleanup(() => {
        outer.dataset.popoverOpen = '0';
        origCleanup?.();
        prev?.();
      });
    });
  }

  return outer;
}

// ---------------------------------------------------------------------------
// Tile section
// ---------------------------------------------------------------------------

export function buildTileSection(
  title: string,
  tiles: TileEntry[],
  selectedMutations: string[],
  isComplete: boolean,
  sectionFilterProps: {
    active: boolean;
    onToggle: (active: boolean) => void;
  } | null = null,
  tileFilterProps: {
    activeTileFilterKey: string | null;
    onFilter: (tile: TileEntry) => void;
  } | null = null,
  extraSectionFilterProps: {
    label: string;
    active: boolean;
    onToggle: (active: boolean) => void;
    subToggle?: {
      label: string;
      active: boolean;
      onToggle: (active: boolean) => void;
    } | null;
  } | null = null,
): HTMLElement {
  const section = document.createElement('div');

  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';

  const hdrText = document.createElement('div');
  hdrText.style.cssText = 'font-size:14px;font-weight:700;color:rgba(224,224,224,0.85);';
  hdrText.textContent = title;
  hdr.appendChild(hdrText);

  if (sectionFilterProps || extraSectionFilterProps) {
    const togglesGroup = document.createElement('div');
    togglesGroup.style.cssText = 'display:flex;align-items:center;gap:12px;';
    if (extraSectionFilterProps) {
      if (extraSectionFilterProps.subToggle) {
        const subTog = createToggle({
          checked: extraSectionFilterProps.subToggle.active,
          onChange: extraSectionFilterProps.subToggle.onToggle,
          label: extraSectionFilterProps.subToggle.label,
          size: 'compact',
        });
        togglesGroup.appendChild(subTog.root);
      }
      const extraToggle = createToggle({
        checked: extraSectionFilterProps.active,
        onChange: extraSectionFilterProps.onToggle,
        label: extraSectionFilterProps.label,
        size: 'compact',
      });
      togglesGroup.appendChild(extraToggle.root);
    }
    if (sectionFilterProps) {
      const toggle = createToggle({
        checked: sectionFilterProps.active,
        onChange: (checked) => sectionFilterProps.onToggle(checked),
        size: 'compact',
      });
      togglesGroup.appendChild(toggle.root);
    }
    hdr.appendChild(togglesGroup);
  }
  section.appendChild(hdr);

  if (tiles.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.3);padding:4px 0;';
    empty.textContent = isComplete ? t('feature.statsHub.garden.noTilesMatch') : t('feature.statsHub.garden.allComplete');
    section.appendChild(empty);
    return section;
  }

  // Sort: species alphabetically, then by tile value descending within each species
  const sorted = [...tiles].sort((a, b) => {
    const spA = tileSpecies(a);
    const spB = tileSpecies(b);
    if (spA !== spB) return spA.localeCompare(spB);
    return tileValue(b) - tileValue(a);
  });

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;';
  for (const tile of sorted) {
    const isFilterActive = tileFilterProps?.activeTileFilterKey === tile.tileKey;
    grid.appendChild(buildTileCard(tile, selectedMutations, isComplete, {
      active: isFilterActive,
      onFilter: () => tileFilterProps?.onFilter(tile),
    }));
  }
  section.appendChild(grid);
  return section;
}
