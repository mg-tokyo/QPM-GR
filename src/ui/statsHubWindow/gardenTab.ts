// src/ui/statsHubWindow/gardenTab.ts
// Garden tab — mutation progress, tile cards, popover detail, filter persistence.

import { storage } from '../../utils/storage';
import { t } from '../../i18n';
import { onGardenSnapshot, getGardenSnapshot, type GardenSnapshot } from '../../features/gardenBridge';
import { getPlantSpecies, getMutationCatalog } from '../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../utils/cropMultipliers';
import { visibleInterval } from '../../utils/timerManager';
import { createToggle } from '../components';
import { setStatsHubSpeciesOverride, setStatsHubExcludeMutationsOverride, setStatsHubTileOverride, setStatsHubExcludeMutationsAllMode } from '../../features/gardenFilters';
import type { TileEntry, StatsHubFilters, SectionFilterSource } from './types';
import { STATS_HUB_FILTERS_KEY, FILTER_MUTATIONS_FALLBACK } from './constants';
import { plantSprite } from './spriteHelpers';
import { pillBtnCss, makeCoinValueEl } from './styleHelpers';
import { extractTiles, tileSpecies, tileValue, tilesToKeys } from './tileHelpers';
import {
  mutsMatch,
  filterCompatibleMutations,
  simulateMutationsAfterApplying,
  isTileActionable,
  countActionableFruits,
  countMaxSizeRemainingFruits,
} from './mutationCompat';
import { closePopover } from './gardenPopover';
import { buildTileSection } from './gardenTileCard';

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

    const tileIsComplete = selectedMutations.length > 0 ? !isTileActionable(tile, selectedMutations) : true;

    for (const slot of tile.slots) {
      const mutMult = computeMutationMultiplier(slot.mutations).totalMultiplier;
      const slotCurrent = Math.round(base * slot.targetScale * mutMult);
      current += slotCurrent;

      const potentialScale = (maxSizeOnly && slot.sizePercent < 100) ? slot.maxScale : slot.targetScale;

      let potentialMutMult = mutMult;
      if (selectedMutations.length > 0 && !tileIsComplete) {
        const slotMissing = selectedMutations.filter(
          (sel) => !slot.mutations.some((m) => mutsMatch(m, sel)),
        );
        const toAdd = filterCompatibleMutations(slot.mutations, slotMissing);
        const withSelected = simulateMutationsAfterApplying(slot.mutations, toAdd);
        potentialMutMult = computeMutationMultiplier(withSelected).totalMultiplier;
      }

      potential += Math.round(base * potentialScale * potentialMutMult);
    }
  }
  return { current, potential };
}

// ---------------------------------------------------------------------------
// Species filter dropdown
// ---------------------------------------------------------------------------

function buildSpeciesCheckRow(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  species?: string,
): HTMLElement {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--qpm-text);';
  row.addEventListener('mouseenter', () => { row.style.background = 'rgba(143,130,255,0.1)'; });
  row.addEventListener('mouseleave', () => { row.style.background = ''; });

  const toggle = createToggle({ checked, onChange, size: 'compact' });
  row.appendChild(toggle.root);

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

  // Clear any stale override from a previous session
  setStatsHubSpeciesOverride(null);
  setStatsHubExcludeMutationsOverride(null);
  setStatsHubTileOverride(null);

  let filterRemainingActive = false;
  let filterRemainingAllMode = false;

  function applyFilterRemaining(on: boolean): void {
    filterRemainingActive = on;
    if (on) {
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

  // Pre-built array of ready-badge entries
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
  plantFilterBtn.dataset.tour = 'stats-plant-filter';
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

  plantFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (plantDropdownEl) { closePlantDropdown(); return; }

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
  filterBar.dataset.tour = 'stats-mutation-filters';
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
  filterLabel.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.38);white-space:nowrap;';
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
  maxSizePillBtn.dataset.tour = 'stats-max-size';
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
  content.dataset.tour = 'stats-tile-grid';
  content.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:16px;';
  container.appendChild(content);

  // Seeded immediately from the bridge cache
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
      makeCoinValueEl(current, t('feature.statsHub.garden.current'), 'font-size:14px;font-weight:700;color:var(--qpm-gold);')
    );

    if ((selected.length > 0 || maxSize) && potential > current) {
      const gain = potential - current;
      const arrowSep = document.createElement('span');
      arrowSep.style.cssText = 'color:rgba(255,255,255,0.18);font-size:12px;';
      arrowSep.textContent = '→';
      valueSummaryBar.appendChild(arrowSep);
      valueSummaryBar.appendChild(
        makeCoinValueEl(gain, '+', 'font-size:14px;font-weight:700;color:rgba(100,230,150,0.9);')
      );
      const gainLbl = document.createElement('span');
      gainLbl.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.38);';
      gainLbl.textContent = t('feature.statsHub.garden.ifCompleted');
      valueSummaryBar.appendChild(gainLbl);
    }
  }

  function renderContent(): void {
    saveStatsHubFilters({
      speciesFilters: activeSpeciesFilters.size > 0 ? Array.from(activeSpeciesFilters) : [],
      mutationFilters: activeFilters.size > 0 ? Array.from(activeFilters) : [],
      maxSizeOnly,
    });
    content.innerHTML = '';
    readyBadgeEntries = [];
    const allTiles = extractTiles(currentSnapshot);
    const selected = Array.from(activeFilters);

    if (filterRemainingActive) {
      if (selected.length > 0) {
        setStatsHubExcludeMutationsOverride(selected);
      } else {
        filterRemainingActive = false;
        setStatsHubExcludeMutationsOverride(null);
      }
    }

    const tiles = activeSpeciesFilters.size > 0
      ? allTiles.filter((t) => activeSpeciesFilters.has(tileSpecies(t)))
      : allTiles;

    if (tiles.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:rgba(224,224,224,0.3);font-size:14px;padding:32px 0;text-align:center;';
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
    gardenHint.style.cssText = 'color:rgba(224,224,224,0.25);font-size:12px;padding:0 0 4px;';
    gardenHint.textContent = t('feature.statsHub.garden.clickPlantHint');
    content.appendChild(gardenHint);

    const remaining: TileEntry[] = [];
    const complete: TileEntry[] = [];
    const isAnyFilterActive = selected.length > 0 || maxSizeOnly;

    for (const tile of tiles) {
      if (!isAnyFilterActive) {
        complete.push(tile);
      } else {
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

    // Collect ready-badge elements
    for (const el of content.querySelectorAll<HTMLElement>('[data-ready-at]')) {
      const t = parseInt(el.dataset.readyAt ?? '0', 10);
      const badge = el.querySelector<HTMLElement>('[data-ready-badge]');
      if (t > 0 && badge) readyBadgeEntries.push({ endTime: t, badge });
    }
  }

  const unsubscribe = onGardenSnapshot((snap) => {
    currentSnapshot = snap;
  }, false);

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
    disableGardenFilter();
    setStatsHubExcludeMutationsOverride(null);
  };
}
