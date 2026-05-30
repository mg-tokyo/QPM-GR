// src/ui/locker/lockerPrimitives.ts
// Shared style tokens, sprite resolvers, DOM helpers, and rarity logic for Locker UI.

import { getLockerConfig, updateLockerConfig } from '../../features/locker/index';
import { getPlantSpecies, getMutation } from '../../catalogs/gameCatalogs';
import { getCropSpriteDataUrl, getAnySpriteDataUrl } from '../../sprite-v2/compat';
import { RARITY_COLORS, RARITY_ORDER } from '../shop/restockWindowConstants';
import { findVariantBadge } from '../../features/mutations/data/variantBadges';
import { getGardenSnapshot } from '../../features/garden/bridge';
import { getInventoryItems } from '../../store/inventory';
import { t } from '../../i18n';

// ── Constants ───────────────────────────────────────────────────────────────

export const TILE_SIZE = 56;
export const SPRITE_SIZE = 36;

// ── Style tokens ────────────────────────────────────────────────────────────

export const LOCKED_BG = 'rgba(143,130,255,0.12)';
export const LOCKED_BORDER = 'rgba(143,130,255,0.6)';
export const UNLOCKED_BG = 'rgba(255,255,255,0.03)';
export const UNLOCKED_BORDER = 'rgba(255,255,255,0.08)';
export const HOVER_BG = 'rgba(143,130,255,0.06)';
export const HOVER_BORDER = 'rgba(143,130,255,0.25)';
export const ACCENT = 'var(--qpm-accent,#8f82ff)';
export const TEXT_MUTED = 'var(--qpm-text-muted,rgba(232,224,255,0.6))';

export const LABEL_CSS = 'font-size:13px;font-weight:600;color:var(--qpm-text,#fff);';
export const MUTED_CSS = 'font-size:11px;color:var(--qpm-text-muted,rgba(232,224,255,0.6));line-height:1.4;';
export const TOGGLE_ROW_CSS = `display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG};cursor:pointer`;
export const CHECKBOX_CSS = `width:18px;height:18px;cursor:pointer;accent-color:${ACCENT}`;

// ── Sprite resolution ───────────────────────────────────────────────────────

export function resolveEggSprite(eggId: string): string {
  return getCropSpriteDataUrl(eggId) || getAnySpriteDataUrl(`egg/${eggId}`) || getAnySpriteDataUrl(eggId) || '';
}

export function resolveDecorSprite(decorId: string): string {
  return getAnySpriteDataUrl(`decor/${decorId}`) || getAnySpriteDataUrl(decorId) || '';
}

export function getPlantRarity(species: string): string {
  const entry = getPlantSpecies(species);
  if (!entry?.seed) return 'common';
  const raw = (entry.seed as Record<string, unknown>).rarity;
  return typeof raw === 'string' ? raw.toLowerCase() : 'common';
}

// ── Eligible species/mutations from garden + inventory ──────────────────────

export interface EligibleData {
  species: Set<string>;
  mutations: Set<string>;
  eggs: Set<string>;
  decor: Set<string>;
}

export function getEligibleData(): EligibleData {
  const species = new Set<string>();
  const mutations = new Set<string>();
  const eggs = new Set<string>();
  const decor = new Set<string>();

  const snapshot = getGardenSnapshot();
  const tileGroups = [snapshot?.tileObjects, snapshot?.boardwalkTileObjects];
  for (const tiles of tileGroups) {
    if (!tiles || typeof tiles !== 'object') continue;
    for (const tile of Object.values(tiles)) {
      const t = tile as Record<string, unknown>;
      const objType = t.objectType;

      if (objType === 'plant' && Array.isArray(t.slots)) {
        for (const slot of t.slots) {
          const s = slot as Record<string, unknown>;
          if (typeof s.species === 'string' && s.species.length > 0) {
            species.add(s.species);
          }
          if (Array.isArray(s.mutations)) {
            for (const m of s.mutations) {
              if (typeof m === 'string' && m.length > 0) mutations.add(m);
            }
          }
        }
      } else if (objType === 'egg') {
        const eggId = t.eggId ?? t.eggType ?? t.species;
        if (typeof eggId === 'string' && eggId.length > 0) eggs.add(eggId);
      } else if (objType === 'decor') {
        const decorId = t.decorId ?? t.species;
        if (typeof decorId === 'string' && decorId.length > 0) decor.add(decorId as string);
      }
    }
  }

  try {
    for (const item of getInventoryItems()) {
      const raw = item.raw as Record<string, unknown> | null;
      if (typeof item.species === 'string' && item.species.length > 0) {
        species.add(item.species);
      }
      if (item.itemType === 'egg' || (raw && typeof raw.eggId === 'string')) {
        const eggId = (raw?.eggId ?? raw?.eggType ?? item.id) as string;
        if (eggId) eggs.add(eggId);
      }
      if (item.itemType === 'decor' || (raw && typeof raw.decorId === 'string')) {
        const decorId = (raw?.decorId ?? item.id) as string;
        if (decorId) decor.add(decorId);
      }
    }
  } catch { /* inventory store may not be running yet */ }

  return { species, mutations, eggs, decor };
}

// ── Primitive DOM helpers ───────────────────────────────────────────────────

export function makeToggleRow(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.style.cssText = TOGGLE_ROW_CSS;
  const text = document.createElement('div');
  text.style.cssText = LABEL_CSS;
  text.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.style.cssText = CHECKBOX_CSS;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(text, input);
  return row;
}

export function makeBlockAllCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 0';
  row.addEventListener('click', (e) => e.stopPropagation());
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.style.cssText = `width:14px;height:14px;cursor:pointer;accent-color:${ACCENT}`;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.style.cssText = `font-size:11px;color:${TEXT_MUTED}`;
  text.textContent = label;
  row.append(input, text);
  return row;
}

export function makeHint(text: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = MUTED_CSS + ';padding:4px 2px 0';
  el.textContent = text;
  return el;
}

export function makeGrid(): HTMLElement {
  const g = document.createElement('div');
  g.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:4px 0;justify-content:center';
  return g;
}

export function makeShowAllToggle(onChange: (showAll: boolean) => void): HTMLElement {
  let showAll = false;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = t('feature.locker.showAll');
  btn.style.cssText = `background:none;border:none;color:${TEXT_MUTED};font-size:10px;cursor:pointer;padding:0;text-decoration:underline;text-align:left;display:block`;
  btn.addEventListener('click', () => {
    showAll = !showAll;
    btn.textContent = showAll ? t('feature.locker.showEligible') : t('feature.locker.showAll');
    onChange(showAll);
  });
  return btn;
}

// ── Lock tile (in-place toggle) ─────────────────────────────────────────────

export function makeLockTile(
  label: string,
  spriteUrl: string,
  initialLocked: boolean,
  onToggle: (locked: boolean) => void,
): HTMLElement {
  let locked = initialLocked;

  const tile = document.createElement('div');
  tile.title = label;
  tile.style.cssText = `min-width:${TILE_SIZE}px;min-height:${TILE_SIZE + 18}px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px 4px;border-radius:8px;cursor:pointer;transition:background .12s,border-color .12s;border:1.5px solid ${locked ? LOCKED_BORDER : UNLOCKED_BORDER};background:${locked ? LOCKED_BG : UNLOCKED_BG}`;

  const spriteWrap = document.createElement('div');
  spriteWrap.style.cssText = `position:relative;width:${SPRITE_SIZE}px;height:${SPRITE_SIZE}px;flex-shrink:0`;

  if (spriteUrl) {
    const img = document.createElement('img');
    img.alt = label;
    img.src = spriteUrl;
    img.style.cssText = `width:${SPRITE_SIZE}px;height:${SPRITE_SIZE}px;image-rendering:pixelated;object-fit:contain`;
    spriteWrap.appendChild(img);
  } else {
    const fb = document.createElement('div');
    fb.textContent = label.slice(0, 3).toUpperCase();
    fb.style.cssText = `width:${SPRITE_SIZE}px;height:${SPRITE_SIZE}px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${TEXT_MUTED};background:rgba(255,255,255,0.06);border-radius:4px`;
    spriteWrap.appendChild(fb);
  }

  const badge = document.createElement('div');
  badge.textContent = locked ? '\u{1F512}' : '\u{1F513}';
  badge.style.cssText = 'position:absolute;top:0;right:-4px;font-size:13px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7))';
  spriteWrap.appendChild(badge);

  const name = document.createElement('div');
  name.textContent = label;
  name.style.cssText = `font-size:9px;text-align:center;line-height:1.2;white-space:nowrap;color:${locked ? ACCENT : TEXT_MUTED}`;

  tile.append(spriteWrap, name);

  const applyState = (): void => {
    tile.style.borderColor = locked ? LOCKED_BORDER : UNLOCKED_BORDER;
    tile.style.background = locked ? LOCKED_BG : UNLOCKED_BG;
    badge.textContent = locked ? '\u{1F512}' : '\u{1F513}';
    name.style.color = locked ? ACCENT : TEXT_MUTED as string;
  };

  tile.addEventListener('mouseenter', () => { if (!locked) { tile.style.background = HOVER_BG; tile.style.borderColor = HOVER_BORDER; } });
  tile.addEventListener('mouseleave', () => { if (!locked) { tile.style.background = UNLOCKED_BG; tile.style.borderColor = UNLOCKED_BORDER; } });
  tile.addEventListener('click', () => { locked = !locked; onToggle(locked); applyState(); });

  return tile;
}

// ── Mutation tile (unified — dedup fix #4) ──────────────────────────────────

export function makeMutationTile(
  mutId: string,
  getActive: () => boolean,
  onToggle: () => void,
): HTMLElement {
  const vb = findVariantBadge(mutId);
  const color = vb?.color ?? '#888';
  const gradient = vb?.gradient;
  const displayName = getMutation(mutId)?.name ?? mutId;
  const active = getActive();

  const tile = document.createElement('div');
  tile.title = displayName;
  tile.style.cssText = `padding:6px 10px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .15s,border-color .15s,color .15s;border:1.5px solid ${active ? color : UNLOCKED_BORDER};background:${active ? (gradient ?? color) : UNLOCKED_BG}`;

  const dot = document.createElement('div');
  dot.style.cssText = `width:10px;height:10px;border-radius:50%;flex-shrink:0;transition:background .15s;background:${active ? 'rgba(0,0,0,0.2)' : (gradient ?? color)}`;

  const label = document.createElement('div');
  label.textContent = displayName;
  label.style.cssText = `font-size:11px;font-weight:600;white-space:nowrap;transition:color .15s;color:${active ? '#111' : TEXT_MUTED}`;

  tile.append(dot, label);

  const applyState = (): void => {
    const sel = getActive();
    tile.style.borderColor = sel ? color : UNLOCKED_BORDER;
    tile.style.background = sel ? (gradient ?? color) : UNLOCKED_BG;
    dot.style.background = sel ? 'rgba(0,0,0,0.2)' : (gradient ?? color);
    label.style.color = sel ? '#111' : TEXT_MUTED as string;
  };

  tile.addEventListener('mouseenter', () => { if (!getActive()) { tile.style.background = `${color}18`; tile.style.borderColor = `${color}55`; } });
  tile.addEventListener('mouseleave', () => { if (!getActive()) { tile.style.background = UNLOCKED_BG; tile.style.borderColor = UNLOCKED_BORDER; } });
  tile.addEventListener('click', () => { onToggle(); applyState(); });

  return tile;
}

// ── Accent tile (non-mutation toggle, QPM-themed) ────────────────────────────

const ACCENT_RAW = '#8f82ff';

export function makeAccentTile(
  displayName: string,
  getActive: () => boolean,
  onToggle: () => void,
): HTMLElement {
  const color = ACCENT_RAW;
  const active = getActive();

  const tile = document.createElement('div');
  tile.title = displayName;
  tile.style.cssText = `padding:6px 10px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .15s,border-color .15s,color .15s;border:1.5px solid ${active ? color : UNLOCKED_BORDER};background:${active ? color : UNLOCKED_BG}`;

  const dot = document.createElement('div');
  dot.style.cssText = `width:10px;height:10px;border-radius:50%;flex-shrink:0;transition:background .15s;background:${active ? 'rgba(0,0,0,0.2)' : color}`;

  const label = document.createElement('div');
  label.textContent = displayName;
  label.style.cssText = `font-size:11px;font-weight:600;white-space:nowrap;transition:color .15s;color:${active ? '#111' : TEXT_MUTED}`;

  tile.append(dot, label);

  const applyState = (): void => {
    const sel = getActive();
    tile.style.borderColor = sel ? color : UNLOCKED_BORDER;
    tile.style.background = sel ? color : UNLOCKED_BG;
    dot.style.background = sel ? 'rgba(0,0,0,0.2)' : color;
    label.style.color = sel ? '#111' : TEXT_MUTED as string;
  };

  tile.addEventListener('mouseenter', () => { if (!getActive()) { tile.style.background = `${color}18`; tile.style.borderColor = `${color}55`; } });
  tile.addEventListener('mouseleave', () => { if (!getActive()) { tile.style.background = UNLOCKED_BG; tile.style.borderColor = UNLOCKED_BORDER; } });
  tile.addEventListener('click', () => { onToggle(); applyState(); });

  return tile;
}

// ── Rarity helpers ──────────────────────────────────────────────────────────

export function makeRarityGroup(rarity: string, tiles: HTMLElement[]): HTMLElement {
  const color = RARITY_COLORS[rarity] ?? RARITY_COLORS.common ?? '#E7E7E7';
  const wrap = document.createElement('div');
  wrap.style.cssText = `border-radius:8px;padding:6px 8px;border:1px solid ${color}25;background:${color}08`;

  const header = document.createElement('div');
  header.textContent = rarity;
  header.style.cssText = `font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${color};padding:0 2px 4px;text-align:center`;

  const grid = makeGrid();
  for (const t of tiles) grid.appendChild(t);

  wrap.append(header, grid);
  return wrap;
}

/** Iterate species grouped by rarity in RARITY_ORDER, then remaining. Dedup fix #3. */
export function forEachRarityGroup(
  speciesList: string[],
  callback: (rarity: string, species: string[]) => void,
): void {
  const groups = new Map<string, string[]>();
  for (const sp of speciesList) {
    const r = getPlantRarity(sp);
    const list = groups.get(r);
    if (list) list.push(sp);
    else groups.set(r, [sp]);
  }
  for (const rarity of RARITY_ORDER) {
    const list = groups.get(rarity);
    if (list?.length) callback(rarity, list);
  }
  for (const [rarity, list] of groups) {
    if (!RARITY_ORDER.includes(rarity as typeof RARITY_ORDER[number]) && list.length) callback(rarity, list);
  }
}

// ── Segmented control ─────────────────────────────────────────────────────

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function makeSegmentedControl<T extends string>(
  options: SegmentOption<T>[],
  selected: T,
  onChange: (value: T) => void,
): { root: HTMLElement; setSelected: (value: T) => void } {
  const root = document.createElement('div');
  root.style.cssText = `display:flex;border-radius:8px;overflow:hidden;border:1px solid ${UNLOCKED_BORDER}`;

  let current = selected;
  const buttons = new Map<T, HTMLButtonElement>();

  const applyState = (): void => {
    for (const [val, btn] of buttons) {
      const active = val === current;
      btn.style.background = active ? ACCENT_RAW : 'transparent';
      btn.style.color = active ? '#fff' : TEXT_MUTED as string;
      btn.style.fontWeight = active ? '700' : '500';
    }
  };

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = opt.label;
    btn.style.cssText = `flex:1;padding:6px 4px;border:none;font-size:11px;cursor:pointer;transition:background .12s,color .12s;background:transparent;color:${TEXT_MUTED}`;
    btn.addEventListener('click', () => {
      if (opt.value === current) return;
      current = opt.value;
      applyState();
      onChange(opt.value);
    });
    buttons.set(opt.value, btn);
    root.appendChild(btn);
  }

  applyState();

  const setSelected = (value: T): void => { current = value; applyState(); };
  return { root, setSelected };
}

// ── Dual range slider ─────────────────────────────────────────────────────

export function makeDualRangeSlider(
  min: number,
  max: number,
  valueLow: number,
  valueHigh: number,
  onChange: (low: number, high: number) => void,
): { root: HTMLElement; setValues: (low: number, high: number) => void } {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:4px';

  let curLow = valueLow;
  let curHigh = valueHigh;

  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;padding:0 2px';
  const lowLabel = document.createElement('span');
  lowLabel.style.cssText = `color:${ACCENT}`;
  const highLabel = document.createElement('span');
  highLabel.style.cssText = `color:${ACCENT}`;
  labelRow.append(lowLabel, highLabel);

  const updateLabels = (): void => {
    lowLabel.textContent = `Min: ${curLow}%`;
    highLabel.textContent = `Max: ${curHigh}%`;
  };

  const sliderLow = document.createElement('input');
  sliderLow.type = 'range';
  sliderLow.min = String(min);
  sliderLow.max = String(max);
  sliderLow.step = '1';
  sliderLow.value = String(curLow);
  sliderLow.style.cssText = 'width:100%;cursor:pointer';

  const sliderHigh = document.createElement('input');
  sliderHigh.type = 'range';
  sliderHigh.min = String(min);
  sliderHigh.max = String(max);
  sliderHigh.step = '1';
  sliderHigh.value = String(curHigh);
  sliderHigh.style.cssText = 'width:100%;cursor:pointer';

  sliderLow.addEventListener('input', () => {
    let val = Number(sliderLow.value);
    if (val >= curHigh) val = curHigh - 1;
    curLow = Math.max(min, val);
    sliderLow.value = String(curLow);
    updateLabels();
  });
  sliderLow.addEventListener('change', () => onChange(curLow, curHigh));

  sliderHigh.addEventListener('input', () => {
    let val = Number(sliderHigh.value);
    if (val <= curLow) val = curLow + 1;
    curHigh = Math.min(max, val);
    sliderHigh.value = String(curHigh);
    updateLabels();
  });
  sliderHigh.addEventListener('change', () => onChange(curLow, curHigh));

  updateLabels();
  root.append(labelRow, sliderLow, sliderHigh);

  const setValues = (low: number, high: number): void => {
    curLow = low;
    curHigh = high;
    sliderLow.value = String(low);
    sliderHigh.value = String(high);
    updateLabels();
  };

  return { root, setValues };
}

/** Build a rarity-grouped grid of lock tiles for plant species. */
export function buildRarityGrid(
  speciesList: string[],
  locks: Record<string, boolean>,
  lockKey: 'plantLocks' | 'cropSellLocks',
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  forEachRarityGroup(speciesList, (rarity, list) => {
    const tiles = list.sort().map(sp => {
      const locked = locks[sp] === true;
      const spriteUrl = getCropSpriteDataUrl(sp);
      return makeLockTile(sp, spriteUrl, locked, (next) => {
        const cur = getLockerConfig();
        const curLocks = { ...cur[lockKey], [sp]: next };
        if (!next) delete curLocks[sp];
        updateLockerConfig({ [lockKey]: curLocks });
      });
    });
    container.appendChild(makeRarityGroup(rarity, tiles));
  });

  return container;
}
