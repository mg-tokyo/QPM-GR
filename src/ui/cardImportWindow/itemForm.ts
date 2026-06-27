// src/ui/cardImportWindow/itemForm.ts
//
// Item-data form for the Custom Card import window. Builds a PhantomInventoryItem
// from user inputs: display name, pet species (single-select), mutations
// (multi-select toggleable chips), abilities (multi-select with 4-chip cap +
// search). Reads valid values from the runtime catalogs via catalogHelpers.
//
// Phase 2a scope: itemType is locked to 'Pet'. Other types use different
// renderers and ship in 2b+.

import type { PhantomInventoryItem } from '../../integrations/nativeCardView';
import {
  getPetSpeciesSafe,
  getMutationsSafe,
  getAbilitiesSafe,
  getPetSafe,
  getAbilityName,
  getMutationName,
} from '../../utils/game/catalogHelpers';
import { createSectionHeader } from '../components/sectionHeader';
import { createSelect } from '../components/select';
import {
  createStatsSection,
  DEFAULT_XP,
  DEFAULT_HUNGER,
  DEFAULT_TARGET_SCALE,
  type StatsValues,
  type StatsSectionHandle,
} from './itemFormStats';
import {
  createOverridesSection,
  type OverridesSectionHandle,
  type SpeciesEntryShape,
} from './itemFormOverrides';
import type { SpeciesOverrides } from '../../integrations/nativeCardView';
import { getXPForMaturity } from '../../integrations/cardMath';

export const MAX_ABILITY_CHIPS = 4;

export interface ItemFormInitial {
  name?: string;
  petSpecies?: string;
  mutations?: string[];
  abilities?: string[];
}

export interface ItemFormHandle {
  root: HTMLElement;
  getItem: () => PhantomInventoryItem;
  setItem: (item: ItemFormInitial) => void;
  validate: () => ItemFormValidation;
  getStats: () => StatsValues;
  setStats: (next: Partial<StatsValues>) => void;
  getOverrides: () => SpeciesOverrides;
  setOverrides: (next: SpeciesOverrides | null) => void;
  setOverridesExpanded: (open: boolean) => void;
  onChange: (cb: () => void) => () => void;
  destroy: () => void;
}

export interface ItemFormCreateOptions {
  overridesInitiallyExpanded?: boolean;
  onOverridesExpandedChange?: (expanded: boolean) => void;
}

export interface ItemFormValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Build the phantom-item form. The form owns its own DOM and state and emits
 * change events to subscribers; the parent window decides when to read getItem()
 * and persist it as a preset.
 */
export function createItemForm(
  initial?: ItemFormInitial,
  options: ItemFormCreateOptions = {},
): ItemFormHandle {
  const state = {
    name: initial?.name ?? '',
    petSpecies: initial?.petSpecies ?? '',
    mutations: new Set(initial?.mutations ?? []),
    abilities: new Set(initial?.abilities ?? []),
  };

  const subscribers = new Set<() => void>();
  const cleanups: Array<() => void> = [];

  // Stat slider state — separate from form `state` so getStats/setStats don't bleed
  // into the four legacy fields.
  let statsHandle: StatsSectionHandle | null = null;
  // Overrides handle hoisted so stats / mutations / abilities change handlers can
  // call its refreshCaptions(). Reassigned below when the section is built.
  let overridesHandle: OverridesSectionHandle | null = null;

  function getCurrentSpeciesEntry(): { coinsToFullyReplenishHunger?: number; maxScale?: number } | null {
    if (!state.petSpecies) return null;
    // Catalog access via the safe wrapper — returns null if catalogs not ready.
    const entry = getPetSafe(state.petSpecies) as
      | { coinsToFullyReplenishHunger?: number; maxScale?: number }
      | null;
    return entry;
  }

  function getEffectiveMaxHunger(): number {
    const entry = getCurrentSpeciesEntry();
    // Default 350 preserves the legacy hardcoded value when species is unset.
    return entry?.coinsToFullyReplenishHunger ?? DEFAULT_HUNGER;
  }

  function getEffectiveMaxXp(): number {
    if (!state.petSpecies) return 10_000_000;
    const stats = statsHandle?.getStats();
    const ts = stats?.targetScale ?? DEFAULT_TARGET_SCALE;
    const xp = getXPForMaturity(state.petSpecies, ts);
    // Defensive fallback if catalogs aren't ready (returns 0).
    return xp > 0 ? xp : 10_000_000;
  }

  function getEffectiveMaxScale(): number {
    const entry = getCurrentSpeciesEntry();
    return entry?.maxScale ?? DEFAULT_TARGET_SCALE;
  }

  function isSpeciesSelected(): boolean {
    return !!state.petSpecies;
  }

  /** Returns the "fully grown / full hunger / natural max scale" defaults for a species. */
  function getSpeciesStatsDefaults(): StatsValues {
    if (!state.petSpecies) {
      return { xp: DEFAULT_XP, hunger: DEFAULT_HUNGER, targetScale: DEFAULT_TARGET_SCALE };
    }
    const entry = getCurrentSpeciesEntry();
    const targetScale = entry?.maxScale ?? DEFAULT_TARGET_SCALE;
    const hunger = entry?.coinsToFullyReplenishHunger ?? DEFAULT_HUNGER;
    const xpAtMaturity = getXPForMaturity(state.petSpecies, targetScale);
    const xp = xpAtMaturity > 0 ? Math.round(xpAtMaturity) : DEFAULT_XP;
    return { xp, hunger, targetScale };
  }

  function emit(): void {
    subscribers.forEach((cb) => {
      try { cb(); } catch { /* subscriber failure shouldn't break others */ }
    });
  }

  const root = document.createElement('div');
  root.className = 'qpm-card-import-form';
  root.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

  // ── Name ────────────────────────────────────────────────────────────────
  const nameWrap = document.createElement('div');
  nameWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  nameWrap.appendChild(createSectionHeader('Name', { size: 'compact' }).root);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'qpm-input';
  nameInput.placeholder = 'Card name';
  nameInput.maxLength = 64;
  nameInput.value = state.name;
  nameInput.style.cssText +=
    'width:100%;box-sizing:border-box;' +
    'background:rgba(0,0,0,0.3);color:#e0e0e0;' +
    'border:1px solid rgba(143,130,255,0.18);border-radius:6px;' +
    'padding:5px 8px;font-size:11px;';
  const onNameInput = (): void => { state.name = nameInput.value; emit(); };
  nameInput.addEventListener('input', onNameInput);
  cleanups.push(() => nameInput.removeEventListener('input', onNameInput));
  nameWrap.appendChild(nameInput);
  root.appendChild(nameWrap);

  // ── Species ─────────────────────────────────────────────────────────────
  const speciesWrap = document.createElement('div');
  speciesWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  speciesWrap.appendChild(createSectionHeader('Species', { size: 'compact' }).root);
  let speciesSelect: HTMLSelectElement;
  function buildSpeciesSelect(): HTMLSelectElement {
    const all = getPetSpeciesSafe();
    const options: Array<{ value: string; label: string; disabled?: boolean }> = [];
    if (all.length === 0) {
      options.push({ value: '', label: 'Catalogs not ready…', disabled: true });
    } else {
      options.push({ value: '', label: '— species —' });
      for (const key of all) {
        const entry = getPetSafe(key);
        const display = entry?.name && entry.name !== key ? `${entry.name} (${key})` : key;
        options.push({ value: key, label: display });
      }
    }
    return createSelect(options, state.petSpecies, (v) => {
      state.petSpecies = v;
      // Snap stats to species defaults before refreshing ranges, so the slider
      // values update too (not just the min/max bounds).
      if (v) statsHandle?.setStats(getSpeciesStatsDefaults());
      statsHandle?.refreshRanges();
      overridesHandle?.setSpeciesContext(getCurrentSpeciesEntryShape());
      overridesHandle?.refreshCaptions();
      emit();
    });
  }
  speciesSelect = buildSpeciesSelect();
  speciesWrap.appendChild(speciesSelect);
  root.appendChild(speciesWrap);

  // ── Mutations ───────────────────────────────────────────────────────────
  // 10 entries total — show as a flat toggleable chip grid, no search needed.
  const mutationsWrap = document.createElement('div');
  mutationsWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  mutationsWrap.appendChild(createSectionHeader('Mutations', { size: 'compact' }).root);
  const mutationsGrid = document.createElement('div');
  mutationsGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
  mutationsWrap.appendChild(mutationsGrid);
  function renderMutations(): void {
    mutationsGrid.innerHTML = '';
    const all = getMutationsSafe();
    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--qpm-text-muted);font-size:11px;';
      empty.textContent = 'Catalogs not ready…';
      mutationsGrid.appendChild(empty);
      return;
    }
    for (const id of all) {
      const chip = buildToggleChip(getMutationName(id), state.mutations.has(id));
      const onClick = (): void => {
        if (state.mutations.has(id)) state.mutations.delete(id);
        else state.mutations.add(id);
        chip.setActive(state.mutations.has(id));
        overridesHandle?.refreshCaptions();
        emit();
      };
      chip.root.addEventListener('click', onClick);
      cleanups.push(() => chip.root.removeEventListener('click', onClick));
      mutationsGrid.appendChild(chip.root);
    }
  }
  renderMutations();
  root.appendChild(mutationsWrap);

  // ── Abilities ───────────────────────────────────────────────────────────
  // 71 entries — searchable picker with 4-chip cap (matches game's ability row).
  const abilitiesWrap = document.createElement('div');
  abilitiesWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  const abilitiesHeader = document.createElement('div');
  abilitiesHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
  const abilitiesLabel = document.createElement('span');
  abilitiesLabel.style.cssText =
    'font-size:9px;font-weight:600;color:rgba(224,224,224,0.3);' +
    'text-transform:uppercase;letter-spacing:0.5px;';
  abilitiesLabel.textContent = 'Abilities';
  const abilitiesCounter = document.createElement('span');
  abilitiesCounter.style.cssText = 'font-size:10px;color:rgba(143,130,255,0.6);';
  abilitiesHeader.append(abilitiesLabel, abilitiesCounter);
  abilitiesWrap.appendChild(abilitiesHeader);

  const selectedChipRow = document.createElement('div');
  selectedChipRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;min-height:24px;';
  const abilitySearch = document.createElement('input');
  abilitySearch.type = 'text';
  abilitySearch.className = 'qpm-input';
  abilitySearch.placeholder = 'Search abilities…';
  abilitySearch.style.cssText += 'width:100%;box-sizing:border-box;';
  const abilityList = document.createElement('div');
  abilityList.style.cssText =
    'display:flex;flex-direction:column;gap:2px;' +
    'max-height:180px;overflow-y:auto;' +
    'background:var(--qpm-surface-2);' +
    'border:1px solid var(--qpm-border);' +
    'border-radius:6px;padding:4px;';
  abilitiesWrap.appendChild(selectedChipRow);
  abilitiesWrap.appendChild(abilitySearch);
  abilitiesWrap.appendChild(abilityList);

  function renderSelectedAbilityChips(): void {
    abilitiesCounter.textContent = `${state.abilities.size} / ${MAX_ABILITY_CHIPS}`;
    selectedChipRow.innerHTML = '';
    if (state.abilities.size === 0) {
      const hint = document.createElement('span');
      hint.style.cssText = 'color:var(--qpm-text-muted);font-size:11px;align-self:center;';
      hint.textContent = 'No abilities selected.';
      selectedChipRow.appendChild(hint);
      return;
    }
    state.abilities.forEach((id) => {
      const chip = document.createElement('span');
      chip.className = 'qpm-chip';
      chip.style.cursor = 'pointer';
      chip.title = 'Remove';
      chip.textContent = getAbilityName(id);
      const x = document.createElement('span');
      x.textContent = '×';
      x.style.cssText = 'opacity:0.75;margin-left:2px;';
      chip.appendChild(x);
      const onClick = (): void => {
        state.abilities.delete(id);
        renderSelectedAbilityChips();
        renderAbilityList();
        emit();
      };
      chip.addEventListener('click', onClick);
      cleanups.push(() => chip.removeEventListener('click', onClick));
      selectedChipRow.appendChild(chip);
    });
  }

  function renderAbilityList(): void {
    abilityList.innerHTML = '';
    const all = getAbilitiesSafe();
    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--qpm-text-muted);font-size:11px;padding:8px;';
      empty.textContent = 'Catalogs not ready…';
      abilityList.appendChild(empty);
      return;
    }
    const query = abilitySearch.value.trim().toLowerCase();
    const matches = all
      .map((id) => ({ id, label: getAbilityName(id) }))
      .filter(({ id, label }) =>
        query === '' || id.toLowerCase().includes(query) || label.toLowerCase().includes(query),
      )
      .sort((a, b) => a.label.localeCompare(b.label));
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--qpm-text-muted);font-size:11px;padding:8px;';
      empty.textContent = 'No matches.';
      abilityList.appendChild(empty);
      return;
    }
    for (const { id, label } of matches) {
      const row = document.createElement('button');
      row.type = 'button';
      const selected = state.abilities.has(id);
      const capped = !selected && state.abilities.size >= MAX_ABILITY_CHIPS;
      row.disabled = capped;
      row.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;gap:8px;' +
        'background:transparent;border:0;border-radius:4px;' +
        'padding:4px 8px;cursor:pointer;text-align:left;' +
        'color:' + (capped ? 'var(--qpm-text-muted)' : 'var(--qpm-text)') + ';' +
        'font-size:12px;';
      row.innerHTML =
        '<span>' + escapeHtml(label) + (selected ? ' <span style="opacity:0.6">✓</span>' : '') + '</span>' +
        '<span style="color:var(--qpm-text-muted);font-size:10px;">' + escapeHtml(id) + '</span>';
      const onHover = (): void => { row.style.background = 'var(--qpm-accent-tint)'; };
      const onLeave = (): void => { row.style.background = 'transparent'; };
      row.addEventListener('mouseenter', onHover);
      row.addEventListener('mouseleave', onLeave);
      cleanups.push(() => {
        row.removeEventListener('mouseenter', onHover);
        row.removeEventListener('mouseleave', onLeave);
      });
      const onClick = (): void => {
        if (selected) {
          state.abilities.delete(id);
        } else {
          if (state.abilities.size >= MAX_ABILITY_CHIPS) return;
          state.abilities.add(id);
        }
        renderSelectedAbilityChips();
        renderAbilityList();
        emit();
      };
      row.addEventListener('click', onClick);
      cleanups.push(() => row.removeEventListener('click', onClick));
      abilityList.appendChild(row);
    }
  }

  const onAbilitySearch = (): void => renderAbilityList();
  abilitySearch.addEventListener('input', onAbilitySearch);
  cleanups.push(() => abilitySearch.removeEventListener('input', onAbilitySearch));

  renderSelectedAbilityChips();
  renderAbilityList();
  root.appendChild(abilitiesWrap);

  // ── Stats ───────────────────────────────────────────────────────────────
  statsHandle = createStatsSection({
    initial: { xp: DEFAULT_XP, hunger: DEFAULT_HUNGER, targetScale: DEFAULT_TARGET_SCALE },
    getEffectiveMaxHunger,
    getEffectiveMaxXp,
    getEffectiveMaxScale,
    isSpeciesSelected,
    onChange: () => { overridesHandle?.refreshCaptions(); emit(); },
  });
  cleanups.push(statsHandle.destroy);
  root.appendChild(statsHandle.root);

  // ── Overrides ───────────────────────────────────────────────────────────
  function getCurrentSpeciesEntryShape(): SpeciesEntryShape | null {
    if (!state.petSpecies) return null;
    return (getPetSafe(state.petSpecies) ?? null) as SpeciesEntryShape | null;
  }

  function getOverridesItemContext(): {
    species: string;
    xp: number;
    targetScale: number;
    mutations: string[];
  } {
    const stats = statsHandle?.getStats() ?? {
      xp: DEFAULT_XP,
      hunger: DEFAULT_HUNGER,
      targetScale: DEFAULT_TARGET_SCALE,
    };
    return {
      species: state.petSpecies,
      xp: stats.xp,
      targetScale: stats.targetScale,
      mutations: Array.from(state.mutations),
    };
  }

  overridesHandle = createOverridesSection({
    initialExpanded: options.overridesInitiallyExpanded ?? false,
    initialSpeciesEntry: getCurrentSpeciesEntryShape(),
    getItemContext: getOverridesItemContext,
    onChange: emit,
    onExpandedChange: (open) => { try { options.onOverridesExpandedChange?.(open); } catch { /* best effort */ } },
  });
  cleanups.push(overridesHandle.destroy);
  root.appendChild(overridesHandle.root);

  // ── API ─────────────────────────────────────────────────────────────────
  function getItem(): PhantomInventoryItem {
    const stats = statsHandle?.getStats() ?? {
      xp: DEFAULT_XP,
      hunger: DEFAULT_HUNGER,
      targetScale: DEFAULT_TARGET_SCALE,
    };
    const item: PhantomInventoryItem = {
      id: 'qpm-phantom-' + Math.random().toString(36).slice(2, 12),
      itemType: 'Pet',
      name: state.name || 'Custom Card',
      xp: stats.xp,
      hunger: stats.hunger,
      mutations: Array.from(state.mutations),
      abilities: Array.from(state.abilities),
      abilityCooldowns: {},
      targetScale: stats.targetScale,
      sourceEggId: 'CommonEgg',
    };
    if (state.petSpecies) item.petSpecies = state.petSpecies;
    return item;
  }

  function setItem(next: ItemFormInitial): void {
    if (next.name !== undefined) {
      state.name = next.name;
      nameInput.value = next.name;
    }
    if (next.petSpecies !== undefined) {
      state.petSpecies = next.petSpecies;
      // Rebuild the select so the new option is reflected as selected.
      const newSel = buildSpeciesSelect();
      speciesSelect.replaceWith(newSel);
      speciesSelect = newSel;
      statsHandle?.refreshRanges();
      overridesHandle?.setSpeciesContext(getCurrentSpeciesEntryShape());
      overridesHandle?.refreshCaptions();
    }
    if (next.mutations) {
      state.mutations = new Set(next.mutations);
      renderMutations();
    }
    if (next.abilities) {
      const limited = Array.from(next.abilities).slice(0, MAX_ABILITY_CHIPS);
      state.abilities = new Set(limited);
      renderSelectedAbilityChips();
      renderAbilityList();
    }
    emit();
  }

  function validate(): ItemFormValidation {
    const errors: string[] = [];
    if (state.name.trim() === '') errors.push('Display name is required.');
    if (state.petSpecies === '') errors.push('Pet species is required.');
    else if (!getPetSpeciesSafe().includes(state.petSpecies)) {
      errors.push(`Species "${state.petSpecies}" is not in the catalog.`);
    }
    const invalidMutations = Array.from(state.mutations).filter(
      (id) => !getMutationsSafe().includes(id),
    );
    if (invalidMutations.length > 0) {
      errors.push(`Unknown mutations: ${invalidMutations.join(', ')}`);
    }
    const invalidAbilities = Array.from(state.abilities).filter(
      (id) => !getAbilitiesSafe().includes(id),
    );
    if (invalidAbilities.length > 0) {
      errors.push(`Unknown abilities: ${invalidAbilities.join(', ')}`);
    }
    if (state.abilities.size > MAX_ABILITY_CHIPS) {
      errors.push(`Too many abilities (max ${MAX_ABILITY_CHIPS}).`);
    }
    return { ok: errors.length === 0, errors };
  }

  function onChange(cb: () => void): () => void {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }

  function destroy(): void {
    for (const fn of cleanups) {
      try { fn(); } catch { /* best effort */ }
    }
    cleanups.length = 0;
    subscribers.clear();
  }

  return {
    root,
    getItem,
    setItem,
    validate,
    getStats: () => statsHandle?.getStats() ?? { xp: DEFAULT_XP, hunger: DEFAULT_HUNGER, targetScale: DEFAULT_TARGET_SCALE },
    setStats: (next) => { statsHandle?.setStats(next); },
    getOverrides: () => overridesHandle?.getOverrides() ?? {},
    setOverrides: (next) => { overridesHandle?.setOverrides(next); },
    setOverridesExpanded: (open) => { overridesHandle?.setExpanded(open); },
    onChange,
    destroy,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Internal builders

function buildToggleChip(label: string, active: boolean): {
  root: HTMLElement;
  setActive: (next: boolean) => void;
} {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'qpm-chip';
  chip.textContent = label;
  chip.style.cssText +=
    'cursor:pointer;font-size:11px;padding:4px 10px;' +
    'border:1px solid transparent;background:transparent;';
  function setActive(next: boolean): void {
    if (next) {
      chip.style.background = 'var(--qpm-accent-subtle)';
      chip.style.borderColor = 'var(--qpm-accent-border)';
      chip.style.color = 'var(--qpm-text)';
    } else {
      chip.style.background = 'var(--qpm-surface-2)';
      chip.style.borderColor = 'var(--qpm-border)';
      chip.style.color = 'var(--qpm-text-muted)';
    }
  }
  setActive(active);
  return { root: chip, setActive };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
