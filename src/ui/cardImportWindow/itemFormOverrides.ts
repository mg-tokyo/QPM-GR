// src/ui/cardImportWindow/itemFormOverrides.ts
//
// Advanced overrides section of the Custom Cards item form. Five fields that
// override selected faunaSpeciesDex[species] values during the card-open
// lifecycle (Rarity / Diet / Max Hunger / Mature Weight / Base Sell Price).
//
// Collapsible — collapsed by default. Caller persists expanded state.
// On species change, caller should call setSpeciesContext(newSpeciesEntry)
// which wipes all overrides and re-renders default values.

import { createButton } from '../components/button';
import { createSelect } from '../components/select';
import { getPlantSpeciesSafe } from '../../utils/game/catalogHelpers';
import type { SpeciesOverrides } from '../../integrations/nativeCardView';
import {
  getPetScale,
  calculateMutationsMultiplier,
  formatWeightNumber,
} from '../../integrations/cardMath';

export interface SpeciesEntryShape {
  rarity?: SpeciesOverrides['rarity'];
  diet?: string[];
  coinsToFullyReplenishHunger?: number;
  matureWeight?: number;
  maturitySellPrice?: number;
}

export interface OverridesItemContext {
  /** Currently-selected pet species ID. Empty string when none. */
  species: string;
  /** Current XP slider value. */
  xp: number;
  /** Current target-scale slider value. */
  targetScale: number;
  /** Current selected mutation IDs. */
  mutations: string[];
}

export interface OverridesSectionOptions {
  initialExpanded: boolean;
  initialOverrides?: SpeciesOverrides;
  initialSpeciesEntry?: SpeciesEntryShape | null;
  /**
   * Returns the current XP / scale / mutations / species, used to compute the
   * "Displayed: ~X" captions under the Mature Weight and Base Sell inputs. The
   * caller must invoke `refreshCaptions()` whenever any of these change.
   */
  getItemContext?: () => OverridesItemContext;
  onChange?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
}

export interface OverridesSectionHandle {
  root: HTMLElement;
  getOverrides: () => SpeciesOverrides;
  setOverrides: (next: SpeciesOverrides | null) => void;
  setSpeciesContext: (speciesEntry: SpeciesEntryShape | null) => void;
  setExpanded: (open: boolean) => void;
  /** Re-evaluate the live "Displayed: ~X" captions under derived-value fields. */
  refreshCaptions: () => void;
  destroy: () => void;
}

// Display label uses the familiar "Mythic" name; the value uses 'Mythical' to
// match the dex's runtime enum stringification (rarity.ts: Mythic = 'Mythical').
const RARITY_OPTIONS: ReadonlyArray<{ value: NonNullable<SpeciesOverrides['rarity']>; label: string; multiplier: string }> = [
  { value: 'Common',    label: 'Common',    multiplier: '1×' },
  { value: 'Uncommon',  label: 'Uncommon',  multiplier: '2×' },
  { value: 'Rare',      label: 'Rare',      multiplier: '5×' },
  { value: 'Legendary', label: 'Legendary', multiplier: '10×' },
  { value: 'Mythical',  label: 'Mythic',    multiplier: '50×' },
  { value: 'Divine',    label: 'Divine',    multiplier: '50×' },
  { value: 'Celestial', label: 'Celestial', multiplier: '50×' },
];

export function createOverridesSection(opts: OverridesSectionOptions): OverridesSectionHandle {
  let expanded = opts.initialExpanded;
  let speciesEntry: SpeciesEntryShape | null = opts.initialSpeciesEntry ?? null;
  let overrides: SpeciesOverrides = { ...(opts.initialOverrides ?? {}) };

  // Captions registered per renderBody() pass — wiped when the body re-renders.
  let captionRefreshers: Array<() => void> = [];

  function emit(): void { try { opts.onChange?.(); } catch { /* best effort */ } }
  function runCaptionRefreshers(): void {
    for (const fn of captionRefreshers) { try { fn(); } catch { /* best effort */ } }
  }

  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  // Header row: label + chevron + reset button
  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;';
  const headerLeft = document.createElement('span');
  headerLeft.style.cssText =
    'font-size:9px;font-weight:600;color:rgba(224,224,224,0.3);' +
    'text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;gap:6px;';
  const chevron = document.createElement('span');
  chevron.textContent = '▸';
  chevron.style.cssText = 'transition:transform 0.15s ease;display:inline-block;';
  const labelEl = document.createElement('span');
  labelEl.textContent = 'Advanced overrides';
  headerLeft.append(chevron, labelEl);
  header.appendChild(headerLeft);

  const resetBtn = createButton('Reset to species', {
    variant: 'tonal',
    size: 'sm',
    onClick: () => {
      overrides = {};
      renderBody();
      emit();
    },
  });
  resetBtn.style.fontSize = '10px';
  header.appendChild(resetBtn);

  root.appendChild(header);

  // Body — toggled by header click
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:6px 0 0 0;';
  root.appendChild(body);

  function applyExpanded(): void {
    chevron.style.transform = expanded ? 'rotate(90deg)' : 'rotate(0deg)';
    body.style.display = expanded ? '' : 'none';
    resetBtn.style.display = expanded ? '' : 'none';
  }
  applyExpanded();

  const onHeaderClick = (e: MouseEvent): void => {
    // Ignore clicks on the reset button — let it handle them.
    if (resetBtn.contains(e.target as Node)) return;
    expanded = !expanded;
    applyExpanded();
    try { opts.onExpandedChange?.(expanded); } catch { /* best effort */ }
  };
  header.addEventListener('click', onHeaderClick);

  function renderBody(): void {
    body.innerHTML = '';
    captionRefreshers = [];
    if (!speciesEntry) {
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.4);padding:8px;';
      hint.textContent = 'Select a species to see override fields.';
      body.appendChild(hint);
      return;
    }

    // Rarity ────────────────────────────────────────────────────────────────
    body.appendChild(buildFieldRow('Rarity', buildRaritySelect()));

    // Diet ─────────────────────────────────────────────────────────────────
    body.appendChild(buildFieldRow('Diet', buildDietPicker()));

    // Max Hunger — raw 1:1 with the card's hunger bar denominator; no caption needed.
    body.appendChild(buildFieldRow('Max Hunger', buildNumberInput({
      initial: overrides.coinsToFullyReplenishHunger ?? speciesEntry.coinsToFullyReplenishHunger ?? 0,
      step: 1,
      onChange: (v) => { overrides.coinsToFullyReplenishHunger = v; emit(); },
    })));

    // Mature Weight — card displays `getPetScale(...) × matureWeight`. Caption
    // shows the live derived value so the user can see how the raw input maps
    // to what the card renders.
    body.appendChild(buildFieldRow('Mature Weight', buildNumberInput({
      initial: overrides.matureWeight ?? speciesEntry.matureWeight ?? 0,
      step: 0.1,
      suffix: 'kg',
      onChange: (v) => { overrides.matureWeight = v; emit(); runCaptionRefreshers(); },
      caption: (raw) => {
        const ctx = opts.getItemContext?.();
        if (!ctx || !ctx.species) return '';
        const scale = getPetScale({ speciesId: ctx.species, xp: ctx.xp, targetScale: ctx.targetScale });
        return `Displayed: ~${formatWeightNumber(scale * raw)} kg`;
      },
    })));

    // Base Sell Price — card displays `Math.round(maturitySellPrice × scale × mutationMult)`.
    body.appendChild(buildFieldRow('Base Sell', buildNumberInput({
      initial: overrides.maturitySellPrice ?? speciesEntry.maturitySellPrice ?? 0,
      step: 1,
      suffix: 'coins',
      onChange: (v) => { overrides.maturitySellPrice = v; emit(); runCaptionRefreshers(); },
      caption: (raw) => {
        const ctx = opts.getItemContext?.();
        if (!ctx || !ctx.species) return '';
        const scale = getPetScale({ speciesId: ctx.species, xp: ctx.xp, targetScale: ctx.targetScale });
        const mult = calculateMutationsMultiplier(ctx.mutations);
        const displayed = Math.max(0, Math.round(raw * scale * mult));
        return `Displayed: ~${displayed.toLocaleString()} coins`;
      },
    })));
  }

  function buildRaritySelect(): HTMLElement {
    const current = overrides.rarity ?? speciesEntry?.rarity ?? 'Common';
    const options = RARITY_OPTIONS.map((r) => ({
      value: r.value,
      label: `${r.label}  (${r.multiplier})`,
    }));
    const sel = createSelect(options, current, (v) => {
      overrides.rarity = v as NonNullable<SpeciesOverrides['rarity']>;
      emit();
    });
    sel.style.flex = '1';
    return sel;
  }

  function buildDietPicker(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex:1;';
    const current = overrides.diet ?? speciesEntry?.diet ?? [];
    for (const cropId of current) {
      const chip = document.createElement('span');
      chip.className = 'qpm-chip';
      chip.style.cursor = 'pointer';
      chip.textContent = cropId;
      const x = document.createElement('span');
      x.textContent = ' ×';
      x.style.cssText = 'opacity:0.6;margin-left:2px;';
      chip.appendChild(x);
      chip.addEventListener('click', () => {
        overrides.diet = current.filter((c) => c !== cropId);
        renderBody();
        emit();
      });
      wrap.appendChild(chip);
    }
    // Add-crop select: full flora list minus already-selected
    const flora = getPlantSpeciesSafe();
    const available = flora.filter((id) => !current.includes(id));
    if (available.length > 0) {
      const addSel = createSelect(
        [{ value: '', label: '+ Add crop' }, ...available.map((id) => ({ value: id, label: id }))],
        '',
        (v) => {
          if (!v) return;
          overrides.diet = [...current, v];
          renderBody();
          emit();
        },
      );
      wrap.appendChild(addSel);
    }
    return wrap;
  }

  interface NumberInputOpts {
    initial: number;
    step: number;
    onChange: (v: number) => void;
    suffix?: string;
    /** Optional caption text below the input. Re-evaluated on input change and on refreshCaptions(). */
    caption?: (currentValue: number) => string;
  }

  function buildNumberInput(opts: NumberInputOpts): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1;';

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const input = document.createElement('input');
    input.type = 'number';
    input.value = opts.step < 1 ? opts.initial.toFixed(1) : String(Math.round(opts.initial));
    input.step = String(opts.step);
    input.min = '0';
    input.style.cssText =
      'flex:1;background:rgba(0,0,0,0.3);color:#e0e0e0;' +
      'border:1px solid rgba(143,130,255,0.18);border-radius:6px;' +
      'padding:3px 6px;font-size:11px;text-align:right;';
    inputRow.appendChild(input);
    if (opts.suffix) {
      const s = document.createElement('span');
      s.textContent = opts.suffix;
      s.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.4);';
      inputRow.appendChild(s);
    }
    wrap.appendChild(inputRow);

    let captionEl: HTMLElement | null = null;
    if (opts.caption) {
      captionEl = document.createElement('span');
      captionEl.style.cssText =
        'font-size:10px;color:rgba(143,130,255,0.55);align-self:flex-end;line-height:1;';
      captionEl.textContent = opts.caption(opts.initial);
      wrap.appendChild(captionEl);
      // Register so external refreshCaptions() can pick up xp/scale/mutation changes.
      captionRefreshers.push(() => {
        if (!captionEl || !opts.caption) return;
        const v = parseFloat(input.value);
        captionEl.textContent = opts.caption(Number.isFinite(v) && v >= 0 ? v : opts.initial);
      });
    }

    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v >= 0) {
        opts.onChange(v);
        if (captionEl && opts.caption) captionEl.textContent = opts.caption(v);
      }
    });

    return wrap;
  }

  function buildFieldRow(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:90px 1fr;gap:8px;align-items:center;';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.55);';
    row.append(l, control);
    return row;
  }

  // Initial render
  renderBody();

  return {
    root,
    getOverrides: () => ({ ...overrides }),
    setOverrides: (next) => {
      overrides = next ? { ...next } : {};
      renderBody();
    },
    setSpeciesContext: (entry) => {
      speciesEntry = entry;
      overrides = {}; // species change wipes overrides per spec
      renderBody();
      emit();
    },
    setExpanded: (open) => {
      expanded = open;
      applyExpanded();
    },
    refreshCaptions: runCaptionRefreshers,
    destroy: () => {
      header.removeEventListener('click', onHeaderClick);
    },
  };
}
