// src/ui/petPickerModal/mainModal.ts
// Core modal logic: openPetPicker and closePickerModal.

import { windowLog } from '../../core/modalWindow';
import { getAllPooledPets } from '../../../store/petTeams';
import { isSpritesReady, onSpritesReady } from '../../../sprite-v2/compat';
import { buildAbilityValuationContext } from '../../../features/pets/abilityValuation';
import { buildCompareCardViewModel } from '../../stats/comparePresentation';
import { calculateMaxStrength } from '../../../store/xpTracker';
import type { PooledPet } from '../../../types/petTeams';
import type { MutationTier, OpenPickerOptions } from './types';
import { ensureStyles } from './styles';
import { activeState, setActiveState, getSavedPickerFilters, savePickerFilters } from './state';
import { getMutationTier, getSpeciesRarityOrd, getSpriteSrc } from './helpers';
import { buildHoverPanel } from './hoverPanel';
import { buildComparePanel } from './comparePanel';
import { renderPetCard } from './petCard';
import {
  buildAbilityFilterOptions,
  resolveSavedAbilityFilter,
  petMatchesAbilityFilter,
  derivePickerCompareStage,
  getUniqueSpecies,
} from './abilityFilter';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function openPetPicker(options: OpenPickerOptions): Promise<void> {
  closePickerModal();
  ensureStyles();

  const cleanups: Array<() => void> = [];

  const overlay = document.createElement('div');
  overlay.className = 'qpm-picker-overlay';

  const modal = document.createElement('div');
  modal.className = 'qpm-picker';
  overlay.appendChild(modal);

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'qpm-picker__header';

  const title = document.createElement('div');
  title.className = 'qpm-picker__title';
  const mode = options.mode ?? 'select';
  const isCompareOnlyMode = mode === 'compare_only';
  title.textContent = options.title ?? (isCompareOnlyMode ? 'Compare Pets' : 'Pick a Pet');
  header.appendChild(title);

  const search = document.createElement('input');
  search.className = 'qpm-picker__search';
  search.placeholder = 'Search…';
  search.type = 'text';
  header.appendChild(search);

  // Location filter
  const locationFilter = document.createElement('select');
  locationFilter.className = 'qpm-picker__filter qpm-select';
  for (const [value, label] of [['all', 'All Locations'], ['active', 'Active'], ['hutch', 'Hutch'], ['inventory', 'Bag']] as const) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    locationFilter.appendChild(opt);
  }
  header.appendChild(locationFilter);

  // Sort filter
  const sortFilter = document.createElement('select');
  sortFilter.className = 'qpm-picker__filter qpm-select';
  for (const [value, label] of [['species-tier', 'Species ↓'], ['str-desc', 'STR ↓'], ['str-asc', 'STR ↑'], ['max-str-desc', 'Max STR ↓'], ['max-str-asc', 'Max STR ↑'], ['name-az', 'Name A→Z'], ['rainbow', 'Rainbow first']] as const) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    sortFilter.appendChild(opt);
  }
  header.appendChild(sortFilter);

  // Tier filter
  const tierFilter = document.createElement('select');
  tierFilter.className = 'qpm-picker__filter qpm-select';
  for (const [value, label] of [['all', 'All Tiers'], ['rainbow', '🌈 Rainbow'], ['gold', '⭐ Gold'], ['clean', 'Clean']] as const) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    tierFilter.appendChild(opt);
  }
  header.appendChild(tierFilter);

  // Ability filter (populated after pets load)
  const abilityFilter = document.createElement('select');
  abilityFilter.className = 'qpm-picker__filter qpm-select';
  const abilFilterDefaultOpt = document.createElement('option');
  abilFilterDefaultOpt.value = 'all';
  abilFilterDefaultOpt.textContent = 'All Abilities';
  abilityFilter.appendChild(abilFilterDefaultOpt);
  header.appendChild(abilityFilter);

  // Species filter (popover multi-select)
  const speciesWrap = document.createElement('div');
  speciesWrap.className = 'qpm-picker__species-wrap';
  const speciesBtn = document.createElement('button');
  speciesBtn.type = 'button';
  speciesBtn.className = 'qpm-picker__species-btn';
  speciesBtn.textContent = 'Species';
  const speciesCount = document.createElement('span');
  speciesCount.className = 'qpm-picker__species-count';
  speciesBtn.appendChild(speciesCount);
  speciesWrap.appendChild(speciesBtn);
  const speciesPopover = document.createElement('div');
  speciesPopover.className = 'qpm-picker__species-popover';
  speciesPopover.style.display = 'none';
  speciesWrap.appendChild(speciesPopover);
  header.appendChild(speciesWrap);

  // Compare button
  const compareBtn = document.createElement('button');
  compareBtn.className = 'qpm-picker__compare-btn';
  compareBtn.textContent = '⚖ Compare';
  if (isCompareOnlyMode) {
    compareBtn.style.display = 'none';
  }
  header.appendChild(compareBtn);

  modal.appendChild(header);

  // --- Main layout ---
  const main = document.createElement('div');
  main.className = 'qpm-picker__main';
  modal.appendChild(main);

  const body = document.createElement('div');
  body.className = 'qpm-picker__body';
  main.appendChild(body);

  // Right panel (hover or compare)
  const rightPanel = document.createElement('div');
  rightPanel.className = 'qpm-picker__hover-panel qpm-picker__hover-panel--empty';
  rightPanel.textContent = 'Hover a pet to see details';
  main.appendChild(rightPanel);

  // --- Footer ---
  const footer = document.createElement('div');
  footer.className = 'qpm-picker__footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'qpm-picker__cancel';
  cancelBtn.textContent = 'Cancel';
  footer.appendChild(cancelBtn);
  modal.appendChild(footer);

  document.body.appendChild(overlay);

  // --- State ---
  let allPets: PooledPet[] = [];
  let hoverTimeout: number | null = null;
  let compareMode = false;
  let compareSelected: PooledPet[] = [];
  const abilityFilterSelectionMap = new Map<string, Set<string>>();
  const shouldStartInCompareMode = options.startInCompareMode ?? isCompareOnlyMode;
  const savedFilters = getSavedPickerFilters(options.teamId);
  let compareAbilityFilter = savedFilters?.compareAbility ?? 'all';
  let selectedSpecies = new Set<string>(Array.isArray(savedFilters?.species) ? savedFilters.species : []);
  let speciesPopoverOpen = false;
  const cardMap = new Map<string, HTMLElement>(); // pet.id → card element

  if (savedFilters?.location && [...locationFilter.options].some(o => o.value === savedFilters.location)) {
    locationFilter.value = savedFilters.location;
  }
  if (savedFilters?.sort && [...sortFilter.options].some(o => o.value === savedFilters.sort)) {
    sortFilter.value = savedFilters.sort;
  }
  if (savedFilters?.tier && [...tierFilter.options].some(o => o.value === savedFilters.tier)) {
    tierFilter.value = savedFilters.tier;
  }

  function updateSpeciesSummaryLabel(): void {
    speciesCount.textContent = selectedSpecies.size > 0 ? `(${selectedSpecies.size})` : '';
    speciesBtn.title = selectedSpecies.size > 0
      ? `${selectedSpecies.size} species selected`
      : 'All species';
  }

  function setSpeciesPopoverVisible(visible: boolean): void {
    speciesPopoverOpen = visible;
    speciesPopover.style.display = visible ? '' : 'none';
  }

  function renderSpeciesPopover(): void {
    speciesPopover.innerHTML = '';
    const speciesList = getUniqueSpecies(allPets);
    if (!speciesList.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px;color:rgba(224,224,224,0.45);font-size:11px;';
      empty.textContent = 'No species loaded';
      speciesPopover.appendChild(empty);
      return;
    }

    for (const species of speciesList) {
      const row = document.createElement('label');
      row.className = 'qpm-picker__species-item';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = selectedSpecies.has(species);
      check.style.cursor = 'pointer';
      check.addEventListener('change', () => {
        if (check.checked) selectedSpecies.add(species);
        else selectedSpecies.delete(species);
        updateSpeciesSummaryLabel();
        persistFilters();
        renderList();
      });
      row.appendChild(check);

      const src = getSpriteSrc(species, []);
      if (src) {
        const img = document.createElement('img');
        img.className = 'qpm-picker__species-icon';
        img.src = src;
        img.alt = species;
        row.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'qpm-picker__species-icon';
        ph.textContent = '•';
        ph.style.textAlign = 'center';
        row.appendChild(ph);
      }

      const nameEl = document.createElement('span');
      nameEl.className = 'qpm-picker__species-name';
      nameEl.textContent = species;
      row.appendChild(nameEl);
      speciesPopover.appendChild(row);
    }
  }

  const onSpeciesBtnClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (!speciesPopoverOpen) renderSpeciesPopover();
    setSpeciesPopoverVisible(!speciesPopoverOpen);
  };
  speciesBtn.addEventListener('click', onSpeciesBtnClick);
  cleanups.push(() => speciesBtn.removeEventListener('click', onSpeciesBtnClick));

  const onPointerDown = (event: MouseEvent): void => {
    if (speciesWrap.contains(event.target as Node)) return;
    setSpeciesPopoverVisible(false);
  };
  document.addEventListener('mousedown', onPointerDown);
  cleanups.push(() => document.removeEventListener('mousedown', onPointerDown));
  updateSpeciesSummaryLabel();

  function persistFilters(): void {
    savePickerFilters(options.teamId, {
      location: locationFilter.value,
      sort: sortFilter.value,
      tier: tierFilter.value,
      ability: abilityFilter.value,
      compareAbility: compareAbilityFilter,
      species: [...selectedSpecies],
    });
  }

  // --- Compare mode ---
  function setCompareMode(active: boolean): void {
    if (isCompareOnlyMode && !active) return;
    compareMode = active;
    compareSelected = [];
    compareBtn.classList.toggle('qpm-picker__compare-btn--active', active);
    compareBtn.textContent = active ? '✕ Exit Compare' : '⚖ Compare';
    updateRightPanel(null);
    syncCompareHighlights();
  }

  function getCompareSelectionVerdict(): 'a' | 'b' | 'tie' | 'review' | null {
    if (compareSelected.length !== 2) return null;

    let valuationContext = null;
    try {
      valuationContext = buildAbilityValuationContext();
    } catch {
      /* valuation context is best-effort — compare verdict renders without it */
      valuationContext = null;
    }

    const model = buildCompareCardViewModel({
      petA: compareSelected[0] ?? null,
      petB: compareSelected[1] ?? null,
      abilityFilter: compareAbilityFilter,
      valuationContext,
      stage: derivePickerCompareStage(allPets),
      poolForRank: compareSelected,
      compactNumbers: true,
    });

    return model?.verdict ?? null;
  }

  function syncCompareHighlights(): void {
    const selectedIds = new Set(compareSelected.map(p => p.id));
    const verdict = getCompareSelectionVerdict();
    const firstSelectedId = compareSelected[0]?.id ?? null;
    const secondSelectedId = compareSelected[1]?.id ?? null;

    for (const [petId, card] of cardMap.entries()) {
      const isSelected = selectedIds.has(petId);
      card.classList.toggle('qpm-pet-card--compare-selected', isSelected);
      card.classList.remove('qpm-pet-card--compare-win', 'qpm-pet-card--compare-loss');

      if (!isSelected || compareSelected.length !== 2) continue;
      if (verdict === 'a') {
        card.classList.toggle('qpm-pet-card--compare-win', petId === firstSelectedId);
        card.classList.toggle('qpm-pet-card--compare-loss', petId === secondSelectedId);
      } else if (verdict === 'b') {
        card.classList.toggle('qpm-pet-card--compare-win', petId === secondSelectedId);
        card.classList.toggle('qpm-pet-card--compare-loss', petId === firstSelectedId);
      }
    }
  }

  function updateRightPanel(hoveredPet: PooledPet | null): void {
    if (compareMode) {
      if (compareSelected.length === 2) {
        buildComparePanel(
          compareSelected[0]!, compareSelected[1]!, rightPanel,
          compareAbilityFilter,
          derivePickerCompareStage(allPets),
          (newFilter) => {
            compareAbilityFilter = newFilter;
            persistFilters();
            syncCompareHighlights();
            updateRightPanel(null);
          },
        );
      } else {
        rightPanel.className = 'qpm-picker__hover-panel qpm-picker__hover-panel--empty';
        rightPanel.innerHTML = '';

        const banner = document.createElement('div');
        banner.className = 'qpm-picker__compare-banner';

        const bTitle = document.createElement('div');
        bTitle.className = 'qpm-picker__compare-banner-title';
        bTitle.textContent = '⚖ Compare Mode';
        banner.appendChild(bTitle);

        const bCount = document.createElement('div');
        bCount.className = 'qpm-picker__compare-count';
        bCount.textContent = `${compareSelected.length} / 2 selected`;
        banner.appendChild(bCount);

        const bHint = document.createElement('div');
        bHint.textContent = compareSelected.length === 0
          ? 'Click two pets to compare them'
          : 'Click one more pet to compare';
        banner.appendChild(bHint);

        const clearBtn2 = document.createElement('button');
        clearBtn2.className = 'qpm-picker__compare-clear';
        clearBtn2.textContent = isCompareOnlyMode ? 'Clear Selection' : '✕ Cancel Compare';
        clearBtn2.addEventListener('click', () => {
          if (isCompareOnlyMode) {
            compareSelected = [];
            syncCompareHighlights();
            updateRightPanel(null);
            return;
          }
          setCompareMode(false);
        });
        banner.appendChild(clearBtn2);

        rightPanel.appendChild(banner);
      }
      return;
    }

    if (!hoveredPet) {
      rightPanel.className = 'qpm-picker__hover-panel qpm-picker__hover-panel--empty';
      rightPanel.textContent = 'Hover a pet to see details';
      return;
    }
    buildHoverPanel(hoveredPet, rightPanel);
  }

  function onHover(pet: PooledPet | null): void {
    if (compareMode) return; // hover does nothing in compare mode
    if (hoverTimeout !== null) { window.clearTimeout(hoverTimeout); hoverTimeout = null; }
    if (!pet) {
      hoverTimeout = window.setTimeout(() => updateRightPanel(null), 200);
      return;
    }
    updateRightPanel(pet);
  }

  function handleCardClick(pet: PooledPet): void {
    if (compareMode || isCompareOnlyMode) {
      const existingIdx = compareSelected.findIndex(p => p.id === pet.id);
      if (existingIdx >= 0) {
        // Deselect
        compareSelected.splice(existingIdx, 1);
      } else if (compareSelected.length < 2) {
        compareSelected.push(pet);
      } else {
        // Replace oldest
        compareSelected.shift();
        compareSelected.push(pet);
      }
      syncCompareHighlights();
      updateRightPanel(null);
      return;
    }
    // Block selection of pets already assigned to another slot in this team
    if (options.usedPetIds?.has(pet.id)) return;
    options.onSelect(pet.id);
    closePickerModal();
  }

  // --- Filtering & sorting ---
  function applySort(pets: PooledPet[]): PooledPet[] {
    const sort = sortFilter.value;
    const copy = [...pets];
    if (sort === 'species-tier') {
      copy.sort((a, b) => {
        const rarDiff = getSpeciesRarityOrd(b.species) - getSpeciesRarityOrd(a.species);
        if (rarDiff !== 0) return rarDiff;
        const specCmp = a.species.localeCompare(b.species);
        if (specCmp !== 0) return specCmp;
        const tierOrd = (t: MutationTier) =>
          t === 'rainbow' ? 0 : t === 'gold' ? 1 : t === 'mutated' ? 2 : 3;
        const tDiff = tierOrd(getMutationTier(a.mutations)) - tierOrd(getMutationTier(b.mutations));
        if (tDiff !== 0) return tDiff;
        const aMax = calculateMaxStrength(a.targetScale, a.species) ?? a.strength ?? -1;
        const bMax = calculateMaxStrength(b.targetScale, b.species) ?? b.strength ?? -1;
        return bMax - aMax;
      });
    } else if (sort === 'str-desc') {
      copy.sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1));
    } else if (sort === 'str-asc') {
      copy.sort((a, b) => (a.strength ?? -1) - (b.strength ?? -1));
    } else if (sort === 'max-str-desc') {
      copy.sort((a, b) => {
        const aMax = calculateMaxStrength(a.targetScale, a.species) ?? a.strength ?? -1;
        const bMax = calculateMaxStrength(b.targetScale, b.species) ?? b.strength ?? -1;
        return bMax - aMax;
      });
    } else if (sort === 'max-str-asc') {
      copy.sort((a, b) => {
        const aMax = calculateMaxStrength(a.targetScale, a.species) ?? a.strength ?? -1;
        const bMax = calculateMaxStrength(b.targetScale, b.species) ?? b.strength ?? -1;
        return aMax - bMax;
      });
    } else if (sort === 'name-az') {
      copy.sort((a, b) => (a.name || a.species).localeCompare(b.name || b.species));
    } else if (sort === 'rainbow') {
      copy.sort((a, b) => {
        const ta = getMutationTier(a.mutations);
        const tb = getMutationTier(b.mutations);
        const tierOrd = (t: MutationTier) => t === 'rainbow' ? 0 : t === 'gold' ? 1 : t === 'mutated' ? 2 : 3;
        const tdiff = tierOrd(ta) - tierOrd(tb);
        if (tdiff !== 0) return tdiff;
        return (b.strength ?? -1) - (a.strength ?? -1);
      });
    }
    return copy;
  }

  function renderList(): void {
    cardMap.clear();
    const term = search.value.toLowerCase().trim();
    const loc = locationFilter.value;
    const tierVal = tierFilter.value;

    let filtered = allPets.filter(p => {
      if (options.allowedItemIds && !options.allowedItemIds.has(p.id)) return false;
      if (loc !== 'all' && p.location !== loc) return false;
      if (term && !p.name.toLowerCase().includes(term) && !p.species.toLowerCase().includes(term)) return false;
      if (selectedSpecies.size > 0 && !selectedSpecies.has(p.species)) return false;
      if (tierVal !== 'all') {
        const t = getMutationTier(p.mutations);
        if (tierVal === 'clean' && t !== 'none') return false;
        if (tierVal !== 'clean' && t !== tierVal) return false;
      }
      if (!petMatchesAbilityFilter(p, abilityFilter.value, abilityFilterSelectionMap)) return false;
      return true;
    });

    filtered = applySort(filtered);

    body.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'qpm-picker__empty';
      empty.textContent = 'No pets found';
      body.appendChild(empty);
      return;
    }

    for (const pet of filtered) {
      const inUse = !isCompareOnlyMode && options.usedPetIds?.has(pet.id) && pet.location !== 'active';
      const card = renderPetCard(pet, () => handleCardClick(pet), onHover);
      if (inUse) {
        card.style.opacity = '0.45';
        card.style.pointerEvents = 'none';
        card.style.cursor = 'not-allowed';
        card.title = `[In use] ${card.title}`;
      }
      cardMap.set(pet.id, card);
      body.appendChild(card);
    }

    // Re-apply compare highlights after re-render
    if (compareMode) syncCompareHighlights();
  }

  // --- Load pets ---
  try {
    allPets = await getAllPooledPets();
    const abilitySourcePets = options.allowedItemIds
      ? allPets.filter((pet) => options.allowedItemIds?.has(pet.id))
      : allPets;
    buildAbilityFilterOptions(abilitySourcePets, abilityFilter, abilityFilterSelectionMap);
    abilityFilter.value = resolveSavedAbilityFilter(savedFilters?.ability, abilityFilterSelectionMap);
    const validSpecies = new Set(getUniqueSpecies(allPets));
    selectedSpecies = new Set([...selectedSpecies].filter((species) => validSpecies.has(species)));
    updateSpeciesSummaryLabel();
    renderSpeciesPopover();
  } catch (error) {
    windowLog.warn('QPM-UI-002', { what: 'petPicker:loadPets' }, error);
  }

  if (Array.isArray(options.preselectedCompareItemIds) && options.preselectedCompareItemIds.length > 0) {
    const preselectedSet = new Set(options.preselectedCompareItemIds);
    compareSelected = allPets.filter((pet) => preselectedSet.has(pet.id)).slice(0, 2);
  }

  if (shouldStartInCompareMode) {
    compareMode = true;
    compareBtn.classList.add('qpm-picker__compare-btn--active');
    compareBtn.textContent = '✕ Exit Compare';
    if (isCompareOnlyMode) {
      compareBtn.style.display = 'none';
    }
  }

  renderList();
  updateRightPanel(null);
  persistFilters();

  if (!isSpritesReady()) {
    const offSpritesReady = onSpritesReady(() => {
      renderSpeciesPopover();
      renderList();
      updateRightPanel(null);
    });
    cleanups.push(offSpritesReady);
  }

  // --- Wire events ---
  const onSearch = () => renderList();
  const onFilterChange = () => {
    persistFilters();
    renderList();
  };
  search.addEventListener('input', onSearch);
  locationFilter.addEventListener('change', onFilterChange);
  sortFilter.addEventListener('change', onFilterChange);
  tierFilter.addEventListener('change', onFilterChange);
  abilityFilter.addEventListener('change', onFilterChange);
  cleanups.push(() => {
    search.removeEventListener('input', onSearch);
    locationFilter.removeEventListener('change', onFilterChange);
    sortFilter.removeEventListener('change', onFilterChange);
    tierFilter.removeEventListener('change', onFilterChange);
    abilityFilter.removeEventListener('change', onFilterChange);
  });

  const onCompareClick = (): void => setCompareMode(!compareMode);
  if (!isCompareOnlyMode) {
    compareBtn.addEventListener('click', onCompareClick);
    cleanups.push(() => compareBtn.removeEventListener('click', onCompareClick));
  }

  const doClose = () => { options.onCancel?.(); closePickerModal(); };
  cancelBtn.addEventListener('click', doClose);
  cleanups.push(() => cancelBtn.removeEventListener('click', doClose));

  const onOverlayClick = (e: MouseEvent) => { if (e.target === overlay) doClose(); };
  overlay.addEventListener('click', onOverlayClick);
  cleanups.push(() => overlay.removeEventListener('click', onOverlayClick));

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') doClose(); };
  window.addEventListener('keydown', onKey);
  cleanups.push(() => window.removeEventListener('keydown', onKey));

  setTimeout(() => search.focus(), 50);

  setActiveState({
    container: modal,
    overlay,
    cleanups,
    onSelect: options.onSelect,
    onCancel: options.onCancel ?? (() => {}),
  });
}

export function closePickerModal(): void {
  if (!activeState) return;
  const state = activeState;
  setActiveState(null);
  state.cleanups.forEach(fn => fn());
  state.overlay.remove();
}
