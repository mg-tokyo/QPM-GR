// src/ui/locker/lockerCropOverrides.ts
// Per-species crop override card for the Locker harvest filters.

import { createCard } from '../core/panelHelpers';
import { getLockerConfig, updateLockerConfig, type LockerConfig } from '../../features/locker/index';
import type {
  HarvestFilterSettings, CropOverride,
  ScaleLockMode, FilterMode, WeatherFilterMode,
} from '../../features/locker/types';
import { areCatalogsReady, getAllPlantSpecies, getAllMutations, getMutation } from '../../catalogs/gameCatalogs';
import { getCropSpriteDataUrl } from '../../sprite-v2/compat';
import { findVariantBadge } from '../../features/mutations/data/variantBadges';
import {
  ACCENT, TEXT_MUTED, UNLOCKED_BG, UNLOCKED_BORDER,
  makeHint, makeShowAllToggle, makeSegmentedControl, makeDualRangeSlider,
  makeLockTile, makeRarityGroup, forEachRarityGroup,
  type EligibleData, type SegmentOption,
} from './lockerPrimitives';
import { t } from '../../i18n';

// ── Internal helpers ─────────────────────────────────────────────────────────

function updateOverride(species: string, patch: Partial<HarvestFilterSettings>): void {
  const cur = getLockerConfig();
  const existing = cur.cropOverrides[species];
  if (!existing) return;
  const next = { ...cur.cropOverrides, [species]: { ...existing, settings: { ...existing.settings, ...patch } } };
  updateLockerConfig({ cropOverrides: next });
}

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

// ── Per-override inline filter editor ────────────────────────────────────

function buildOverrideFilterEditor(species: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:6px 0 0';

  const doChange = (patch: Partial<HarvestFilterSettings>): void => updateOverride(species, patch);

  const getSettings = (): HarvestFilterSettings => {
    const cur = getLockerConfig().cropOverrides[species];
    return cur?.settings ?? getLockerConfig().harvestFilter;
  };

  // Mode
  const modeOptions: SegmentOption<FilterMode>[] = [
    { value: 'LOCK', label: t('feature.locker.filter.lock') },
    { value: 'ALLOW', label: t('feature.locker.filter.allow') },
  ];
  const modeSeg = makeSegmentedControl(modeOptions, getSettings().filterMode, (mode) => doChange({ filterMode: mode }));
  wrap.appendChild(modeSeg.root);

  // Size
  const sizeWrap = document.createElement('div');
  sizeWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  const sizeLabel = document.createElement('div');
  sizeLabel.textContent = t('feature.locker.filter.size');
  sizeLabel.style.cssText = `font-size:11px;color:${TEXT_MUTED}`;
  sizeWrap.appendChild(sizeLabel);

  const sizeSliderSlot = document.createElement('div');
  const sizeOptions: SegmentOption<ScaleLockMode>[] = [
    { value: 'NONE', label: t('feature.locker.filter.sizeNone') },
    { value: 'RANGE', label: t('feature.locker.filter.sizeRange') },
    { value: 'MINIMUM', label: t('feature.locker.filter.sizeMin') },
    { value: 'MAXIMUM', label: t('feature.locker.filter.sizeMax') },
  ];

  function rebuildSizeSliders(mode: ScaleLockMode): void {
    sizeSliderSlot.innerHTML = '';
    const s = getSettings();
    if (mode === 'RANGE') {
      const { root } = makeDualRangeSlider(50, 100, s.minScalePct, s.maxScalePct, (low, high) => doChange({ minScalePct: low, maxScalePct: high }));
      sizeSliderSlot.appendChild(root);
    } else if (mode === 'MINIMUM') {
      sizeSliderSlot.appendChild(makeSingleSlider(50, 100, s.minScalePct, t('feature.locker.filter.sizeMin'), (v) => doChange({ minScalePct: v })));
    } else if (mode === 'MAXIMUM') {
      sizeSliderSlot.appendChild(makeSingleSlider(50, 100, s.maxScalePct, t('feature.locker.filter.sizeMax'), (v) => doChange({ maxScalePct: v })));
    }
  }

  const sizeSeg = makeSegmentedControl(sizeOptions, getSettings().scaleLockMode, (mode) => {
    doChange({ scaleLockMode: mode });
    rebuildSizeSliders(mode);
  });
  sizeWrap.appendChild(sizeSeg.root);
  rebuildSizeSliders(getSettings().scaleLockMode);
  sizeWrap.appendChild(sizeSliderSlot);
  wrap.appendChild(sizeWrap);

  // Color
  const colorLabel = document.createElement('div');
  colorLabel.textContent = t('feature.locker.filter.color');
  colorLabel.style.cssText = `font-size:11px;color:${TEXT_MUTED}`;
  wrap.appendChild(colorLabel);

  const colorGrid = document.createElement('div');
  colorGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';

  const goldBadge = findVariantBadge('Gold');
  const rainbowBadge = findVariantBadge('Rainbow');

  colorGrid.appendChild(makeColorTile(
    t('feature.locker.filter.colorGold'),
    goldBadge?.color ?? '#FFD700', goldBadge?.gradient,
    () => getLockerConfig().cropOverrides[species]?.settings.colorGold ?? false,
    () => doChange({ colorGold: !(getLockerConfig().cropOverrides[species]?.settings.colorGold ?? false) }),
  ));
  colorGrid.appendChild(makeColorTile(
    t('feature.locker.filter.colorRainbow'),
    rainbowBadge?.color ?? '#ff69b4',
    rainbowBadge?.gradient ?? 'linear-gradient(135deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff,#9b59b6)',
    () => getLockerConfig().cropOverrides[species]?.settings.colorRainbow ?? false,
    () => doChange({ colorRainbow: !(getLockerConfig().cropOverrides[species]?.settings.colorRainbow ?? false) }),
  ));
  colorGrid.appendChild(makeColorTile(
    t('feature.locker.filter.colorNormal'),
    '#aaa', undefined,
    () => getLockerConfig().cropOverrides[species]?.settings.colorNormal ?? false,
    () => doChange({ colorNormal: !(getLockerConfig().cropOverrides[species]?.settings.colorNormal ?? false) }),
  ));
  wrap.appendChild(colorGrid);

  // Weather (simplified: ANY/ALL tag grid, no inline RECIPES for overrides to keep it compact)
  const weatherLabel = document.createElement('div');
  weatherLabel.textContent = t('feature.locker.filter.weather');
  weatherLabel.style.cssText = `font-size:11px;color:${TEXT_MUTED}`;
  wrap.appendChild(weatherLabel);

  const weatherContentSlot = document.createElement('div');

  const weatherModeOptions: SegmentOption<WeatherFilterMode>[] = [
    { value: 'ANY', label: t('feature.locker.filter.weatherAny') },
    { value: 'ALL', label: t('feature.locker.filter.weatherAll') },
    { value: 'RECIPES', label: t('feature.locker.filter.weatherRecipes') },
  ];

  function rebuildWeather(mode: WeatherFilterMode): void {
    weatherContentSlot.innerHTML = '';
    const mutIds = areCatalogsReady() ? getAllMutations().sort() : [];

    if (mode === 'ANY' || mode === 'ALL') {
      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:2px 0';
      for (const mutId of mutIds) {
        grid.appendChild(makeWeatherTagTile(
          mutId,
          () => {
            const cur = getLockerConfig().cropOverrides[species]?.settings.weatherTags ?? [];
            return cur.includes(mutId);
          },
          () => {
            const cur = getLockerConfig().cropOverrides[species]?.settings;
            if (!cur) return;
            const tags = new Set(cur.weatherTags);
            if (tags.has(mutId)) tags.delete(mutId); else tags.add(mutId);
            doChange({ weatherTags: [...tags] });
          },
        ));
      }
      weatherContentSlot.appendChild(grid);
    } else {
      // RECIPES mode for overrides
      weatherContentSlot.appendChild(makeHint(t('feature.locker.filter.weatherRecipesHint')));
      const recipesSlot = document.createElement('div');
      recipesSlot.style.cssText = 'display:flex;flex-direction:column;gap:4px';

      function renderRecipes(): void {
        recipesSlot.innerHTML = '';
        const curRecipes = getLockerConfig().cropOverrides[species]?.settings.weatherRecipes ?? [];
        if (curRecipes.length === 0) {
          recipesSlot.appendChild(makeHint(t('feature.locker.filter.noRecipes')));
        } else {
          for (let ri = 0; ri < curRecipes.length; ri++) {
            recipesSlot.appendChild(buildOverrideRecipeRow(species, ri, doChange, renderRecipes));
          }
        }
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = t('feature.locker.filter.addRecipe');
        addBtn.style.cssText = `padding:3px 8px;border-radius:4px;border:1px solid rgba(143,130,255,0.4);background:rgba(143,130,255,0.1);color:#8f82ff;font-size:9px;cursor:pointer;align-self:flex-start`;
        addBtn.addEventListener('click', () => {
          const cur = getLockerConfig().cropOverrides[species]?.settings;
          if (!cur) return;
          doChange({ weatherRecipes: [...cur.weatherRecipes, []] });
          renderRecipes();
        });
        recipesSlot.appendChild(addBtn);
      }
      renderRecipes();
      weatherContentSlot.appendChild(recipesSlot);
    }
  }

  const weatherSeg = makeSegmentedControl(weatherModeOptions, getSettings().weatherMode, (mode) => {
    doChange({ weatherMode: mode });
    rebuildWeather(mode);
  });
  wrap.appendChild(weatherSeg.root);
  rebuildWeather(getSettings().weatherMode);
  wrap.appendChild(weatherContentSlot);

  return wrap;
}

function buildOverrideRecipeRow(
  species: string, index: number,
  onChange: (patch: Partial<HarvestFilterSettings>) => void,
  refreshAll: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `display:flex;flex-direction:column;gap:3px;padding:4px 6px;border-radius:4px;border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;

  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  const label = document.createElement('div');
  label.style.cssText = `font-size:9px;color:${TEXT_MUTED}`;
  label.textContent = `Recipe ${index + 1}`;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = '\u{1F5D1}\uFE0F';
  delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;padding:0;opacity:0.6';
  delBtn.addEventListener('click', () => {
    const cur = getLockerConfig().cropOverrides[species]?.settings;
    if (!cur) return;
    onChange({ weatherRecipes: cur.weatherRecipes.filter((_, i) => i !== index) });
    refreshAll();
  });
  headerRow.append(label, delBtn);
  row.appendChild(headerRow);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px';
  const mutIds = areCatalogsReady() ? getAllMutations().sort() : [];
  for (const mutId of mutIds) {
    grid.appendChild(makeWeatherTagTile(
      mutId,
      () => {
        const cur = getLockerConfig().cropOverrides[species]?.settings.weatherRecipes[index];
        return cur ? cur.includes(mutId) : false;
      },
      () => {
        const cur = getLockerConfig().cropOverrides[species]?.settings;
        if (!cur) return;
        const recipe = [...(cur.weatherRecipes[index] ?? [])];
        const idx = recipe.indexOf(mutId);
        if (idx >= 0) recipe.splice(idx, 1); else recipe.push(mutId);
        const next = [...cur.weatherRecipes];
        next[index] = recipe;
        onChange({ weatherRecipes: next });
      },
    ));
  }
  row.appendChild(grid);
  return row;
}

// ── Override row rendering ───────────────────────────────────────────────

function buildOverrideRow(
  species: string,
  override: CropOverride,
  onDelete: () => void,
  onRebuild: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;

  // Header: sprite + name + enable toggle + delete
  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;align-items:center;gap:8px';

  const spriteUrl = getCropSpriteDataUrl(species);
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.alt = species;
    img.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;object-fit:contain;flex-shrink:0';
    headerRow.appendChild(img);
  }

  const name = document.createElement('div');
  name.textContent = species;
  name.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff);font-weight:600;flex:1;min-width:0';
  headerRow.appendChild(name);

  // Enable toggle
  const enableCb = document.createElement('input');
  enableCb.type = 'checkbox';
  enableCb.checked = override.enabled;
  enableCb.style.cssText = `width:16px;height:16px;cursor:pointer;accent-color:${ACCENT};flex-shrink:0`;
  enableCb.title = 'Enable override';
  enableCb.addEventListener('click', (e) => e.stopPropagation());
  enableCb.addEventListener('change', () => {
    const cur = getLockerConfig();
    const existing = cur.cropOverrides[species];
    if (!existing) return;
    const next: Record<string, CropOverride> = { ...cur.cropOverrides, [species]: { ...existing, enabled: enableCb.checked } };
    updateLockerConfig({ cropOverrides: next });
  });
  headerRow.appendChild(enableCb);

  // Delete
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = '\u{1F5D1}\uFE0F';
  delBtn.title = 'Remove override';
  delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:0 2px;opacity:0.6;flex-shrink:0';
  delBtn.addEventListener('mouseenter', () => { delBtn.style.opacity = '1'; });
  delBtn.addEventListener('mouseleave', () => { delBtn.style.opacity = '0.6'; });
  delBtn.addEventListener('click', onDelete);
  headerRow.appendChild(delBtn);
  row.appendChild(headerRow);

  // Expandable filter editor
  let expanded = false;
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = t('feature.locker.filter.editFilters');
  editBtn.style.cssText = `background:none;border:none;color:${ACCENT};font-size:10px;cursor:pointer;padding:0;text-decoration:underline;align-self:flex-start`;

  const editorSlot = document.createElement('div');
  editorSlot.style.display = 'none';

  editBtn.addEventListener('click', () => {
    expanded = !expanded;
    if (expanded) {
      editorSlot.innerHTML = '';
      editorSlot.appendChild(buildOverrideFilterEditor(species));
      editorSlot.style.display = 'block';
      editBtn.textContent = '\u25B2 Collapse';
    } else {
      editorSlot.style.display = 'none';
      editBtn.textContent = t('feature.locker.filter.editFilters');
    }
  });

  row.append(editBtn, editorSlot);
  return row;
}

// ── Main export ──────────────────────────────────────────────────────────

export function buildCropOverridesCard(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const { root, body } = createCard(t('feature.locker.filter.overrides'), { collapsible: true, startCollapsed: true });
  body.appendChild(makeHint(t('feature.locker.filter.overridesHint')));

  // Show All toggle for grid
  let currentShowAll = false;
  const showAllBtn = makeShowAllToggle((showAll) => {
    currentShowAll = showAll;
    rebuildOverrideGrid(showAll);
  });
  body.appendChild(showAllBtn);

  const gridSlot = document.createElement('div');
  const editorsSlot = document.createElement('div');
  editorsSlot.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px';

  function rebuildEditors(): void {
    editorsSlot.innerHTML = '';
    const cur = getLockerConfig();
    const overrideKeys = Object.keys(cur.cropOverrides).sort();
    for (const sp of overrideKeys) {
      const overrideEntry = cur.cropOverrides[sp];
      if (!overrideEntry) continue;
      editorsSlot.appendChild(buildOverrideRow(sp, overrideEntry, () => {
        const live = getLockerConfig();
        const next = { ...live.cropOverrides };
        delete next[sp];
        updateLockerConfig({ cropOverrides: next });
        rebuildOverrideGrid(currentShowAll);
        rebuildEditors();
      }, rebuildEditors));
    }
  }

  function rebuildOverrideGrid(showAll: boolean): void {
    gridSlot.innerHTML = '';
    if (!areCatalogsReady()) {
      gridSlot.appendChild(makeHint(t('feature.locker.plantCatalogNotLoaded')));
      return;
    }
    const all = getAllPlantSpecies();
    const filtered = showAll ? all : all.filter(sp => eligible.species.has(sp));
    if (filtered.length === 0) {
      gridSlot.appendChild(makeHint(t('feature.locker.noPlantsInGarden')));
      return;
    }

    const overrides = getLockerConfig().cropOverrides;
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    forEachRarityGroup(filtered, (rarity, list) => {
      const tiles = list.sort().map(sp => {
        const hasOverride = !!overrides[sp];
        const spriteUrl = getCropSpriteDataUrl(sp);
        return makeLockTile(sp, spriteUrl, hasOverride, (next) => {
          const cur = getLockerConfig();
          if (next) {
            const defaultSettings: HarvestFilterSettings = {
              filterMode: 'LOCK', scaleLockMode: 'NONE',
              minScalePct: 50, maxScalePct: 100,
              colorGold: false, colorRainbow: false, colorNormal: false,
              weatherMode: 'ANY', weatherTags: [], weatherRecipes: [],
            };
            updateLockerConfig({ cropOverrides: { ...cur.cropOverrides, [sp]: { enabled: true, settings: defaultSettings } } });
          } else {
            const nextOverrides = { ...cur.cropOverrides };
            delete nextOverrides[sp];
            updateLockerConfig({ cropOverrides: nextOverrides });
          }
          rebuildEditors();
        });
      });
      container.appendChild(makeRarityGroup(rarity, tiles));
    });
    gridSlot.appendChild(container);
  }

  rebuildOverrideGrid(false);
  body.appendChild(gridSlot);

  rebuildEditors();
  body.appendChild(editorsSlot);

  if (!config.enabled) root.style.opacity = '0.55';
  return root;
}
