import { getAlertRow } from '../../features/alertHub';
import { CROP_MAX_SIZE_ROW, getCropMaxSizeFilter, isMaxWeightLogged, setCropMaxSizeFilter } from '../../features/garden/cropMaxSize';
import { getJournal } from '../../features/journal/checker';
import { t } from '../../i18n';
import { getCropSpriteDataUrlWithMutations, isSpritesReady, onSpritesReady } from '../../sprite-v2/compat';
import { HYDRATION_EVENT } from '../../sprite-v2/service/constants';
import { getPlantSafe, getPlantSpeciesSafe, onCatalogsReady } from '../../utils/game/catalogHelpers';
import { mountAlertSettings } from '../alertCentre/settingsShell';
import { createEmptyState, createSearchInput, createToggle } from '../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../core/modalWindow';
import { createIconBox } from '../shop/restockAlerts/cardShell';

export const CROP_MAX_SIZE_WINDOW_ID = 'qpm-crop-max-size';

const ROW_CSS = 'display:flex;align-items:center;gap:8px;padding:4px 0;min-height:28px;';
const NAME_CSS = 'flex:1;min-width:0;font-size:var(--qpm-font-body);color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
const NOTE_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
const WARN_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-warning);';
const ICON_SLOT_CSS = 'width:28px;flex:none;display:flex;align-items:center;justify-content:center;';

interface Crop {
  species: string;
  name: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

function listCrops(): Crop[] {
  const crops: Crop[] = [];
  for (const species of getPlantSpeciesSafe()) {
    const name = getPlantSafe(species)?.crop.name;
    if (name) crops.push({ species, name });
  }
  return crops.sort((a, b) => a.name.localeCompare(b.name));
}

function setPicked(species: string, on: boolean): void {
  const current = getCropMaxSizeFilter();
  const next = current.species.filter((s) => s !== species);
  if (on) next.push(species);
  setCropMaxSizeFilter({ ...current, species: next });
}

function renderCropMaxSize(root: HTMLElement): () => void {
  const shell = mountAlertSettings(root, t('feature.cropMaxSize.row'), getAlertRow(CROP_MAX_SIZE_ROW));
  const warning = el('div', WARN_CSS, t('feature.cropMaxSize.nothingTracked'));

  const journalBody = shell.addSection(t('feature.cropMaxSize.journalSection'));
  const journalRow = el('div', ROW_CSS);
  const journalToggle = createToggle({
    size: 'compact',
    checked: getCropMaxSizeFilter().unloggedJournal,
    onChange: (on) => {
      setCropMaxSizeFilter({ ...getCropMaxSizeFilter(), unloggedJournal: on });
      changed();
    },
  });
  journalToggle.input.setAttribute('aria-label', t('feature.cropMaxSize.journalToggle'));
  journalRow.append(journalToggle.root, el('span', NAME_CSS, t('feature.cropMaxSize.journalToggle')));
  journalBody.append(journalRow, el('div', NOTE_CSS, t('feature.cropMaxSize.journalNote')));

  const pickBody = shell.addSection(t('feature.cropMaxSize.pickSection'));
  const search = createSearchInput({ placeholder: t('feature.cropMaxSize.search'), onInput: () => { applyFilter(); } });
  search.input.setAttribute('aria-label', t('feature.cropMaxSize.search'));
  const list = el('div', 'display:flex;flex-direction:column;');
  const empty = el('div', '');
  pickBody.append(search.root, list, empty);
  root.append(warning);

  let crops: Crop[] = [];
  let logged: ReadonlySet<string> = new Set();
  let alive = true;

  function changed(): void {
    const f = getCropMaxSizeFilter();
    warning.style.display = !f.unloggedJournal && f.species.length === 0 ? '' : 'none';
    shell.refresh();
  }

  function applyFilter(): void {
    const q = search.input.value.trim().toLowerCase();
    let shown = 0;
    for (const row of list.children) {
      if (!(row instanceof HTMLElement)) continue;
      const match = !q || (row.dataset.qpmCropName ?? '').toLowerCase().includes(q);
      row.style.display = match ? 'flex' : 'none';
      if (match) shown += 1;
    }
    const message = crops.length === 0 ? t('feature.cropMaxSize.loading') : shown === 0 ? t('feature.cropMaxSize.noMatch') : null;
    empty.replaceChildren(...(message ? [createEmptyState(message)] : []));
  }

  function cropRow(crop: Crop, picked: boolean): HTMLElement {
    const row = el('div', ROW_CSS);
    row.dataset.qpmCropMaxSizeRow = crop.species;
    row.dataset.qpmCropName = crop.name;
    const toggle = createToggle({
      size: 'compact',
      checked: picked,
      onChange: (on) => { setPicked(crop.species, on); changed(); },
    });
    toggle.input.setAttribute('aria-label', t('feature.cropMaxSize.speciesAria', { name: crop.name }));
    const slot = el('span', ICON_SLOT_CSS);
    const url = isSpritesReady() ? getCropSpriteDataUrlWithMutations(crop.species, []) : '';
    if (url) slot.append(createIconBox(url, '', 'sm'));
    row.append(toggle.root, slot, el('span', NAME_CSS, crop.name));
    if (logged.has(crop.species)) row.append(el('span', `${NOTE_CSS}flex:none;`, t('feature.cropMaxSize.logged')));
    return row;
  }

  function fillRows(): void {
    const picked = new Set(getCropMaxSizeFilter().species);
    list.replaceChildren(...crops.map((c) => cropRow(c, picked.has(c.species))));
    applyFilter();
  }

  const stopCatalogs = onCatalogsReady(() => {
    crops = listCrops();
    fillRows();
  });
  const stopSprites = onSpritesReady(fillRows);
  window.addEventListener(HYDRATION_EVENT, fillRows);
  void getJournal().then((journal) => {
    if (!alive || !journal) return;
    logged = new Set(crops.map((c) => c.species).filter((s) => isMaxWeightLogged(journal, s)));
    fillRows();
  }).catch(() => { /* the tag is optional; the picker works without the journal */ });

  changed();
  applyFilter();

  return () => {
    alive = false;
    stopCatalogs();
    stopSprites();
    window.removeEventListener(HYDRATION_EVENT, fillRows);
    search.destroy();
    shell.destroy();
  };
}

export function openCropMaxSizeWindow(): void {
  if (isWindowOpen(CROP_MAX_SIZE_WINDOW_ID)) {
    closeWindow(CROP_MAX_SIZE_WINDOW_ID);
    return;
  }
  // Close ran the content cleanup; re-showing the hidden window would keep dead listeners.
  destroyWindow(CROP_MAX_SIZE_WINDOW_ID);
  openWindow(CROP_MAX_SIZE_WINDOW_ID, t('feature.cropMaxSize.row'), renderCropMaxSize, '420px', '80vh');
}
