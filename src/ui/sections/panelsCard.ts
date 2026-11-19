// The Config card shared by Storage panels and Shop panels (plan S6: same controls for both): on/off, a tile per
// panel to pick, a layout preview, Reset and the two key rows. Each feature supplies a spec; the look is one.
import { onKeybindsChange } from '../../features/input/keybinds';
import { t } from '../../i18n';
import { getAnySpriteDataUrl, onSpritesReady } from '../../sprite-v2/compat';
import { addStyle } from '../../utils/dom/dom';
import { createButton, createSectionHeader, createToggle } from '../components';
import type { CardIcon, ExpandableCardConfig } from '../hub/cards/types';
import { formatKeybind } from '../pets/petsWindow/helpers';
import { createPanelKeys, readActionCombo, type KeyRowSpec } from './multiStorageKeys';
import { muted, toggleDetachedSection, type SectionHandle } from './sectionLayout';

export interface PanelChoice {
  id: string;
  title: string;
  spriteKey: string | null;
  picked: boolean;
  /** The tile's second line; null shows none. */
  value: string | null;
  /** The second line in the muted colour (a status) instead of gold (a value). */
  valueMuted?: boolean;
}

export interface PanelsPreview {
  aspect: number;
  cells: ReadonlyArray<{ storageId: string; x: number; y: number; w: number; h: number }>;
  saved: number;
}

/** i18n keys; the layout and key-row strings are shared and not part of the spec. */
export interface PanelsCardText {
  title: string;
  caption: string;
  listTitle: string;
  listHelp: string;
  lastPicked: string;
  empty: string;
  summaryOne: string;
  summaryMany: string;
}

export interface PanelsCardSpec {
  key: string;
  /** Data attribute stem: `mstore` gives `data-mstore-tile`, `data-mstore-cell`, `data-mstore-key`. */
  attr: string;
  detachId: string;
  icon: CardIcon;
  text: PanelsCardText;
  keyRows: readonly KeyRowSpec[];
  toggleActionId: string;
  isEnabled(): boolean;
  setEnabled(on: boolean): void;
  choices(): PanelChoice[];
  /** False when the press would leave nothing picked. */
  toggle(id: string): boolean;
  preview(): PanelsPreview;
  reset(): void;
  onChange(cb: () => void): () => void;
  /** How many panels the key opens, for the summary line. */
  summaryCount(choices: readonly PanelChoice[]): number;
  /** Runs before each paint of the open card (the shop card reads shop settings here, plan U3). */
  beforeRender?(): void;
}

const CSS = `
.qpm-mstore__tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(76px,1fr)); gap:6px; }
.qpm-mstore__tile { display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 4px; border-radius:8px;
  border:1px solid var(--qpm-border); background:var(--qpm-surface-2); color:var(--qpm-text-muted); font-family:var(--qpm-font);
  font-size:var(--qpm-font-caption); cursor:pointer; transition:background 0.15s, color 0.15s, border-color 0.15s; }
.qpm-mstore__tile:hover { background:var(--qpm-surface-3); color:var(--qpm-text); }
.qpm-mstore__tile--on { background:var(--qpm-accent-tint); border-color:var(--qpm-accent); color:var(--qpm-text); }
.qpm-mstore__tile:disabled { cursor:not-allowed; opacity:0.5; }
.qpm-mstore__art { width:40px; height:40px; object-fit:contain; opacity:0.45; transition:opacity 0.15s; }
.qpm-mstore__tile--on .qpm-mstore__art { opacity:1; }
.qpm-mstore__name { text-align:center; line-height:1.2; }
.qpm-mstore__value { color:var(--qpm-gold); font-weight:var(--qpm-weight-semibold); }
.qpm-mstore__value--muted { color:var(--qpm-text-muted); font-weight:var(--qpm-weight-normal); }
.qpm-mstore__screen { position:relative; width:100%; max-width:320px; background:var(--qpm-surface-1); border:1px solid var(--qpm-border);
  border-radius:8px; overflow:hidden; }
.qpm-mstore__cell { position:absolute; box-sizing:border-box; display:flex; align-items:flex-end; justify-content:center; padding-bottom:4px;
  border:1px solid var(--qpm-accent-border); border-radius:4px; background:var(--qpm-accent-subtle); }
.qpm-mstore__cell img { width:24px; height:24px; object-fit:contain; }
`;
let styled = false;

function ensureStyles(): void {
  if (styled) return;
  styled = true;
  addStyle(CSS);
}

function spriteImg(spriteKey: string | null, className: string): HTMLImageElement | null {
  const url = spriteKey ? getAnySpriteDataUrl(spriteKey) : '';
  if (!url) return null;
  const img = document.createElement('img');
  img.className = className;
  img.src = url;
  img.alt = '';
  return img;
}

const dataKey = (attr: string, part: string): string => `${attr}${part}`;

interface TileView { tile: HTMLButtonElement; art: HTMLImageElement | null; value: HTMLSpanElement; spriteKey: string | null }

function buildTile(choice: PanelChoice, attr: string, onPress: () => void): TileView {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'qpm-mstore__tile';
  tile.dataset[dataKey(attr, 'Tile')] = choice.id;
  const name = document.createElement('span');
  name.className = 'qpm-mstore__name';
  name.textContent = choice.title;
  const value = document.createElement('span');
  value.className = 'qpm-mstore__value';
  tile.append(name, value);
  tile.addEventListener('click', onPress);
  return { tile, art: null, value, spriteKey: null };
}

/** In place, so a press never lands on a tile that a value update replaced between mouse down and up. */
function paintTile(view: TileView, choice: PanelChoice, enabled: boolean): void {
  view.tile.classList.toggle('qpm-mstore__tile--on', choice.picked);
  view.tile.setAttribute('aria-pressed', String(choice.picked));
  view.tile.disabled = !enabled;
  view.value.textContent = choice.value ?? '';
  view.value.style.display = choice.value ? '' : 'none';
  view.value.classList.toggle('qpm-mstore__value--muted', choice.valueMuted === true);
  // A shop's icon can change once its weather is known; a storage's never does.
  if (view.art && view.spriteKey !== choice.spriteKey) {
    view.art.remove();
    view.art = null;
  }
  if (!view.art) {
    view.art = spriteImg(choice.spriteKey, 'qpm-mstore__art');
    view.spriteKey = view.art ? choice.spriteKey : null;
    if (view.art) view.tile.prepend(view.art);
  }
}

function paintScreen(screen: HTMLElement, attr: string, preview: PanelsPreview, choices: readonly PanelChoice[]): void {
  screen.style.aspectRatio = String(preview.aspect);
  const cells = preview.cells.map((cell) => {
    const el = document.createElement('div');
    el.className = 'qpm-mstore__cell';
    el.dataset[dataKey(attr, 'Cell')] = cell.storageId;
    el.style.left = `${cell.x * 100}%`;
    el.style.top = `${cell.y * 100}%`;
    el.style.width = `${cell.w * 100}%`;
    el.style.height = `${cell.h * 100}%`;
    const choice = choices.find(c => c.id === cell.storageId);
    el.title = choice?.title ?? cell.storageId;
    const img = spriteImg(choice?.spriteKey ?? null, '');
    if (img) el.appendChild(img);
    return el;
  });
  screen.replaceChildren(...cells);
}

/** Every control follows the stored settings, so a key press in game, Reset or a second open copy update it in place. */
export function createPanelsSection(spec: PanelsCardSpec): SectionHandle {
  ensureStyles();
  const root = document.createElement('div');
  root.dataset.qpmSection = spec.key;
  root.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

  const enable = createToggle({ checked: spec.isEnabled(), label: t('common.enabled'), onChange: on => spec.setEnabled(on) });

  const tiles = document.createElement('div');
  tiles.className = 'qpm-mstore__tiles';
  const pickNote = muted('');
  const pickBlock = document.createElement('div');
  pickBlock.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  pickBlock.append(createSectionHeader(t(spec.text.listTitle), { size: 'compact' }).root, muted(t(spec.text.listHelp)), tiles, pickNote);

  const screen = document.createElement('div');
  screen.className = 'qpm-mstore__screen';
  const savedLine = muted('');
  const resetBtn = createButton(t('feature.multiStorage.card.resetLayout'), { size: 'sm', onClick: () => { spec.reset(); } });
  const resetRow = document.createElement('div');
  resetRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
  resetRow.append(resetBtn, savedLine);
  const layoutBlock = document.createElement('div');
  layoutBlock.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  layoutBlock.append(createSectionHeader(t('feature.multiStorage.card.layoutTitle'), { size: 'compact' }).root, muted(t('feature.multiStorage.card.layoutHelp')), screen, resetRow);

  const keys = createPanelKeys(spec.keyRows, spec.attr);
  root.append(enable.root, pickBlock, layoutBlock, keys.root);

  const views = new Map<string, TileView>();
  let tileIds: string | null = null;
  let screenSig = '';
  const press = (id: string): void => {
    const ok = spec.toggle(id);
    pickNote.textContent = ok ? '' : t(spec.text.lastPicked);
    pickNote.style.color = ok ? '' : 'var(--qpm-warning)';
  };

  const render = (): void => {
    spec.beforeRender?.();
    const enabled = spec.isEnabled();
    enable.setChecked(enabled);
    keys.setEnabled(enabled);
    resetBtn.disabled = !enabled;
    const choices = spec.choices();
    const ids = choices.map(c => c.id).join('|');
    if (ids !== tileIds) {
      tileIds = ids;
      views.clear();
      tiles.replaceChildren(...choices.map((choice) => {
        const view = buildTile(choice, spec.attr, () => { press(choice.id); });
        views.set(choice.id, view);
        return view.tile;
      }));
      pickNote.textContent = choices.length === 0 ? t(spec.text.empty) : '';
      pickNote.style.color = '';
    }
    for (const choice of choices) {
      const view = views.get(choice.id);
      if (view) paintTile(view, choice, enabled);
    }
    const preview = spec.preview();
    const sig = JSON.stringify([preview, choices.map(c => c.spriteKey)]);
    if (sig !== screenSig) {
      screenSig = sig;
      paintScreen(screen, spec.attr, preview, choices);
      savedLine.textContent = t('feature.multiStorage.card.savedCount', { count: preview.saved, total: preview.cells.length });
    }
  };
  render();
  const offs = [spec.onChange(render), onSpritesReady(() => { screenSig = ''; render(); })];
  return {
    root,
    destroy: () => {
      for (const off of offs) off();
      keys.destroy();
    },
  };
}

function summaryText(spec: PanelsCardSpec): string {
  if (!spec.isEnabled()) return t('common.disabled');
  const combo = readActionCombo(spec.toggleActionId);
  if (!combo) return t('feature.multiStorage.card.summaryNoKey');
  const count = spec.summaryCount(spec.choices());
  return t(count === 1 ? spec.text.summaryOne : spec.text.summaryMany, { key: formatKeybind(combo), count });
}

export function createPanelsCard(spec: PanelsCardSpec): ExpandableCardConfig {
  const create = (): SectionHandle => createPanelsSection(spec);
  return {
    key: spec.key,
    label: t(spec.text.title),
    description: t(spec.text.caption),
    icon: spec.icon,
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);margin-top:2px;';
      const paint = (): void => {
        const text = summaryText(spec);
        if (el.textContent !== text) el.textContent = text;
      };
      paint();
      const offs = [spec.onChange(paint), onKeybindsChange(paint)];
      return () => { for (const off of offs) off(); };
    },
    renderExpanded: (container) => {
      const section = create();
      container.appendChild(section.root);
      return section.destroy;
    },
    detachWindowId: spec.detachId,
    onDetach: () => { toggleDetachedSection(spec.detachId, t(spec.text.title), create, `${spec.key}Detach`); },
  };
}
