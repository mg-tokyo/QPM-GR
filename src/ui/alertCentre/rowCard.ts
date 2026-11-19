import {
  ALERT_CARD_SIZE,
  areAlertSoundsOn,
  getAlertRowSettings,
  getRowCardSize,
  previewAlertRowCardSize,
  resolveRowAccent,
  resolveRowIcon,
  resolveRowLabel,
  resolveRowSummary,
  setAlertRowCardSize,
  setAlertRowEnabled,
  setAlertRowSound,
  setAlertSoundsOn,
  type AlertRowDef,
} from '../../features/alertHub';
import { t } from '../../i18n';
import { getAnySpriteDataUrl, isSpritesReady } from '../../sprite-v2/compat';
import { createButton, createSelect, createSliderRowControl, createToggle, renderIcon, type SelectOption } from '../components';
import { createIconBox, ensureCardShellStyles } from '../shop/restockAlerts/cardShell';
import { BUILTIN_SOUNDS, getCustomSounds } from '../shop/restockAlerts/soundConfig';
import { previewSound } from '../shop/restockAlerts/soundEngine';
import { createDesktopTick } from './desktopCard';
import type { CardSizeHooks, LinkedRow } from './linkedRows';

const STYLE_ID = 'qpm-alert-centre-style';
const NO_SOUND = 'none';
// Keys checked in the live atlas 2026-11-16.
const BELL_ON = 'sprite/ui/NotifierBellOn';
const BELL_OFF = 'sprite/ui/NotifierBellOff';
const GEAR = 'sprite/ui/BigGear';
const OFF_COLOR = 'var(--qpm-text-muted)';

const CSS = [
  '.qpm-alert-centre-card{display:flex;align-items:center;gap:12px;margin-top:6px;padding:8px 12px;box-sizing:border-box;background:var(--qpm-surface-2);border:1px solid var(--qpm-border);border-radius:var(--qpm-radius-md);font-family:var(--qpm-font);transition:border-color 0.15s ease;}',
  '.qpm-alert-centre-card--on{border-color:color-mix(in srgb, var(--qpm-alert-color) 50%, transparent);}',
  '.qpm-alert-centre-card__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
  '.qpm-alert-centre-card__name{font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-semibold);color:var(--qpm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.qpm-alert-centre-card__summary{font-size:var(--qpm-font-body);color:var(--qpm-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.qpm-alert-centre-card__note{font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);opacity:0.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  // A width, not max-width: `.qpm-window *` sets max-width:100% at the same specificity and wins.
  '.qpm-alert-centre-card__size{width:220px;}',
  '.qpm-alert-centre-card__extras{display:flex;align-items:center;gap:16px;margin-top:2px;}',
  '.qpm-alert-centre-card__controls{display:flex;align-items:center;gap:6px;flex-shrink:0;}',
  '.qpm-alert-centre-card .qpm-alert-card__icon{transition:background 0.15s ease,border-color 0.15s ease;}',
  '.qpm-alert-centre-master{margin-top:0;padding:12px;}',
  '.qpm-alert-centre-master__state{font-size:var(--qpm-font-title);font-weight:var(--qpm-weight-bold);letter-spacing:0.5px;color:var(--qpm-text-muted);transition:color 0.15s ease;}',
  '.qpm-alert-centre-card--on .qpm-alert-centre-master__state{color:var(--qpm-positive);}',
].join('');

export function ensureCentreStyles(): void {
  ensureCardShellStyles();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function div(className: string, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface RowCard {
  root: HTMLElement;
  /** null when the row has no switch of its own (it is not counted). */
  isOn(): boolean | null;
  /** Re-reads the stored state, icon, summary and accent. */
  refresh(): void;
}

interface Shell {
  root: HTMLDivElement;
  controls: HTMLDivElement;
  /** The line under the text for the card size slider and the Desktop tick; created on first use. */
  extras(): HTMLDivElement;
  paint(on: boolean, look: AlertRowDef): void;
}

export function letterBox(name: string): HTMLDivElement {
  const box = div('qpm-alert-card__icon');
  const letter = document.createElement('span');
  letter.className = 'qpm-alert-card__icon-fallback';
  letter.textContent = name.charAt(0).toUpperCase();
  box.append(letter);
  return box;
}

function createShell(rowId: string, name: string, note?: string): Shell {
  const root = div('qpm-alert-centre-card');
  root.dataset.qpmAlertCentreRow = rowId;
  const iconSlot = div('qpm-alert-centre-card__icon');
  const text = div('qpm-alert-centre-card__text');
  const summary = div('qpm-alert-centre-card__summary');
  text.append(div('qpm-alert-centre-card__name', name), summary);
  if (note) text.append(div('qpm-alert-centre-card__note', note));
  const controls = div('qpm-alert-centre-card__controls');
  root.append(iconSlot, text, controls);
  let iconUrl: string | null | undefined;
  let extras: HTMLDivElement | null = null;

  return {
    root,
    controls,
    extras() {
      if (!extras) {
        extras = div('qpm-alert-centre-card__extras');
        text.append(extras);
      }
      return extras;
    },
    paint(on, look) {
      root.classList.toggle('qpm-alert-centre-card--on', on);
      root.dataset.qpmAlertCentreOn = String(on);
      root.style.setProperty('--qpm-alert-color', on ? resolveRowAccent(look) ?? 'var(--qpm-accent)' : OFF_COLOR);
      const nextSummary = resolveRowSummary(look) ?? '';
      if (summary.textContent !== nextSummary) summary.textContent = nextSummary;
      summary.style.display = nextSummary ? '' : 'none';
      const nextIcon = resolveRowIcon(look);
      if (nextIcon === iconUrl) return;
      iconUrl = nextIcon;
      iconSlot.replaceChildren(nextIcon ? createIconBox(nextIcon, name, 'lg') : letterBox(name));
    },
  };
}

/** "Card size" under the row text; dragging resizes the row's open cards, release stores. Returns a re-read. */
function appendSizeSlider(shell: Shell, rowId: string, hooks: CardSizeHooks): () => void {
  const size = createSliderRowControl({
    label: t('feature.alertCentre.cardSize'),
    labelWidth: 'auto',
    min: ALERT_CARD_SIZE.min,
    max: ALERT_CARD_SIZE.max,
    step: ALERT_CARD_SIZE.step,
    value: hooks.get(),
    onChange: (v) => { hooks.preview(v); },
    onCommit: (v) => { hooks.commit(v); },
  });
  size.root.classList.add('qpm-alert-centre-card__size');
  size.root.dataset.qpmAlertCentreSize = rowId;
  shell.extras().append(size.root);
  return () => { size.setValue(hooks.get()); };
}

function appendDesktopTick(shell: Shell, rowId: string, name: string, onChange: () => void): () => void {
  const tick = createDesktopTick(rowId, name, onChange);
  shell.extras().append(tick.root);
  return tick.refresh;
}

function soundOptions(): SelectOption[] {
  const custom = Object.entries(getCustomSounds()).map(([id, s]) => ({ value: id, label: s.name }));
  return [{ value: NO_SOUND, label: t('feature.alertCentre.sound.none') }, ...BUILTIN_SOUNDS.map((s) => ({ value: s.id, label: s.name })), ...custom];
}

function playPreview(soundId: string): void {
  if (soundId === NO_SOUND) return;
  const custom = getCustomSounds()[soundId];
  if (custom) previewSound(soundId, 0.7, true, custom.dataUrl);
  else previewSound(soundId);
}

/** Hub row: toggle, sound + ▶ preview, ⚙ Settings when the feature has a window. */
export function createHubRowCard(def: AlertRowDef, onChange: () => void): RowCard {
  const name = resolveRowLabel(def);
  const shell = createShell(def.id, name);
  const stored = () => getAlertRowSettings(def.id, def.defaultSound, def.defaultEnabled);
  const initial = stored();
  let soundId = initial.soundId;

  const toggle = createToggle({
    size: 'compact',
    checked: initial.enabled,
    onChange: (on) => {
      setAlertRowEnabled(def.id, on);
      shell.paint(on, def);
      onChange();
    },
  });
  toggle.input.setAttribute('aria-label', t('feature.alertCentre.rowAria', { name }));
  // U+FE0E keeps ▶ a text glyph; Windows draws the bare character as a blue emoji tile.
  const test = createButton('▶︎', { variant: 'ghost', size: 'sm', onClick: () => { playPreview(soundId); }, disabled: soundId === NO_SOUND });
  test.title = t('feature.alertCentre.test');
  test.setAttribute('aria-label', test.title);
  const select = createSelect(soundOptions(), soundId, (value) => {
    soundId = value;
    setAlertRowSound(def.id, value);
    test.disabled = value === NO_SOUND;
  });
  select.setAttribute('aria-label', t('feature.alertCentre.soundAria', { name }));
  shell.controls.append(toggle.root, select, test);
  if (def.settingsAction) {
    const settings = createButton(t('feature.alertCentre.settings'), { variant: 'ghost', size: 'sm', onClick: def.settingsAction });
    const gear = renderIcon(GEAR, { size: 12 });
    gear.style.marginRight = '4px';
    settings.prepend(gear);
    shell.controls.append(settings);
  }

  const syncSize = appendSizeSlider(shell, def.id, {
    get: () => getRowCardSize(def.id),
    preview: (v) => { previewAlertRowCardSize(def.id, v); },
    commit: (v) => { setAlertRowCardSize(def.id, v); },
  });
  const syncDesktop = appendDesktopTick(shell, def.id, name, onChange);

  const refresh = (): void => {
    const now = stored();
    toggle.setChecked(now.enabled);
    syncSize();
    syncDesktop();
    if (now.soundId !== soundId) {
      soundId = now.soundId;
      select.value = soundId;
      test.disabled = soundId === NO_SOUND;
    }
    shell.paint(now.enabled, def);
  };
  refresh();
  return { root: shell.root, isOn: () => stored().enabled, refresh };
}

/** Linked producer: its own controls live in its window; the card links there with "Open". */
export function createLinkedRowCard(def: LinkedRow, onChange: () => void, cleanups: Array<() => void>): RowCard {
  const name = t(def.labelKey);
  const shell = createShell(def.id, name, t(def.noteKey));
  const look: AlertRowDef = { ...def, defaultSound: NO_SOUND };
  const tg = def.toggle;
  const isOn = (): boolean | null => (tg ? tg.get() : null);
  // A row without a switch is configured in its own window, so it keeps its colour.
  const paint = (): void => { shell.paint(isOn() ?? true, look); };

  if (tg) {
    const toggle = createToggle({ size: 'compact', checked: tg.get(), onChange: (on) => { tg.set(on); } });
    toggle.input.setAttribute('aria-label', t('feature.alertCentre.rowAria', { name }));
    cleanups.push(tg.subscribe((on) => {
      toggle.setChecked(on);
      paint();
      onChange();
    }));
    shell.controls.append(toggle.root);
  }
  shell.controls.append(createButton(t('feature.alertCentre.open'), { variant: 'ghost', size: 'sm', onClick: def.open }));
  const syncSize = def.cardSize ? appendSizeSlider(shell, def.id, def.cardSize) : null;
  const syncDesktop = def.desktop ? appendDesktopTick(shell, def.id, name, onChange) : null;
  const refresh = (): void => {
    syncSize?.();
    syncDesktop?.();
    paint();
  };
  paint();
  return { root: shell.root, isOn, refresh };
}

export interface MasterCard {
  root: HTMLElement;
  setCount(on: number, total: number): void;
  refresh(): void;
}

/** Master gate for every alert sound: bell sprite, big ON/OFF, "N of M alerts on". */
export function createMasterCard(): MasterCard {
  const root = div('qpm-alert-centre-card qpm-alert-centre-master');
  root.dataset.qpmAlertCentreMaster = '';
  const iconSlot = div('qpm-alert-centre-card__icon');
  const text = div('qpm-alert-centre-card__text');
  const count = div('qpm-alert-centre-card__summary');
  text.append(div('qpm-alert-centre-card__name', t('feature.alertCentre.master.title')), count);
  const state = div('qpm-alert-centre-master__state');
  let iconKey: string | null | undefined;

  const paint = (on: boolean): void => {
    root.classList.toggle('qpm-alert-centre-card--on', on);
    root.dataset.qpmAlertCentreOn = String(on);
    root.style.setProperty('--qpm-alert-color', on ? 'var(--qpm-positive)' : OFF_COLOR);
    state.textContent = t(on ? 'feature.alertCentre.master.on' : 'feature.alertCentre.master.off');
    const key = on ? BELL_ON : BELL_OFF;
    const url = isSpritesReady() ? getAnySpriteDataUrl(key) : '';
    const shown = url ? key : null;
    if (shown === iconKey) return;
    iconKey = shown;
    iconSlot.replaceChildren(url ? createIconBox(url, '', 'lg') : div('qpm-alert-card__icon'));
  };

  const toggle = createToggle({
    size: 'large',
    checked: areAlertSoundsOn(),
    onChange: (on) => {
      setAlertSoundsOn(on);
      paint(on);
    },
  });
  toggle.input.setAttribute('aria-label', t('feature.alertCentre.soundsOn'));
  const controls = div('qpm-alert-centre-card__controls');
  controls.append(state, toggle.root);
  root.append(iconSlot, text, controls);

  const refresh = (): void => {
    const on = areAlertSoundsOn();
    toggle.setChecked(on);
    paint(on);
  };
  refresh();
  return {
    root,
    setCount(on, total) { count.textContent = t('feature.alertCentre.master.count', { on, total }); },
    refresh,
  };
}
