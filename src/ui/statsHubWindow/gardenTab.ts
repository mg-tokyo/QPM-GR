// src/ui/statsHubWindow/gardenTab.ts
// Garden tab — mutation progress, tile cards, popover detail, filter persistence.

import { storage } from '../../utils/storage';
import { t } from '../../i18n';
import { onGardenSnapshot, getGardenSnapshot, type GardenSnapshot } from '../../features/gardenBridge';
import { getPlantSpecies, getMutationCatalog } from '../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../utils/cropMultipliers';
import { visibleInterval } from '../../utils/timerManager';
import { setStatsHubSpeciesOverride, setStatsHubExcludeMutationsOverride, setStatsHubTileOverride, setStatsHubExcludeMutationsAllMode } from '../../features/gardenFilters';
import type { TileEntry, StatsHubFilters, SectionFilterSource } from './types';
import { STATS_HUB_FILTERS_KEY, FILTER_MUTATIONS_FALLBACK } from './constants';
import { plantSprite } from './spriteHelpers';
import { pillBtnCss, mutBadge, buildToggleSwitch, makeCoinValueEl, makeWhenCompleteHint } from './styleHelpers';
import { extractTiles, tileSpecies, tileMutations, tileFruitCount, tileValue, tilesToKeys } from './tileHelpers';
import {
  mutsMatch,
  filterCompatibleMutations,
  simulateMutationsAfterApplying,
  isTileActionable,
  countActionableFruits,
  countMaxSizeRemainingFruits,
} from './mutationCompat';

// ---------------------------------------------------------------------------
// Filter persistence
// ---------------------------------------------------------------------------

function loadStatsHubFilters(): StatsHubFilters {
  return storage.get<StatsHubFilters>(STATS_HUB_FILTERS_KEY, {}) ?? {};
}

function saveStatsHubFilters(patch: Partial<StatsHubFilters>): void {
  const current = loadStatsHubFilters();
  storage.set(STATS_HUB_FILTERS_KEY, { ...current, ...patch });
}

/**
 * Returns the list of mutation display names for the filter pills.
 * Prefers the runtime mutation catalog so new game mutations appear automatically.
 * Falls back to the hardcoded list when the catalog isn't ready.
 */
function getFilterMutations(): string[] {
  const catalog = getMutationCatalog();
  if (!catalog) return [...FILTER_MUTATIONS_FALLBACK];

  const names: string[] = [];
  for (const [id, entry] of Object.entries(catalog)) {
    const displayName = typeof entry.name === 'string' && entry.name ? entry.name : id;
    names.push(displayName);
  }
  return names.length > 0 ? names : [...FILTER_MUTATIONS_FALLBACK];
}

// ---------------------------------------------------------------------------
// Floating popover — used for tile slot detail on multi-harvest cards
// ---------------------------------------------------------------------------

let _activePopover: HTMLElement | null = null;
let _popoverCleanup: (() => void) | null = null;

function closePopover(): void {
  _activePopover?.remove();
  _activePopover = null;
  _popoverCleanup?.();
  _popoverCleanup = null;
}

function openPopover(anchor: HTMLElement, content: HTMLElement): void {
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
  const t = setTimeout(() => {
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onEscape);
  }, 0);

  _popoverCleanup = () => {
    clearTimeout(t);
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onEscape);
  };
}

// ---------------------------------------------------------------------------
// Garden value computation
// ---------------------------------------------------------------------------

function computeGardenValue(
  tiles: TileEntry[],
  selectedMutations: string[],
  maxSizeOnly = false,
): { current: number; potential: number } {
  let current = 0;
  let potential = 0;
  for (const tile of tiles) {
    const plantSpec = getPlantSpecies(tileSpecies(tile));
    const base = typeof plantSpec?.crop?.baseSellPrice === 'number'
      ? plantSpec.crop.baseSellPrice : 0;
    if (base <= 0) continue;

    // Tiles where no mutations can be applied contribute no gain.
    const tileIsComplete = selectedMutations.length > 0 ? !isTileActionable(tile, selectedMutations) : true;

    for (const slot of tile.slots) {
      const mutMult = computeMutationMultiplier(slot.mutations).totalMultiplier;
      const slotCurrent = Math.round(base * slot.targetScale * mutMult);
      current += slotCurrent;

      // Scale potential: use maxScale if filter active and slot hasn't reached it yet
      const potentialScale = (maxSizeOnly && slot.sizePercent < 100) ? slot.maxScale : slot.targetScale;

      // Mutation potential: add all compatible selected mutations the slot is still missing
      let potentialMutMult = mutMult;
      if (selectedMutations.length > 0 && !tileIsComplete) {
        const slotMissing = selectedMutations.filter(
          (sel) => !slot.mutations.some((m) => mutsMatch(m, sel)),
        );
        const toAdd = filterCompatibleMutations(slot.mutations, slotMissing);
        const withSelected = simulateMutationsAfterApplying(slot.mutations, toAdd);
        potentialMutMult = computeMutationMultiplier(withSelected).totalMultiplier;
      }

      // Combined: full potential is max scale × best reachable mutation set
      potential += Math.round(base * potentialScale * potentialMutMult);
    }
  }
  return { current, potential };
}

// ---------------------------------------------------------------------------
// Tile card
// ---------------------------------------------------------------------------

function buildSlotDetailContent(tile: TileEntry, selectedMutations: string[] = []): HTMLElement {
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
  title.style.cssText = 'font-size:11px;font-weight:700;color:rgba(224,224,224,0.55);margin-bottom:2px;';
  title.textContent = selectedMutations.length > 0
    ? t('feature.statsHub.garden.slotsEligible', { visible: String(visibleSlots.length), total: String(tile.slots.length) })
    : t('feature.statsHub.garden.slotCount', { count: String(tile.slots.length) });
  wrap.appendChild(title);

  if (visibleSlots.length === 0) {
    const none = document.createElement('div');
    none.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.3);padding:2px 0;';
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
    nameEl.style.cssText = 'font-size:11px;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
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

function buildTileCard(
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
    'width:100%',   // fills the CSS grid cell — grid sets column width
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
  // Individual slot popovers use crop-first (fruit) — see buildSlotDetailContent.
  header.appendChild(plantSprite(species, mutations, 56, false));

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:11px;font-weight:600;color:#e0e0e0;word-break:break-word;';
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
          // Sum the proper multiplier differential across every slot (accounts for existing mutations + multi-slot)
          let gain = 0;
          for (const slotData of tile.slots) {
            const currentMult = computeMutationMultiplier(slotData.mutations).totalMultiplier;
            const slotMissing = missing.filter(
              (sel) => !slotData.mutations.some((m) => mutsMatch(m, sel)),
            );
            const toAdd = filterCompatibleMutations(slotData.mutations, slotMissing);
            if (toAdd.length === 0) continue;
            // Use game's upgrade mechanics for accurate value (e.g. Dawnlit→Dawnbound removes Dawnlit)
            const withAll = simulateMutationsAfterApplying(slotData.mutations, toAdd);
            const potentialMult = computeMutationMultiplier(withAll).totalMultiplier;
            gain += Math.round(baseSell * slotData.targetScale * potentialMult) - Math.round(baseSell * slotData.targetScale * currentMult);
          }
          if (gain > 0) {
            header.appendChild(makeWhenCompleteHint(gain));
          }
        }
      } catch { /* ignore */ }
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
      'font-size:11px', 'padding:2px', 'line-height:1',
      tileFilter.active ? 'opacity:1;color:#8f82ff' : 'opacity:0.3;color:inherit',
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
      // If this card's popover is already open, close it
      if (_activePopover && outer.dataset.popoverOpen === '1') {
        closePopover();
        outer.dataset.popoverOpen = '0';
        return;
      }
      outer.dataset.popoverOpen = '1';
      const prev = _popoverCleanup;
      openPopover(outer, buildSlotDetailContent(tile, selectedMutations));
      // Track when our popover closes
      const origCleanup = _popoverCleanup;
      _popoverCleanup = () => {
        outer.dataset.popoverOpen = '0';
        origCleanup?.();
        prev?.();
      };
    });
  }

  return outer;
}

// ---------------------------------------------------------------------------
// Tile section
// ---------------------------------------------------------------------------

function buildTileSection(
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
  hdrText.style.cssText = 'font-size:13px;font-weight:700;color:rgba(224,224,224,0.85);';
  hdrText.textContent = title;
  hdr.appendChild(hdrText);

  if (sectionFilterProps || extraSectionFilterProps) {
    const togglesGroup = document.createElement('div');
    togglesGroup.style.cssText = 'display:flex;align-items:center;gap:12px;';
    if (extraSectionFilterProps) {
      if (extraSectionFilterProps.subToggle) {
        const subTog = buildToggleSwitch(
          extraSectionFilterProps.subToggle.active,
          extraSectionFilterProps.subToggle.onToggle,
          extraSectionFilterProps.subToggle.label,
        );
        togglesGroup.appendChild(subTog);
      }
      const extraToggle = buildToggleSwitch(
        extraSectionFilterProps.active,
        extraSectionFilterProps.onToggle,
        extraSectionFilterProps.label,
      );
      togglesGroup.appendChild(extraToggle);
    }
    if (sectionFilterProps) {
      const toggle = buildToggleSwitch(sectionFilterProps.active, (active) => {
        sectionFilterProps.onToggle(active);
      });
      togglesGroup.appendChild(toggle);
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

// ---------------------------------------------------------------------------
// Main garden tab builder
// ---------------------------------------------------------------------------

export function buildGardenTab(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

  // Restore persisted filter state
  const savedFilters = loadStatsHubFilters();

  // Stats-window-only species filter (does NOT affect in-game garden filter)
  const activeSpeciesFilters = new Set<string>(savedFilters.speciesFilters ?? []);

  // Section filter state: which section is driving the in-game garden filter
  let activeSectionFilterSource: SectionFilterSource = null;

  // Active per-tile garden filter key (TileEntry.tileKey, null = no filter)
  let activeTileFilterKey: string | null = null;

  // Clear any stale override from a previous session — never touches the main Garden Filters config
  setStatsHubSpeciesOverride(null);
  setStatsHubExcludeMutationsOverride(null);
  setStatsHubTileOverride(null);

  let filterRemainingActive = false;
  let filterRemainingAllMode = false;

  function applyFilterRemaining(on: boolean): void {
    filterRemainingActive = on;
    if (on) {
      // Deactivate species-based section filter when switching to exclude mode
      activeSectionFilterSource = null;
      activeTileFilterKey = null;
      setStatsHubTileOverride(null);
      setStatsHubSpeciesOverride(null);
      setStatsHubExcludeMutationsOverride(Array.from(activeFilters));
    } else {
      filterRemainingAllMode = false;
      setStatsHubExcludeMutationsAllMode(false);
      setStatsHubExcludeMutationsOverride(null);
    }
  }

  // Pre-built array of ready-badge entries — populated at the end of renderContent() so the
  // 1s interval tick doesn't need to do a querySelectorAll DOM scan every second.
  let readyBadgeEntries: Array<{ endTime: number; badge: HTMLElement }> = [];

  function disableGardenFilter(): void {
    setStatsHubTileOverride(null);
    setStatsHubSpeciesOverride(null);
  }

  function setTileFilter(tile: TileEntry): void {
    filterRemainingActive = false;
    setStatsHubExcludeMutationsOverride(null);
    activeSectionFilterSource = null;
    activeTileFilterKey = tile.tileKey;
    setStatsHubSpeciesOverride(null);
    setStatsHubTileOverride([tile.tileKey]);
  }

  function clearTileFilter(): void {
    activeTileFilterKey = null;
    if (activeSectionFilterSource === null) disableGardenFilter();
  }

  function applySectionFilter(source: SectionFilterSource, tilesInSection: TileEntry[]): void {
    if (source !== null && filterRemainingActive) {
      filterRemainingActive = false;
      filterRemainingAllMode = false;
      setStatsHubExcludeMutationsOverride(null);
    }
    activeSectionFilterSource = source;
    activeTileFilterKey = null;
    setStatsHubSpeciesOverride(null);
    setStatsHubTileOverride(source !== null ? tilesToKeys(tilesInSection) : null);
  }

  // ---- Plants dropdown ----
  const plantFilterBtn = document.createElement('button');
  plantFilterBtn.type = 'button';
  plantFilterBtn.style.cssText = pillBtnCss(false);
  plantFilterBtn.textContent = `${t('feature.statsHub.garden.allPlants')} ▾`;

  let plantDropdownEl: HTMLElement | null = null;

  function closePlantDropdown(): void {
    plantDropdownEl?.remove();
    plantDropdownEl = null;
  }

  function updatePlantFilterBtn(): void {
    plantFilterBtn.textContent = activeSpeciesFilters.size > 0
      ? `${t('feature.statsHub.garden.plantsCount', { count: String(activeSpeciesFilters.size) })} ▾`
      : `${t('feature.statsHub.garden.allPlants')} ▾`;
    plantFilterBtn.style.cssText = pillBtnCss(activeSpeciesFilters.size > 0);
  }

  function buildSpeciesCheckRow(
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    species?: string,
  ): HTMLElement {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12px;color:#e0e0e0;';
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(143,130,255,0.1)'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.style.cssText = 'accent-color:#8f82ff;cursor:pointer;flex-shrink:0;';
    cb.addEventListener('change', () => onChange(cb.checked));
    row.appendChild(cb);

    if (species) {
      const spriteWrap = plantSprite(species, [], 20, false);
      spriteWrap.style.flexShrink = '0';
      row.appendChild(spriteWrap);
    }

    const txt = document.createElement('span');
    txt.textContent = label;
    row.appendChild(txt);
    return row;
  }

  plantFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (plantDropdownEl) { closePlantDropdown(); return; }

    // Build species list from the current tiles (not a hardcoded catalog)
    const currentTiles = extractTiles(currentSnapshot);
    const speciesInGarden = Array.from(new Set(currentTiles.map(tileSpecies))).sort();

    const dropdown = document.createElement('div');
    dropdown.style.cssText = [
      'position:fixed', 'z-index:99998',
      'background:rgba(14,16,22,0.98)',
      'border:1px solid rgba(143,130,255,0.35)',
      'border-radius:10px', 'padding:8px',
      'min-width:180px', 'max-width:240px',
      'max-height:300px', 'overflow-y:auto',
      'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
      'display:flex', 'flex-direction:column', 'gap:2px',
    ].join(';');

    const allRow = buildSpeciesCheckRow(t('feature.statsHub.garden.allPlants'), activeSpeciesFilters.size === 0, (checked) => {
      if (checked) { activeSpeciesFilters.clear(); renderContent(); updatePlantFilterBtn(); }
    });
    dropdown.appendChild(allRow);

    if (speciesInGarden.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText = 'border-top:1px solid rgba(255,255,255,0.08);margin:4px 0;';
      dropdown.appendChild(divider);

      for (const sp of speciesInGarden) {
        const row = buildSpeciesCheckRow(sp, activeSpeciesFilters.has(sp), (checked) => {
          if (checked) activeSpeciesFilters.add(sp);
          else activeSpeciesFilters.delete(sp);
          renderContent();
          updatePlantFilterBtn();
        }, sp);
        dropdown.appendChild(row);
      }
    }

    document.body.appendChild(dropdown);
    plantDropdownEl = dropdown;

    const r = plantFilterBtn.getBoundingClientRect();
    dropdown.style.top = `${r.bottom + 4}px`;
    dropdown.style.left = `${r.left}px`;

    const onOutside = (ev: MouseEvent) => {
      if (!dropdown.contains(ev.target as Node) && ev.target !== plantFilterBtn) {
        closePlantDropdown();
        document.removeEventListener('click', onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', onOutside, true), 0);
  });

  // ---- Top bar: Plants dropdown ----
  const topBar = document.createElement('div');
  topBar.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:8px 14px 6px',
    'flex-shrink:0',
  ].join(';');
  topBar.appendChild(plantFilterBtn);
  container.appendChild(topBar);

  // ---- Mutation filter bar ----
  const filterBar = document.createElement('div');
  filterBar.style.cssText = [
    'display:flex',
    'flex-wrap:wrap',
    'gap:5px',
    'padding:0 14px 8px',
    'border-bottom:1px solid rgba(143,130,255,0.12)',
    'flex-shrink:0',
    'align-items:center',
  ].join(';');

  const filterLabel = document.createElement('span');
  filterLabel.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.38);white-space:nowrap;';
  filterLabel.textContent = t('feature.statsHub.garden.mutations');
  filterBar.appendChild(filterLabel);

  const activeFilters = new Set<string>(savedFilters.mutationFilters ?? []);
  const pillButtons = new Map<string, HTMLButtonElement>();

  const updatePills = () => {
    for (const [id, btn] of pillButtons) {
      btn.style.cssText = pillBtnCss(activeFilters.has(id));
    }
    maxSizePillBtn.style.cssText = pillBtnCss(maxSizeOnly);
  };

  for (const mutId of getFilterMutations()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = pillBtnCss(activeFilters.has(mutId));
    btn.textContent = mutId;
    btn.addEventListener('click', () => {
      if (activeFilters.has(mutId)) activeFilters.delete(mutId);
      else activeFilters.add(mutId);
      updatePills();
      renderContent();
    });
    pillButtons.set(mutId, btn);
    filterBar.appendChild(btn);
  }

  // Separator between mutation pills and special filters
  const filterSep = document.createElement('span');
  filterSep.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.12);align-self:center;margin:0 2px;flex-shrink:0;';
  filterBar.appendChild(filterSep);

  let maxSizeOnly = savedFilters.maxSizeOnly ?? false;
  const maxSizePillBtn = document.createElement('button');
  maxSizePillBtn.type = 'button';
  maxSizePillBtn.style.cssText = pillBtnCss(maxSizeOnly);
  maxSizePillBtn.textContent = t('feature.statsHub.garden.maxSize');
  maxSizePillBtn.title = t('feature.statsHub.garden.maxSizeTooltip');
  maxSizePillBtn.addEventListener('click', () => {
    maxSizeOnly = !maxSizeOnly;
    updatePills();
    renderContent();
  });
  filterBar.appendChild(maxSizePillBtn);

  container.appendChild(filterBar);

  // Value summary bar
  const valueSummaryBar = document.createElement('div');
  valueSummaryBar.style.cssText = [
    'display:none',
    'padding:6px 14px',
    'border-bottom:1px solid rgba(143,130,255,0.08)',
    'flex-shrink:0',
    'background:rgba(255,255,255,0.02)',
    'gap:10px',
    'align-items:center',
  ].join(';');
  container.appendChild(valueSummaryBar);

  // Scrollable content
  const content = document.createElement('div');
  content.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:16px;';
  container.appendChild(content);

  // Seeded immediately from the bridge cache; kept in sync by the subscription below.
  let currentSnapshot: GardenSnapshot = getGardenSnapshot();

  function updateValueSummary(tiles: TileEntry[], selected: string[], maxSize = false): void {
    const { current, potential } = computeGardenValue(tiles, selected, maxSize);
    if (current === 0) {
      valueSummaryBar.style.display = 'none';
      return;
    }
    valueSummaryBar.style.display = 'flex';
    valueSummaryBar.innerHTML = '';

    valueSummaryBar.appendChild(
      makeCoinValueEl(current, t('feature.statsHub.garden.current'), 'font-size:13px;font-weight:700;color:#FFD700;')
    );

    if ((selected.length > 0 || maxSize) && potential > current) {
      const gain = potential - current;
      const arrowSep = document.createElement('span');
      arrowSep.style.cssText = 'color:rgba(255,255,255,0.18);font-size:12px;';
      arrowSep.textContent = '→';
      valueSummaryBar.appendChild(arrowSep);
      valueSummaryBar.appendChild(
        makeCoinValueEl(gain, '+', 'font-size:13px;font-weight:700;color:rgba(100,230,150,0.9);')
      );
      const gainLbl = document.createElement('span');
      gainLbl.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.38);';
      gainLbl.textContent = t('feature.statsHub.garden.ifCompleted');
      valueSummaryBar.appendChild(gainLbl);
    }
  }

  function renderContent(): void {
    // Persist filter state on every re-render (triggered by any filter change)
    saveStatsHubFilters({
      speciesFilters: activeSpeciesFilters.size > 0 ? Array.from(activeSpeciesFilters) : [],
      mutationFilters: activeFilters.size > 0 ? Array.from(activeFilters) : [],
      maxSizeOnly,
    });
    content.innerHTML = '';
    readyBadgeEntries = []; // Clear stale refs whenever cards are rebuilt
    const allTiles = extractTiles(currentSnapshot);
    const selected = Array.from(activeFilters);

    // Keep exclude override in sync if filter remaining is active
    if (filterRemainingActive) {
      if (selected.length > 0) {
        setStatsHubExcludeMutationsOverride(selected);
      } else {
        filterRemainingActive = false;
        setStatsHubExcludeMutationsOverride(null);
      }
    }

    // Apply stats-window species filter
    const tiles = activeSpeciesFilters.size > 0
      ? allTiles.filter((t) => activeSpeciesFilters.has(tileSpecies(t)))
      : allTiles;

    if (tiles.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:rgba(224,224,224,0.3);font-size:13px;padding:32px 0;text-align:center;';
      empty.textContent = allTiles.length === 0 ? t('feature.statsHub.garden.noPlants') : t('feature.statsHub.garden.noMatch');
      content.appendChild(empty);
      updateValueSummary([], selected);
      return;
    }

    if (selected.length === 0 && !maxSizeOnly) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:rgba(224,224,224,0.32);font-size:12px;padding:8px 0 4px;';
      hint.textContent = t('feature.statsHub.garden.selectMutationsHint');
      content.appendChild(hint);
    }

    const gardenHint = document.createElement('div');
    gardenHint.style.cssText = 'color:rgba(224,224,224,0.25);font-size:11px;padding:0 0 4px;';
    gardenHint.textContent = t('feature.statsHub.garden.clickPlantHint');
    content.appendChild(gardenHint);

    const remaining: TileEntry[] = [];
    const complete: TileEntry[] = [];
    const isAnyFilterActive = selected.length > 0 || maxSizeOnly;

    for (const tile of tiles) {
      if (!isAnyFilterActive) {
        complete.push(tile);
      } else {
        // A tile is "remaining" if it can receive a selected mutation OR hasn't reached max size.
        // Mutation-blocked tiles (e.g. Amberbound + Amberlit filter) are not actionable → complete.
        const needsMutation = selected.length > 0 && isTileActionable(tile, selected);
        const needsSize = maxSizeOnly && tile.slots.some((s) => s.sizePercent < 100);
        (needsMutation || needsSize ? remaining : complete).push(tile);
      }
    }

    const tileFilterProps = {
      activeTileFilterKey,
      onFilter: (tile: TileEntry) => {
        if (activeTileFilterKey === tile.tileKey) {
          clearTileFilter();
        } else {
          setTileFilter(tile);
        }
        renderContent();
      },
    };

    if (isAnyFilterActive) {
      const remainingFruits = (maxSizeOnly && selected.length === 0)
        ? countMaxSizeRemainingFruits(remaining)
        : countActionableFruits(remaining, selected);
      const fruitWord = remainingFruits === 1 ? t('feature.statsHub.garden.fruit') : t('feature.statsHub.garden.fruits');
      const remainingLabel = remainingFruits !== remaining.length
        ? t('feature.statsHub.garden.remainingFruits', { fruits: String(remainingFruits), fruitWord, plants: String(remaining.length) })
        : t('feature.statsHub.garden.remaining', { count: String(remaining.length) });
      content.appendChild(buildTileSection(
        remainingLabel, remaining, selected, false,
        {
          active: activeSectionFilterSource === 'remaining',
          onToggle: (on) => {
            applySectionFilter(on ? 'remaining' : null, remaining);
            renderContent();
          },
        },
        tileFilterProps,
        selected.length > 0 ? {
          label: t('feature.statsHub.garden.filterRemaining'),
          active: filterRemainingActive,
          onToggle: (on) => {
            applyFilterRemaining(on);
            renderContent();
          },
          subToggle: (filterRemainingActive || activeSectionFilterSource === 'remaining') ? {
            label: t('feature.statsHub.garden.matchAll'),
            active: filterRemainingAllMode,
            onToggle: (on) => {
              filterRemainingAllMode = on;
              setStatsHubExcludeMutationsAllMode(on);
              renderContent();
            },
          } : null,
        } : null,
      ));

      // Visual divider between Remaining and Complete
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:rgba(143,130,255,0.18);margin:20px 0 16px;flex-shrink:0;';
      content.appendChild(divider);
    }
    content.appendChild(buildTileSection(
      isAnyFilterActive ? t('feature.statsHub.garden.complete', { count: String(complete.length) }) : t('feature.statsHub.garden.allPlantsCount', { count: String(complete.length) }),
      complete, selected, true,
      {
        active: activeSectionFilterSource === 'complete',
        onToggle: (on) => {
          applySectionFilter(on ? 'complete' : null, complete);
          renderContent();
        },
      },
      tileFilterProps,
    ));

    updateValueSummary(tiles, selected, maxSizeOnly);

    // Collect ready-badge elements from the freshly-built DOM (once per render, not every 1s)
    for (const el of content.querySelectorAll<HTMLElement>('[data-ready-at]')) {
      const t = parseInt(el.dataset.readyAt ?? '0', 10);
      const badge = el.querySelector<HTMLElement>('[data-ready-badge]');
      if (t > 0 && badge) readyBadgeEntries.push({ endTime: t, badge });
    }
  }

  // Keep currentSnapshot in sync with the atom — but do NOT trigger renderContent() here.
  const unsubscribe = onGardenSnapshot((snap) => {
    currentSnapshot = snap;
  }, false); // fireImmediately=false: snapshot already seeded via getGardenSnapshot() above

  // Live readiness badges — iterate the pre-built array instead of a DOM scan every second
  const readyCleanup = visibleInterval('garden-ready-badges', () => {
    const now = Date.now();
    for (const { endTime, badge } of readyBadgeEntries) {
      badge.style.display = endTime <= now ? 'flex' : 'none';
    }
  }, 1000);

  renderContent();
  return () => {
    unsubscribe();
    readyCleanup();
    closePlantDropdown();
    disableGardenFilter(); // clears both tile and species overrides
    setStatsHubExcludeMutationsOverride(null);
  };
}
