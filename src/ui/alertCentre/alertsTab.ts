import {
  areAlertSoundsOn,
  getAlertRowSettings,
  listAlertRows,
  setAlertRowEnabled,
  setAlertRowSound,
  setAlertSoundsOn,
  type AlertGroup,
  type AlertRowDef,
} from '../../features/alertHub';
import { t } from '../../i18n';
import { createButton, createSectionHeader, createSelect, createToggle, type SelectOption } from '../components';
import { BUILTIN_SOUNDS, getCustomSounds } from '../shop/restockAlerts/soundConfig';
import { previewSound } from '../shop/restockAlerts/soundEngine';
import { getLinkedRows, type LinkedRow } from './linkedRows';

const GROUP_ORDER: readonly AlertGroup[] = ['shops', 'pets', 'garden', 'room', 'qpm'];
const NO_SOUND = 'none';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ROW_CSS = 'display:flex;align-items:center;gap:8px;padding:6px 0;min-height:30px;';
const NAME_CSS = 'flex:1;min-width:0;font-size:var(--qpm-font-body);color:var(--qpm-text);';
const NOTE_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';

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

function settingsButton(onClick: () => void): HTMLButtonElement {
  return createButton(t('feature.alertCentre.settings'), { variant: 'ghost', size: 'sm', onClick });
}

function hubRow(def: AlertRowDef): HTMLElement {
  const row = el('div', ROW_CSS);
  row.dataset.qpmAlertCentreRow = def.id;
  const settings = getAlertRowSettings(def.id, def.defaultSound, def.defaultEnabled);
  const name = t(def.labelKey);
  const toggle = createToggle({ size: 'compact', checked: settings.enabled, onChange: (on) => { setAlertRowEnabled(def.id, on); } });
  toggle.input.setAttribute('aria-label', t('feature.alertCentre.rowAria', { name }));
  let soundId = settings.soundId;
  const test = createButton(t('feature.alertCentre.test'), { variant: 'ghost', size: 'sm', onClick: () => { playPreview(soundId); }, disabled: soundId === NO_SOUND });
  const select = createSelect(soundOptions(), soundId, (value) => {
    soundId = value;
    setAlertRowSound(def.id, value);
    test.disabled = value === NO_SOUND;
  });
  select.setAttribute('aria-label', t('feature.alertCentre.soundAria', { name }));
  row.append(toggle.root, el('span', NAME_CSS, name), select, test);
  if (def.settingsAction) row.append(settingsButton(def.settingsAction));
  return row;
}

function linkedRow(def: LinkedRow, cleanups: Array<() => void>): HTMLElement {
  const row = el('div', ROW_CSS);
  row.dataset.qpmAlertCentreRow = def.id;
  const name = t(def.labelKey);
  if (def.toggle) {
    const tg = def.toggle;
    const toggle = createToggle({ size: 'compact', checked: tg.get(), onChange: (on) => { tg.set(on); } });
    toggle.input.setAttribute('aria-label', t('feature.alertCentre.rowAria', { name }));
    cleanups.push(tg.subscribe((on) => { toggle.setChecked(on); }));
    row.append(toggle.root);
  } else {
    // Keeps the names aligned with the toggled rows.
    row.append(el('span', 'width:28px;flex:none;'));
  }
  row.append(el('span', NAME_CSS, name), el('span', NOTE_CSS, t(def.noteKey)), settingsButton(def.open));
  return row;
}

/** Master sound toggle, then hub rows and linked producers grouped by section. Returns its cleanup. */
export function renderAlertsTab(container: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  const master = createToggle({ checked: areAlertSoundsOn(), label: t('feature.alertCentre.soundsOn'), onChange: (on) => { setAlertSoundsOn(on); } });
  const masterWrap = el('div', 'padding:4px 0 8px;border-bottom:1px solid var(--qpm-border);');
  masterWrap.append(master.root);
  container.append(masterWrap);

  const hubRows = listAlertRows();
  const linked = getLinkedRows();
  for (const group of GROUP_ORDER) {
    const own = hubRows.filter((r) => r.group === group);
    const links = linked.filter((r) => r.group === group);
    if (own.length === 0 && links.length === 0) continue;
    const section = el('div', 'margin-top:8px;');
    section.append(createSectionHeader(t(`feature.alertCentre.group.${group}`), { size: 'compact' }).root);
    for (const def of own) section.append(hubRow(def));
    for (const def of links) section.append(linkedRow(def, cleanups));
    container.append(section);
  }
  return () => { for (const fn of cleanups) fn(); };
}
