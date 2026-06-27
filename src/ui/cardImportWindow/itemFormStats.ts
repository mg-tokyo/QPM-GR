// src/ui/cardImportWindow/itemFormStats.ts
//
// Stats section of the Custom Cards item form. Three sliders that drive the
// PhantomInventoryItem's xp / hunger / targetScale fields. Ranges are not
// fixed — they depend on the currently-selected species (and possibly an
// override on max hunger), so the caller passes accessor functions and calls
// refreshRanges() when species or overrides change.
//
// Stat values are not clamped on save — a user-typed XP that exceeds the
// species' max is preserved verbatim. The slider visually clamps but the
// state holds the typed number.

import { createSectionHeader } from '../components/sectionHeader';
import { formatNumber } from '../../utils/formatters';

export const DEFAULT_XP = 999999;
export const DEFAULT_HUNGER = 350;
export const DEFAULT_TARGET_SCALE = 2.5;
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 5.0;
export const SCALE_STEP = 0.1;

export interface StatsValues {
  xp: number;
  hunger: number;
  targetScale: number;
}

export interface StatsSectionOptions {
  initial: StatsValues;
  /** Returns the current species' max hunger, accounting for any active override. */
  getEffectiveMaxHunger: () => number;
  /** Returns the current species' max XP (computed from max strength + targetScale). */
  getEffectiveMaxXp: () => number;
  /** Returns the current species' max scale (`maxScale` from dex), falls back to SCALE_MAX. */
  getEffectiveMaxScale: () => number;
  /** Returns true if a species is currently selected. When false, sliders disable. */
  isSpeciesSelected: () => boolean;
  onChange?: () => void;
}

export interface StatsSectionHandle {
  root: HTMLElement;
  getStats: () => StatsValues;
  setStats: (next: Partial<StatsValues>) => void;
  /** Re-read max hunger / max XP via the accessors and update slider ranges. */
  refreshRanges: () => void;
  destroy: () => void;
}

export function createStatsSection(opts: StatsSectionOptions): StatsSectionHandle {
  const state: StatsValues = {
    xp: opts.initial.xp,
    hunger: opts.initial.hunger,
    targetScale: opts.initial.targetScale,
  };
  const cleanups: Array<() => void> = [];

  function emit(): void { try { opts.onChange?.(); } catch { /* best effort */ } }

  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  root.appendChild(createSectionHeader('Stats', { size: 'compact' }).root);

  const xpRow = buildSliderRow({
    label: 'XP',
    min: 0,
    max: Math.max(opts.getEffectiveMaxXp(), 1),
    step: 1,
    value: state.xp,
    format: (v) => formatNumber(Math.round(v)),
    enabled: opts.isSpeciesSelected(),
    onInput: (v) => { state.xp = Math.round(v); emit(); },
  });
  const hungerRow = buildSliderRow({
    label: 'Hunger',
    min: 0,
    max: Math.max(opts.getEffectiveMaxHunger(), 1),
    step: 1,
    value: state.hunger,
    format: (v) => {
      const max = Math.max(opts.getEffectiveMaxHunger(), 1);
      const pct = Math.round((v / max) * 100);
      return `${Math.round(v).toLocaleString()} (${pct}%)`;
    },
    enabled: opts.isSpeciesSelected(),
    onInput: (v) => { state.hunger = Math.round(v); emit(); },
  });
  const scaleRow = buildSliderRow({
    label: 'Scale',
    min: SCALE_MIN,
    max: Math.max(opts.getEffectiveMaxScale(), SCALE_MIN + SCALE_STEP),
    step: SCALE_STEP,
    value: state.targetScale,
    format: (v) => `${v.toFixed(1)}×`,
    enabled: opts.isSpeciesSelected(),
    onInput: (v) => { state.targetScale = Math.round(v * 10) / 10; emit(); },
  });

  cleanups.push(xpRow.destroy, hungerRow.destroy, scaleRow.destroy);
  root.append(xpRow.root, hungerRow.root, scaleRow.root);

  return {
    root,
    getStats: () => ({ ...state }),
    setStats: (next) => {
      if (next.xp !== undefined) { state.xp = next.xp; xpRow.setValue(state.xp); }
      if (next.hunger !== undefined) { state.hunger = next.hunger; hungerRow.setValue(state.hunger); }
      if (next.targetScale !== undefined) { state.targetScale = next.targetScale; scaleRow.setValue(state.targetScale); }
      emit();
    },
    refreshRanges: () => {
      const enabled = opts.isSpeciesSelected();
      xpRow.setRange(0, Math.max(opts.getEffectiveMaxXp(), 1));
      xpRow.setEnabled(enabled);
      hungerRow.setRange(0, Math.max(opts.getEffectiveMaxHunger(), 1));
      hungerRow.setEnabled(enabled);
      scaleRow.setRange(SCALE_MIN, Math.max(opts.getEffectiveMaxScale(), SCALE_MIN + SCALE_STEP));
      scaleRow.setEnabled(enabled);
      // Re-render formatted displays in case max changed (hunger percent depends on it).
      hungerRow.refreshDisplay();
    },
    destroy: () => { for (const fn of cleanups) { try { fn(); } catch { /* best effort */ } } },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Slider row primitive — label + range input + numeric display + typeable number input

interface SliderRowOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  enabled: boolean;
  onInput: (value: number) => void;
}

interface SliderRowHandle {
  root: HTMLElement;
  setValue: (v: number) => void;
  setRange: (min: number, max: number) => void;
  setEnabled: (on: boolean) => void;
  refreshDisplay: () => void;
  destroy: () => void;
}

function buildSliderRow(opts: SliderRowOptions): SliderRowHandle {
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;grid-template-columns:60px 1fr auto;gap:8px;align-items:center;';

  const label = document.createElement('span');
  label.textContent = opts.label;
  label.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.6);';
  root.appendChild(label);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(opts.min);
  slider.max = String(opts.max);
  slider.step = String(opts.step);
  slider.value = String(opts.value);
  slider.style.cssText = 'width:100%;accent-color:#8f82ff;';
  root.appendChild(slider);

  const display = document.createElement('input');
  display.type = 'number';
  display.value = formatNumberForInput(opts.value, opts.step);
  display.min = String(opts.min);
  display.step = String(opts.step);
  display.style.cssText =
    'width:90px;text-align:right;background:rgba(0,0,0,0.3);' +
    'color:#e0e0e0;border:1px solid rgba(143,130,255,0.18);' +
    'border-radius:6px;padding:3px 6px;font-size:11px;';
  root.appendChild(display);

  const formattedReadout = document.createElement('span');
  formattedReadout.style.cssText = 'font-size:10px;color:rgba(143,130,255,0.55);grid-column:2;justify-self:end;margin-top:-4px;';
  formattedReadout.textContent = opts.format(opts.value);
  root.appendChild(formattedReadout);

  let current = opts.value;
  const format = opts.format;

  function commit(next: number): void {
    current = next;
    slider.value = String(next);
    display.value = formatNumberForInput(next, opts.step);
    formattedReadout.textContent = format(next);
    opts.onInput(next);
  }

  const onSlide = (): void => {
    const v = parseFloat(slider.value);
    if (Number.isFinite(v)) commit(v);
  };
  const onTyped = (): void => {
    const v = parseFloat(display.value);
    if (Number.isFinite(v)) {
      // Don't clamp on type — the spec preserves user-typed values even past max.
      commit(v);
    }
  };
  slider.addEventListener('input', onSlide);
  display.addEventListener('change', onTyped);

  function setEnabled(on: boolean): void {
    slider.disabled = !on;
    display.disabled = !on;
    label.style.opacity = on ? '1' : '0.4';
    formattedReadout.style.opacity = on ? '1' : '0.4';
  }
  setEnabled(opts.enabled);

  return {
    root,
    setValue: (v) => commit(v),
    setRange: (min, max) => {
      slider.min = String(min);
      slider.max = String(max);
      display.min = String(min);
    },
    setEnabled,
    refreshDisplay: () => { formattedReadout.textContent = format(current); },
    destroy: () => {
      slider.removeEventListener('input', onSlide);
      display.removeEventListener('change', onTyped);
    },
  };
}

function formatNumberForInput(value: number, step: number): string {
  if (step < 1) return value.toFixed(1);
  return String(Math.round(value));
}
