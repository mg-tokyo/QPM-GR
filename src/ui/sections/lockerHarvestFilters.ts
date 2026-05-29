// src/ui/sections/lockerHarvestFilters.ts
// Harvest Filter card — Aries-style multi-dimensional filter (size/color/weather).

import { createCard } from '../panelHelpers';
import { getLockerConfig, updateLockerConfig, type LockerConfig } from '../../features/locker/index';
import type { HarvestFilterSettings, ScaleLockMode, FilterMode, WeatherFilterMode } from '../../features/locker/types';
import { areCatalogsReady, getAllMutations, getMutation } from '../../catalogs/gameCatalogs';
import { findVariantBadge } from '../../features/mutations/data/variantBadges';
import {
  ACCENT, TEXT_MUTED, UNLOCKED_BG, UNLOCKED_BORDER, LABEL_CSS,
  makeHint, makeSegmentedControl, makeDualRangeSlider,
  type SegmentOption,
} from './lockerPrimitives';
import { t } from '../../i18n';

// ── Internal helpers ─────────────────────────────────────────────────────────

function makeSingleSlider(
  min: number, max: number, value: number, label: string,
  onChange: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;padding:0 2px';
  const lbl = document.createElement('span');
  lbl.style.cssText = `color:${TEXT_MUTED}`;
  lbl.textContent = label;
  const val = document.createElement('span');
  val.style.cssText = `color:${ACCENT}`;
  val.textContent = `${value}%`;
  row.append(lbl, val);
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.step = '1';
  slider.value = String(value);
  slider.style.cssText = 'width:100%;cursor:pointer';
  slider.addEventListener('input', () => { val.textContent = `${slider.value}%`; });
  slider.addEventListener('change', () => onChange(Number(slider.value)));
  wrap.append(row, slider);
  return wrap;
}

/** Color toggle tile with accent border. */
function makeColorTile(
  label: string, dotColor: string, dotGradient: string | undefined,
  getActive: () => boolean, onToggle: () => void,
): HTMLElement {
  const active = getActive();
  const tile = document.createElement('div');
  tile.style.cssText = `padding:6px 12px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .15s,border-color .15s;border:1.5px solid ${active ? dotColor : UNLOCKED_BORDER};background:${active ? (dotGradient ?? dotColor) : UNLOCKED_BG}`;

  const dot = document.createElement('div');
  dot.style.cssText = `width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${active ? 'rgba(0,0,0,0.2)' : (dotGradient ?? dotColor)}`;

  const lbl = document.createElement('div');
  lbl.textContent = label;
  lbl.style.cssText = `font-size:11px;font-weight:600;white-space:nowrap;color:${active ? '#111' : TEXT_MUTED}`;

  tile.append(dot, lbl);

  const apply = (): void => {
    const sel = getActive();
    tile.style.borderColor = sel ? dotColor : UNLOCKED_BORDER;
    tile.style.background = sel ? (dotGradient ?? dotColor) : UNLOCKED_BG;
    dot.style.background = sel ? 'rgba(0,0,0,0.2)' : (dotGradient ?? dotColor);
    lbl.style.color = sel ? '#111' : TEXT_MUTED as string;
  };

  tile.addEventListener('mouseenter', () => { if (!getActive()) { tile.style.background = `${dotColor}18`; tile.style.borderColor = `${dotColor}55`; } });
  tile.addEventListener('mouseleave', () => { if (!getActive()) { tile.style.background = UNLOCKED_BG; tile.style.borderColor = UNLOCKED_BORDER; } });
  tile.addEventListener('click', () => { onToggle(); apply(); });

  return tile;
}

/** Weather mutation tag tile (togglable). */
function makeWeatherTagTile(
  mutId: string, getActive: () => boolean, onToggle: () => void,
): HTMLElement {
  const vb = findVariantBadge(mutId);
  const color = vb?.color ?? '#888';
  const gradient = vb?.gradient;
  const displayName = getMutation(mutId)?.name ?? mutId;
  const active = getActive();

  const tile = document.createElement('div');
  tile.title = displayName;
  tile.style.cssText = `padding:5px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:5px;transition:background .12s,border-color .12s;border:1.5px solid ${active ? color : UNLOCKED_BORDER};background:${active ? (gradient ?? color) : UNLOCKED_BG}`;

  const dot = document.createElement('div');
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${active ? 'rgba(0,0,0,0.2)' : (gradient ?? color)}`;

  const lbl = document.createElement('div');
  lbl.textContent = displayName;
  lbl.style.cssText = `font-size:10px;font-weight:600;white-space:nowrap;color:${active ? '#111' : TEXT_MUTED}`;

  tile.append(dot, lbl);

  const apply = (): void => {
    const sel = getActive();
    tile.style.borderColor = sel ? color : UNLOCKED_BORDER;
    tile.style.background = sel ? (gradient ?? color) : UNLOCKED_BG;
    dot.style.background = sel ? 'rgba(0,0,0,0.2)' : (gradient ?? color);
    lbl.style.color = sel ? '#111' : TEXT_MUTED as string;
  };

  tile.addEventListener('mouseenter', () => { if (!getActive()) { tile.style.background = `${color}18`; tile.style.borderColor = `${color}55`; } });
  tile.addEventListener('mouseleave', () => { if (!getActive()) { tile.style.background = UNLOCKED_BG; tile.style.borderColor = UNLOCKED_BORDER; } });
  tile.addEventListener('click', () => { onToggle(); apply(); });

  return tile;
}

// ── Helpers for updating the global or per-crop filter settings ──────────

function updateGlobalFilter(patch: Partial<HarvestFilterSettings>): void {
  const cur = getLockerConfig();
  updateLockerConfig({ harvestFilter: { ...cur.harvestFilter, ...patch } });
}

// ── Size section builder ─────────────────────────────────────────────────

function buildSizeSection(settings: HarvestFilterSettings, onChange: (patch: Partial<HarvestFilterSettings>) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const header = document.createElement('div');
  header.textContent = t('feature.locker.filter.size');
  header.style.cssText = LABEL_CSS + ';font-size:12px';
  wrap.appendChild(header);

  const modeOptions: SegmentOption<ScaleLockMode>[] = [
    { value: 'NONE', label: t('feature.locker.filter.sizeNone') },
    { value: 'RANGE', label: t('feature.locker.filter.sizeRange') },
    { value: 'MINIMUM', label: t('feature.locker.filter.sizeMin') },
    { value: 'MAXIMUM', label: t('feature.locker.filter.sizeMax') },
  ];

  const sliderSlot = document.createElement('div');

  function rebuildSliders(mode: ScaleLockMode): void {
    sliderSlot.innerHTML = '';
    const live = getLockerConfig().harvestFilter;
    if (mode === 'RANGE') {
      const { root } = makeDualRangeSlider(50, 100, live.minScalePct, live.maxScalePct, (low, high) => {
        onChange({ minScalePct: low, maxScalePct: high });
      });
      sliderSlot.appendChild(root);
    } else if (mode === 'MINIMUM') {
      sliderSlot.appendChild(makeSingleSlider(50, 100, live.minScalePct, t('feature.locker.filter.sizeMin'), (v) => {
        onChange({ minScalePct: v });
      }));
    } else if (mode === 'MAXIMUM') {
      sliderSlot.appendChild(makeSingleSlider(50, 100, live.maxScalePct, t('feature.locker.filter.sizeMax'), (v) => {
        onChange({ maxScalePct: v });
      }));
    }
  }

  const seg = makeSegmentedControl(modeOptions, settings.scaleLockMode, (mode) => {
    onChange({ scaleLockMode: mode });
    rebuildSliders(mode);
  });
  wrap.appendChild(seg.root);

  rebuildSliders(settings.scaleLockMode);
  wrap.appendChild(sliderSlot);

  return wrap;
}

// ── Color section builder ────────────────────────────────────────────────

function buildColorSection(settings: HarvestFilterSettings, onChange: (patch: Partial<HarvestFilterSettings>) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const header = document.createElement('div');
  header.textContent = t('feature.locker.filter.color');
  header.style.cssText = LABEL_CSS + ';font-size:12px';
  wrap.appendChild(header);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';

  const goldBadge = findVariantBadge('Gold');
  const rainbowBadge = findVariantBadge('Rainbow');

  grid.appendChild(makeColorTile(
    t('feature.locker.filter.colorGold'),
    goldBadge?.color ?? '#FFD700',
    goldBadge?.gradient,
    () => getLockerConfig().harvestFilter.colorGold,
    () => onChange({ colorGold: !getLockerConfig().harvestFilter.colorGold }),
  ));
  grid.appendChild(makeColorTile(
    t('feature.locker.filter.colorRainbow'),
    rainbowBadge?.color ?? '#ff69b4',
    rainbowBadge?.gradient ?? 'linear-gradient(135deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff,#9b59b6)',
    () => getLockerConfig().harvestFilter.colorRainbow,
    () => onChange({ colorRainbow: !getLockerConfig().harvestFilter.colorRainbow }),
  ));
  grid.appendChild(makeColorTile(
    t('feature.locker.filter.colorNormal'),
    '#aaa',
    undefined,
    () => getLockerConfig().harvestFilter.colorNormal,
    () => onChange({ colorNormal: !getLockerConfig().harvestFilter.colorNormal }),
  ));

  wrap.appendChild(grid);
  return wrap;
}

// ── Weather section builder ──────────────────────────────────────────────

function buildWeatherSection(settings: HarvestFilterSettings, onChange: (patch: Partial<HarvestFilterSettings>) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const header = document.createElement('div');
  header.textContent = t('feature.locker.filter.weather');
  header.style.cssText = LABEL_CSS + ';font-size:12px';
  wrap.appendChild(header);

  const modeOptions: SegmentOption<WeatherFilterMode>[] = [
    { value: 'ANY', label: t('feature.locker.filter.weatherAny') },
    { value: 'ALL', label: t('feature.locker.filter.weatherAll') },
    { value: 'RECIPES', label: t('feature.locker.filter.weatherRecipes') },
  ];

  const contentSlot = document.createElement('div');

  function getMutationIds(): string[] {
    if (!areCatalogsReady()) return [];
    return getAllMutations().sort();
  }

  function buildTagGrid(mode: WeatherFilterMode): void {
    contentSlot.innerHTML = '';
    const live = getLockerConfig().harvestFilter;

    if (mode === 'ANY' || mode === 'ALL') {
      const hint = document.createElement('div');
      hint.style.cssText = `font-size:10px;color:${TEXT_MUTED};padding:0 2px`;
      hint.textContent = mode === 'ANY' ? t('feature.locker.filter.weatherAnyHint') : t('feature.locker.filter.weatherAllHint');
      contentSlot.appendChild(hint);

      const tagSet = new Set(live.weatherTags);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:4px 0';
      for (const mutId of getMutationIds()) {
        grid.appendChild(makeWeatherTagTile(
          mutId,
          () => {
            const cur = getLockerConfig().harvestFilter.weatherTags;
            return cur.includes(mutId);
          },
          () => {
            const cur = getLockerConfig().harvestFilter;
            const tags = new Set(cur.weatherTags);
            if (tags.has(mutId)) tags.delete(mutId); else tags.add(mutId);
            onChange({ weatherTags: [...tags] });
          },
        ));
      }
      contentSlot.appendChild(grid);
    } else {
      // RECIPES mode
      contentSlot.appendChild(makeHint(t('feature.locker.filter.weatherRecipesHint')));
      const recipesSlot = document.createElement('div');
      recipesSlot.style.cssText = 'display:flex;flex-direction:column;gap:6px';

      function renderRecipes(): void {
        recipesSlot.innerHTML = '';
        const curRecipes = getLockerConfig().harvestFilter.weatherRecipes;

        if (curRecipes.length === 0) {
          recipesSlot.appendChild(makeHint(t('feature.locker.filter.noRecipes')));
        } else {
          for (let ri = 0; ri < curRecipes.length; ri++) {
            recipesSlot.appendChild(buildRecipeRow(curRecipes, ri, onChange, renderRecipes));
          }
        }

        // Add recipe button
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = t('feature.locker.filter.addRecipe');
        addBtn.style.cssText = `padding:4px 10px;border-radius:6px;border:1px solid rgba(143,130,255,0.4);background:rgba(143,130,255,0.1);color:#8f82ff;font-size:10px;font-weight:600;cursor:pointer;align-self:flex-start`;
        addBtn.addEventListener('click', () => {
          const cur = getLockerConfig().harvestFilter;
          onChange({ weatherRecipes: [...cur.weatherRecipes, []] });
          renderRecipes();
        });
        recipesSlot.appendChild(addBtn);
      }

      renderRecipes();
      contentSlot.appendChild(recipesSlot);
    }
  }

  const seg = makeSegmentedControl(modeOptions, settings.weatherMode, (mode) => {
    onChange({ weatherMode: mode });
    buildTagGrid(mode);
  });
  wrap.appendChild(seg.root);

  buildTagGrid(settings.weatherMode);
  wrap.appendChild(contentSlot);

  return wrap;
}

/** Build a single recipe row with tag toggles and a delete button. */
function buildRecipeRow(
  recipes: string[][],
  index: number,
  onChange: (patch: Partial<HarvestFilterSettings>) => void,
  refreshAll: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:6px;border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;

  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  const label = document.createElement('div');
  label.style.cssText = `font-size:10px;color:${TEXT_MUTED}`;
  label.textContent = `Recipe ${index + 1}`;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = '\u{1F5D1}\uFE0F';
  delBtn.title = 'Delete recipe';
  delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:0;opacity:0.6';
  delBtn.addEventListener('mouseenter', () => { delBtn.style.opacity = '1'; });
  delBtn.addEventListener('mouseleave', () => { delBtn.style.opacity = '0.6'; });
  delBtn.addEventListener('click', () => {
    const cur = getLockerConfig().harvestFilter;
    const next = cur.weatherRecipes.filter((_, i) => i !== index);
    onChange({ weatherRecipes: next });
    refreshAll();
  });
  headerRow.append(label, delBtn);
  row.appendChild(headerRow);

  const recipeTags = new Set(recipes[index]);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';

  const mutIds = areCatalogsReady() ? getAllMutations().sort() : [];
  for (const mutId of mutIds) {
    grid.appendChild(makeWeatherTagTile(
      mutId,
      () => {
        const cur = getLockerConfig().harvestFilter.weatherRecipes[index];
        return cur ? cur.includes(mutId) : false;
      },
      () => {
        const cur = getLockerConfig().harvestFilter;
        const curRecipe = [...(cur.weatherRecipes[index] ?? [])];
        const idx = curRecipe.indexOf(mutId);
        if (idx >= 0) curRecipe.splice(idx, 1); else curRecipe.push(mutId);
        const nextRecipes = [...cur.weatherRecipes];
        nextRecipes[index] = curRecipe;
        onChange({ weatherRecipes: nextRecipes });
      },
    ));
  }
  row.appendChild(grid);

  return row;
}

// ── Main export ──────────────────────────────────────────────────────────

export function buildHarvestFilterCard(config: LockerConfig): HTMLElement {
  const { root, body } = createCard(t('feature.locker.filter.title'), { collapsible: true });
  const settings = config.harvestFilter;

  // Filter mode segmented control (LOCK / ALLOW)
  const modeHeader = document.createElement('div');
  modeHeader.textContent = t('feature.locker.filter.mode');
  modeHeader.style.cssText = LABEL_CSS + ';font-size:12px';
  body.appendChild(modeHeader);

  const modeOptions: SegmentOption<FilterMode>[] = [
    { value: 'LOCK', label: t('feature.locker.filter.lock') },
    { value: 'ALLOW', label: t('feature.locker.filter.allow') },
  ];

  const modeHint = document.createElement('div');
  modeHint.style.cssText = `font-size:10px;color:${TEXT_MUTED};padding:0 2px`;
  modeHint.textContent = settings.filterMode === 'LOCK'
    ? t('feature.locker.filter.lockHint')
    : t('feature.locker.filter.allowHint');

  const modeSeg = makeSegmentedControl(modeOptions, settings.filterMode, (mode) => {
    updateGlobalFilter({ filterMode: mode });
    modeHint.textContent = mode === 'LOCK'
      ? t('feature.locker.filter.lockHint')
      : t('feature.locker.filter.allowHint');
  });
  body.appendChild(modeSeg.root);
  body.appendChild(modeHint);

  // Size section
  body.appendChild(buildSizeSection(settings, updateGlobalFilter));

  // Color section
  body.appendChild(buildColorSection(settings, updateGlobalFilter));

  // Weather section
  body.appendChild(buildWeatherSection(settings, updateGlobalFilter));

  if (!config.enabled) root.style.opacity = '0.55';
  return root;
}
