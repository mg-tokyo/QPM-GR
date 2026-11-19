import {
  areShopKeysEnabled, assignKeybind, chooseMyItem, clearKeybindAction, gameKeysForAction, isFetchFromStorageOn, listKeybindActions, myItemOf,
  onGameKeysChange, onKeybindsChange, onToolBagChange, setFetchFromStorageOn, setShopKeysEnabled, storagePanelLook, toolIdOf, toolLook, toolsInBag,
  type KeybindActionInfo, type KeybindSection,
} from '../../../features/input/keybinds';
import { t } from '../../../i18n';
import { getAllPooledPets, getTeamsConfig } from '../../../store/petTeams';
import { getActivePetInfos } from '../../../store/pets';
import { getAnySpriteDataUrl, getPetSpriteDataUrlWithMutations, onSpritesReady } from '../../../sprite-v2/compat';
import { HYDRATION_EVENT } from '../../../sprite-v2/service/constants';
import type { PooledPet } from '../../../types/petTeams';
import { letterBox } from '../../alertCentre/rowCard';
import { mountAlertSettings, type AlertLook } from '../../alertCentre/settingsShell';
import { createButton, createEmptyState, createSearchInput, createToggle } from '../../components';
import { closeWindow, destroyWindow, isWindowOpen, openWindow } from '../../core/modalWindow';
import { getHubGroups, type CardConfig } from '../../hub';
import { cardIconUrl } from '../../hub/cards/iconRenderer';
import { createIconBox, createSpriteStrip } from '../../shop/restockAlerts/cardShell';
import {
  getMyItems, myItemKey, myItemLook, myItemsInBag, onMyItemsChange, onStoragesChange, storageHolding, type SelectTarget,
} from '../../../features/input/selectItem';
import { openItemPicker } from './itemPicker';
import { cardsByKey, describeAction, KEYBINDS_SPRITE, SECTION_ORDER, sectionTitle, type LookContext, type RowIcon } from './labels';
import { createKeyRow, type KeyRow } from './rows';

export const KEYBINDS_WINDOW_ID = 'qpm-keybinds';
export { KEYBINDS_SPRITE };

const NOTE_CSS = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);line-height:1.4;';

export function keybindsSummary(list: readonly KeybindActionInfo[]): string {
  return t('feature.keybinds.summary', { count: list.length, bound: list.filter(a => a.combo).length });
}

const LOOK: AlertLook = {
  icon: () => getAnySpriteDataUrl(KEYBINDS_SPRITE) || null,
  summary: () => keybindsSummary(listKeybindActions()),
  accent: 'var(--qpm-accent)',
};

function cardOpener(card: CardConfig | undefined): (() => void) | null {
  if (!card) return null;
  if (card.tier === 'launcher') return card.onOpen;
  if (card.tier === 'expandable') return card.onDetach ?? null;
  return null;
}

function el(css: string, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderKeybindsWindow(root: HTMLElement): () => void {
  const shell = mountAlertSettings(root, t('feature.keybinds.title'), LOOK);
  const cards = cardsByKey(getHubGroups());
  let pool: PooledPet[] = [];
  const ctx: LookContext = {
    cards,
    teamName: (id) => getTeamsConfig().teams.find(team => team.id === id)?.name || null,
    storageLook: storagePanelLook,
    toolLook,
    myItemLook,
  };

  root.append(el(NOTE_CSS, t('feature.keybinds.help')));
  const search = createSearchInput({ placeholder: t('feature.keybinds.search'), onInput: () => applyFilter() });
  search.input.setAttribute('aria-label', t('feature.keybinds.search'));
  root.append(search.root);
  const empty = createEmptyState(t('feature.keybinds.noMatch'));
  empty.style.display = 'none';
  root.append(empty);

  const bodies = new Map<KeybindSection, HTMLElement>();
  const myItemsCount = el(`${NOTE_CSS}flex:1;`);
  const paintMyItems = (): void => { myItemsCount.textContent = t('feature.keybinds.myItemsCount', { count: getMyItems().length }); };
  for (const section of SECTION_ORDER) {
    const body = shell.addSection(sectionTitle(section));
    body.dataset.qpmKeybindSection = section;
    bodies.set(section, body);
    if (section === 'shops') {
      const toggle = createToggle({ size: 'compact', checked: areShopKeysEnabled(), label: t('feature.keybinds.shopKeysOn'), onChange: setShopKeysEnabled });
      body.append(toggle.root);
    }
    if (section === 'tools') {
      const toggle = createToggle({ size: 'compact', checked: isFetchFromStorageOn(), label: t('feature.keybinds.fetchFromStorage'), onChange: setFetchFromStorageOn });
      body.append(toggle.root);
    }
    if (section === 'myItems') {
      body.dataset.qpmKeybindMyItems = '';
      const line = el('display:flex;align-items:center;gap:8px;');
      line.append(myItemsCount, createButton(t('feature.keybinds.chooseItems'), { variant: 'secondary', size: 'sm', onClick: openItemPicker }));
      body.append(el(NOTE_CSS, t('feature.keybinds.myItemsNote')), line);
    }
  }
  paintMyItems();

  const elsewhere = shell.addSection(t('feature.keybinds.section.elsewhere'));
  elsewhere.append(el(NOTE_CSS, t('feature.keybinds.elsewhereNote')));
  const links = el('display:flex;gap:8px;flex-wrap:wrap;');
  for (const [key, label] of [['spectator', 'feature.keybinds.spectatorSettings'], ['controller', 'feature.keybinds.controller']] as const) {
    const open = cardOpener(cards.get(key));
    if (open) links.append(createButton(t(label), { variant: 'secondary', size: 'sm', onClick: open }));
  }
  elsewhere.append(links);

  let rows: KeyRow[] = [];
  const icons = new Map<string, RowIcon>();
  let idsKey = '';

  const teamSprites = (teamId: string): Array<{ url: string }> => {
    const slots = getTeamsConfig().teams.find(team => team.id === teamId)?.slots ?? [];
    return slots.flatMap((slotId) => {
      if (!slotId) return [];
      const pet = pool.find(p => p.id === slotId) ?? getActivePetInfos().find(p => p.slotId === slotId);
      const url = pet?.species ? getPetSpriteDataUrlWithMutations(pet.species, pet.mutations ?? []) : '';
      return url ? [{ url }] : [];
    });
  };

  const paintIcon = (row: KeyRow): void => {
    const icon = icons.get(row.actionId) ?? { kind: 'none' };
    let node: HTMLElement | null = null;
    if (icon.kind === 'sprite' || icon.kind === 'card') {
      const url = icon.kind === 'sprite' ? getAnySpriteDataUrl(icon.spriteKey) : cardIconUrl(icon.card.icon);
      if (url) node = createIconBox(url, '', 'sm');
    } else if (icon.kind === 'team') {
      const sprites = teamSprites(icon.teamId);
      if (sprites.length) node = createSpriteStrip(sprites, row.name);
    }
    const next = node ?? letterBox(row.name);
    if (row.iconSlot.firstElementChild?.isEqualNode(next)) return;
    row.iconSlot.replaceChildren(next);
  };
  const paintIcons = (): void => { for (const row of rows) paintIcon(row); };

  const paintBag = (): void => {
    const notInBag = t('feature.keybinds.row.notInBag');
    const fetchOn = isFetchFromStorageOn();
    // INP-5 D7: an item only in a storage stays full colour when the key would fetch it.
    const mark = (row: KeyRow, inBag: boolean, target: SelectTarget): void => {
      if (inBag) { row.setBagNote(null, false); return; }
      const storageId = fetchOn ? storageHolding(target) : null;
      if (!storageId) { row.setBagNote(notInBag, true); return; }
      row.setBagNote(t('feature.keybinds.row.inStorage', { storage: storagePanelLook(storageId)?.name ?? storageId }), false);
    };
    const tools = rows.flatMap((row) => { const id = toolIdOf(row.actionId); return id ? [{ row, id }] : []; });
    if (tools.length) {
      const owned = toolsInBag(tools.map(tool => tool.id));
      for (const { row, id } of tools) mark(row, owned.has(id), { kind: 'tool', id });
    }
    const mine = rows.flatMap((row) => { const item = myItemOf(row.actionId); return item ? [{ row, item }] : []; });
    if (mine.length) {
      const owned = myItemsInBag(mine.map(m => m.item));
      for (const { row, item } of mine) mark(row, owned.has(myItemKey(item)), item);
    }
  };

  const nameOf = (id: string): string => rows.find(r => r.actionId === id)?.name ?? id;
  const deps = { assign: assignKeybind, clear: (id: string) => { clearKeybindAction(id); }, nameOf };
  const removeMyItem = (id: string): void => {
    const item = myItemOf(id);
    if (item) chooseMyItem(item, false);
  };

  const applyFilter = (): void => {
    const q = search.getValue().trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const match = !q || row.name.toLowerCase().includes(q);
      row.root.style.display = match ? '' : 'none';
      if (match) shown++;
    }
    for (const [section, body] of bodies) {
      // The My items card keeps its Choose items button reachable while searching.
      if (section === 'myItems') continue;
      const card = body.parentElement;
      if (card) card.style.display = rows.some(r => r.root.parentElement === body && r.root.style.display !== 'none') ? '' : 'none';
    }
    empty.style.display = shown ? 'none' : '';
  };

  const build = (list: KeybindActionInfo[]): void => {
    for (const row of rows) { row.destroy(); row.root.remove(); }
    rows = [];
    icons.clear();
    for (const info of list) {
      const look = describeAction(info, ctx);
      icons.set(info.id, look.icon);
      const row = createKeyRow(info, look, myItemOf(info.id) ? { ...deps, remove: removeMyItem } : deps);
      bodies.get(info.section)?.append(row.root);
      rows.push(row);
    }
    paintIcons();
  };

  const refresh = (): void => {
    const list = listKeybindActions();
    const nextKey = list.map(a => a.id).join('|');
    if (nextKey !== idsKey) {
      idsKey = nextKey;
      build(list);
    } else {
      for (const info of list) rows.find(r => r.actionId === info.id)?.paint(info);
    }
    for (const info of list) rows.find(r => r.actionId === info.id)?.setGameKeys(gameKeysForAction(info));
    const shopsOn = areShopKeysEnabled();
    for (const row of rows) if (row.actionId.startsWith('shop:')) row.setEnabled(shopsOn);
    paintBag();
    applyFilter();
    shell.refresh();
  };

  refresh();
  const offKeys = onKeybindsChange(refresh);
  const offGameKeys = onGameKeysChange(refresh);
  const offBag = onToolBagChange(paintBag);
  const offStorages = onStoragesChange(paintBag);
  const offMyItems = onMyItemsChange(paintMyItems);
  const offSprites = onSpritesReady(paintIcons);
  window.addEventListener(HYDRATION_EVENT, paintIcons);
  let alive = true;
  getAllPooledPets().then((pets) => { if (alive) { pool = pets; paintIcons(); } }).catch(() => { /* team rows keep letter boxes */ });

  return () => {
    alive = false;
    offKeys();
    offGameKeys();
    offBag();
    offStorages();
    offMyItems();
    offSprites();
    window.removeEventListener(HYDRATION_EVENT, paintIcons);
    for (const row of rows) row.destroy();
    search.destroy();
    shell.destroy();
  };
}

export function openKeybindsWindow(): void {
  if (isWindowOpen(KEYBINDS_WINDOW_ID)) {
    closeWindow(KEYBINDS_WINDOW_ID);
    return;
  }
  // Close ran the content cleanup; re-showing the hidden window would keep dead subscriptions.
  destroyWindow(KEYBINDS_WINDOW_ID);
  openWindow(KEYBINDS_WINDOW_ID, t('feature.keybinds.title'), renderKeybindsWindow, '440px', '80vh');
}
