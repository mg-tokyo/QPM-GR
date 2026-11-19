import { getAlertRow } from '../../features/alertHub';
import {
  getMutationPickerSections,
  getWatchedMutations,
  MUTATION_GAIN_ROW,
  mutationColor,
  mutationIcon,
  setWatchedMutations,
  type PickerSection,
} from '../../features/garden/mutationGain';
import { t } from '../../i18n';
import { getAnySpriteDataUrl, isSpritesReady, onSpritesReady } from '../../sprite-v2/compat';
import { HYDRATION_EVENT } from '../../sprite-v2/service/constants';
import { getMutationName } from '../../utils/game/catalogHelpers';
import { createColorDot, mountAlertSettings } from '../alertCentre/settingsShell';
import { createEmptyState, createSearchInput, createToggle } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { createIconBox } from '../shop/restockAlerts/cardShell';

export const MUTATION_GAIN_WINDOW_ID = 'qpm-mutation-gain';

const ROW_CSS = 'display:flex;align-items:center;gap:8px;padding:4px 0;min-height:28px;';
const NAME_CSS = 'flex:1;min-width:0;font-size:var(--qpm-font-body);color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
const NOTE_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
const ICON_SLOT_CSS = 'width:28px;flex:none;display:flex;align-items:center;justify-content:center;';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setWatched(id: string, on: boolean): void {
  const next = getWatchedMutations().filter((m) => m !== id);
  if (on) next.push(id);
  setWatchedMutations(next);
}

function mutationRow(id: string, weather: string | null, onChange: () => void): HTMLElement {
  const row = el('div', ROW_CSS);
  row.dataset.qpmMutationGainRow = id;
  const name = getMutationName(id);
  const toggle = createToggle({
    size: 'compact',
    checked: getWatchedMutations().includes(id),
    onChange: (on) => { setWatched(id, on); onChange(); },
  });
  toggle.input.setAttribute('aria-label', t('feature.mutationGain.mutationAria', { name }));
  const icon = mutationIcon(id);
  const color = mutationColor(id);
  const slot = el('span', ICON_SLOT_CSS);
  if (color) slot.style.setProperty('--qpm-alert-color', color);
  if (icon) slot.append(createIconBox(icon, '', 'sm'));
  else if (color) slot.append(createColorDot(color));
  row.append(toggle.root, slot, el('span', NAME_CSS, name));
  if (weather) row.append(el('span', `${NOTE_CSS}flex:none;`, t('feature.mutationGain.fromWeather', { weather })));
  return row;
}

function sectionTitle(section: PickerSection): string {
  return section.weathers.length
    ? t('feature.mutationGain.weatherSection', { list: section.weathers.map((w) => w.name).join(', ') })
    : t('feature.mutationGain.otherSection');
}

/** The first weather's sprite (else the first mutation's icon) and the first solid mutation colour. */
function sectionLook(section: PickerSection): { icon: () => string | null; accent: () => string | null } {
  return {
    icon: () => {
      const key = section.weathers[0]?.spriteKey;
      if (key) return (isSpritesReady() && getAnySpriteDataUrl(key)) || null;
      const first = section.mutations[0];
      return first ? mutationIcon(first.id) ?? null : null;
    },
    accent: () => {
      for (const m of section.mutations) {
        const color = mutationColor(m.id);
        if (color) return color;
      }
      return null;
    },
  };
}

const signatureOf = (sections: readonly PickerSection[]): string =>
  sections.map((s) => `${s.weathers.map((w) => w.name).join(',')}:${s.mutations.map((m) => `${m.id}/${m.weather ?? ''}`).join(',')}`).join('|');

interface BuiltSection {
  section: PickerSection;
  card: HTMLElement;
  body: HTMLElement;
}

function renderMutationGain(root: HTMLElement): () => void {
  const shell = mountAlertSettings(root, t('feature.mutationGain.row'), getAlertRow(MUTATION_GAIN_ROW));
  root.append(el('div', NOTE_CSS, t('feature.mutationGain.note')));
  const search = createSearchInput({ placeholder: t('feature.mutationGain.search'), onInput: () => { applyFilter(); } });
  search.input.setAttribute('aria-label', t('feature.mutationGain.search'));
  const list = el('div', 'display:flex;flex-direction:column;gap:8px;');
  const empty = el('div', '');
  root.append(search.root, list, empty);

  let built: BuiltSection[] = [];
  let builtSignature: string | null = null;

  function applyFilter(): void {
    const q = search.input.value.trim().toLowerCase();
    let shown = 0;
    for (const b of built) {
      let inSection = 0;
      for (const row of b.body.children) {
        if (!(row instanceof HTMLElement)) continue;
        const id = row.dataset.qpmMutationGainRow ?? '';
        const match = !q || getMutationName(id).toLowerCase().includes(q);
        row.style.display = match ? 'flex' : 'none';
        if (match) inSection += 1;
      }
      b.card.style.display = inSection ? '' : 'none';
      shown += inSection;
    }
    const message = builtSignature === '' ? t('feature.mutationGain.loading') : shown === 0 ? t('feature.mutationGain.noMatch') : null;
    empty.replaceChildren(...(message ? [createEmptyState(message)] : []));
  }

  function fillRows(): void {
    for (const b of built) {
      b.body.replaceChildren(...b.section.mutations.map((m) => mutationRow(m.id, m.weather, shell.refresh)));
    }
    applyFilter();
  }

  // Sections are rebuilt only when the catalogs change shape; the shell's section cards append to root.
  function build(): void {
    const sections = getMutationPickerSections();
    const signature = signatureOf(sections);
    if (signature === builtSignature) return;
    builtSignature = signature;
    list.replaceChildren();
    built = sections.map((section) => {
      const body = shell.addSection(sectionTitle(section), sectionLook(section));
      const card = body.parentElement ?? body;
      list.append(card);
      return { section, card, body };
    });
    fillRows();
  }

  const stopSprites = onSpritesReady(fillRows);
  window.addEventListener(HYDRATION_EVENT, fillRows);
  // The weather catalog loads on its own with no event; re-read it when the pointer comes back.
  root.addEventListener('pointerenter', build);
  build();

  return () => {
    stopSprites();
    window.removeEventListener(HYDRATION_EVENT, fillRows);
    root.removeEventListener('pointerenter', build);
    search.destroy();
    shell.destroy();
  };
}

export function openMutationGainWindow(): void {
  if (isWindowOpen(MUTATION_GAIN_WINDOW_ID)) {
    closeWindow(MUTATION_GAIN_WINDOW_ID);
    return;
  }
  // Close ran the content cleanup; re-showing the hidden window would keep dead listeners.
  destroyWindow(MUTATION_GAIN_WINDOW_ID);
  openWindow(MUTATION_GAIN_WINDOW_ID, t('feature.mutationGain.row'), renderMutationGain, '420px', '80vh');
}
