// INP-4.4 (D3): choose the seeds, eggs and decor that get their own key; layout approved 2026-11-18.

import {
  getMyItems, listPickableItems, MY_ITEM_KINDS, myItemKey, myItemsInBag, onMyItemsChange,
  type MyItemKind, type PickableItem,
} from '../../../features/input/selectItem';
import { chooseMyItem } from '../../../features/input/keybinds';
import { t } from '../../../i18n';
import { getAnySpriteDataUrl, isSpritesReady, onSpritesReady } from '../../../sprite-v2/compat';
import { HYDRATION_EVENT } from '../../../sprite-v2/service/constants';
import { onInventoryChange } from '../../../store/inventory';
import { onCatalogsReady } from '../../../utils/game/catalogHelpers';
import { mountAlertSettings, type AlertLook } from '../../alertCentre/settingsShell';
import { createEmptyState, createSearchInput, createToggle } from '../../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../../core/modalWindow';
import { createIconBox } from '../../shop/restockAlerts/cardShell';
import { KEYBINDS_SPRITE, kindSprite } from './labels';

export const ITEM_PICKER_WINDOW_ID = 'qpm-keybind-items';

const ROW_CSS = 'display:flex;align-items:center;gap:8px;padding:4px 0;min-height:28px;';
const NAME_CSS = 'flex:1;min-width:0;font-size:var(--qpm-font-body);color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
const NOTE_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
const ICON_SLOT_CSS = 'width:28px;flex:none;display:flex;align-items:center;justify-content:center;';

const SECTION_TITLE: Readonly<Record<MyItemKind, string>> = {
  seed: 'feature.keybinds.picker.seeds',
  egg: 'feature.keybinds.picker.eggs',
  decor: 'feature.keybinds.picker.decor',
};

interface PickRow {
  item: PickableItem;
  key: string;
  root: HTMLElement;
  slot: HTMLElement;
  tag: HTMLElement;
  setChecked(on: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

function spriteUrl(key: string | null): string {
  return key && isSpritesReady() ? getAnySpriteDataUrl(key) || '' : '';
}

function pickRow(item: PickableItem, chosen: boolean): PickRow {
  const root = el('div', ROW_CSS);
  root.dataset.qpmItemPickerRow = myItemKey(item);
  const toggle = createToggle({ size: 'compact', checked: chosen, onChange: (on) => { chooseMyItem(item, on); } });
  toggle.input.setAttribute('aria-label', t('feature.keybinds.picker.itemAria', { name: item.name }));
  const slot = el('span', ICON_SLOT_CSS);
  const tag = el('span', `${NOTE_CSS}flex:none;display:none;`, t('feature.keybinds.picker.inBag'));
  root.append(toggle.root, slot, el('span', NAME_CSS, item.name), tag);
  return { item, key: myItemKey(item), root, slot, tag, setChecked: toggle.setChecked };
}

function paintIcon(row: PickRow): void {
  const url = spriteUrl(row.item.spriteKey);
  if (!url || row.slot.dataset.qpmUrl === url) return;
  row.slot.dataset.qpmUrl = url;
  row.slot.replaceChildren(createIconBox(url, '', 'sm'));
}

export function renderItemPicker(root: HTMLElement): () => void {
  const look: AlertLook = {
    icon: () => spriteUrl(KEYBINDS_SPRITE) || null,
    summary: () => t('feature.keybinds.picker.summary', { count: getMyItems().length }),
    accent: 'var(--qpm-accent)',
  };
  const shell = mountAlertSettings(root, t('feature.keybinds.picker.title'), look);
  let onlyOwned = false;
  root.append(el('div', NOTE_CSS, t('feature.keybinds.picker.note')));
  const search = createSearchInput({ placeholder: t('feature.keybinds.picker.search'), onInput: () => { applyFilter(); } });
  search.input.setAttribute('aria-label', t('feature.keybinds.picker.search'));
  const ownedOnly = createToggle({
    size: 'compact', checked: false, label: t('feature.keybinds.picker.ownedOnly'),
    onChange: (on) => { onlyOwned = on; applyFilter(); },
  });
  ownedOnly.root.dataset.qpmItemPickerOwnedOnly = '';
  const empty = el('div', '');
  root.append(search.root, ownedOnly.root);

  const bodies = new Map<MyItemKind, HTMLElement>();
  for (const kind of MY_ITEM_KINDS) {
    const body = shell.addSection(t(SECTION_TITLE[kind]), { icon: () => spriteUrl(kindSprite(kind)) || null });
    body.dataset.qpmItemPickerSection = kind;
    bodies.set(kind, body);
  }
  root.append(empty);

  let rows: PickRow[] = [];
  let builtSignature = '';
  let owned: ReadonlySet<string> = new Set();

  function applyFilter(): void {
    const q = search.getValue().trim().toLowerCase();
    const shownPer = new Map<MyItemKind, number>();
    let shown = 0;
    for (const row of rows) {
      const match = (!q || row.item.name.toLowerCase().includes(q)) && (!onlyOwned || owned.has(row.key));
      row.root.style.display = match ? 'flex' : 'none';
      if (!match) continue;
      shown += 1;
      shownPer.set(row.item.kind, (shownPer.get(row.item.kind) ?? 0) + 1);
    }
    for (const [kind, body] of bodies) (body.parentElement ?? body).style.display = shownPer.get(kind) ? '' : 'none';
    const message = rows.length === 0 ? t('feature.keybinds.picker.loading') : shown === 0 ? t('feature.keybinds.picker.noMatch') : null;
    empty.replaceChildren(...(message ? [createEmptyState(message)] : []));
  }

  function paintBag(): void {
    owned = myItemsInBag(rows.map(r => r.item));
    for (const row of rows) row.tag.style.display = owned.has(row.key) ? '' : 'none';
    applyFilter();
  }

  function paintIcons(): void {
    for (const row of rows) paintIcon(row);
    shell.refresh();
  }

  function syncChosen(): void {
    const chosen = new Set(getMyItems().map(myItemKey));
    for (const row of rows) row.setChecked(chosen.has(row.key));
    shell.refresh();
  }

  // Rows are rebuilt only when the catalog lists change shape.
  function build(): void {
    const lists = MY_ITEM_KINDS.map(kind => listPickableItems(kind));
    const signature = lists.map(list => list.map(myItemKey).join(',')).join('|');
    if (signature === builtSignature) return;
    builtSignature = signature;
    const chosen = new Set(getMyItems().map(myItemKey));
    rows = lists.flat().map(item => pickRow(item, chosen.has(myItemKey(item))));
    for (const [kind, body] of bodies) body.replaceChildren(...rows.filter(r => r.item.kind === kind).map(r => r.root));
    paintIcons();
    paintBag();
  }

  const stopCatalogs = onCatalogsReady(build);
  const stopSprites = onSpritesReady(paintIcons);
  const stopBag = onInventoryChange(paintBag);
  const stopMine = onMyItemsChange(syncChosen);
  window.addEventListener(HYDRATION_EVENT, paintIcons);
  // Egg and decor dexes can load after the ready event (lazy chunks); re-read them when the pointer comes back.
  root.addEventListener('pointerenter', build);
  applyFilter();

  return () => {
    root.removeEventListener('pointerenter', build);
    stopCatalogs();
    stopSprites();
    stopBag();
    stopMine();
    window.removeEventListener(HYDRATION_EVENT, paintIcons);
    search.destroy();
    shell.destroy();
  };
}

export function openItemPicker(): void {
  if (isWindowOpen(ITEM_PICKER_WINDOW_ID)) {
    closeWindow(ITEM_PICKER_WINDOW_ID);
    return;
  }
  // Close ran the content cleanup; re-showing the hidden window would keep dead listeners.
  destroyWindow(ITEM_PICKER_WINDOW_ID);
  openWindow(ITEM_PICKER_WINDOW_ID, t('feature.keybinds.picker.title'), renderItemPicker, '420px', '80vh');
}
