// src/ui/locker/lockerCropOverrides.ts
// Overrides tab — split-pane layout with species list (left) and filter editor (right).

import { getLockerConfig, updateLockerConfig, type LockerConfig } from '../../features/locker/index';
import type { HarvestFilterSettings, CropOverride } from '../../features/locker/types';
import { areCatalogsReady, getAllPlantSpecies, getPlantSpecies } from '../../catalogs/gameCatalogs';
import { getCropSpriteDataUrl } from '../../sprite-v2/compat';
import {
  ACCENT, TEXT_MUTED, UNLOCKED_BG, UNLOCKED_BORDER,
  makeHint, makeToggleRow, forEachRarityGroup,
  type EligibleData,
} from './lockerPrimitives';
import {
  buildFilterModeControl,
  buildSizeSection,
  buildColorSection,
  buildWeatherSection,
} from './lockerFilterBuilder';
import { t } from '../../i18n';

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_OVERRIDE_SETTINGS: HarvestFilterSettings = {
  filterMode: 'LOCK', scaleLockMode: 'NONE',
  minScalePct: 50, maxScalePct: 100,
  colorGold: false, colorRainbow: false, colorNormal: false,
  weatherMode: 'ANY', weatherTags: [], weatherRecipes: [],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function updateOverride(species: string, patch: Partial<HarvestFilterSettings>): void {
  const cur = getLockerConfig();
  const existing = cur.cropOverrides[species];
  if (!existing) return;
  const next = { ...cur.cropOverrides, [species]: { ...existing, settings: { ...existing.settings, ...patch } } };
  updateLockerConfig({ cropOverrides: next });
}

function getOverrideSettings(species: string): HarvestFilterSettings {
  const cur = getLockerConfig().cropOverrides[species];
  return cur?.settings ?? getLockerConfig().harvestFilter;
}

// ── Species list item ──────────────────────────────────────────────────────

function buildSpeciesItem(
  species: string,
  isSelected: boolean,
  onSelect: () => void,
): HTMLElement {
  const displayName = getPlantSpecies(species)?.crop?.name ?? species;

  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;' +
    `border-radius:var(--qpm-radius-sm,4px);transition:background .12s;` +
    `background:${isSelected ? 'var(--qpm-accent-subtle,rgba(143,130,255,0.15))' : 'transparent'}`;

  // Override status dot
  const overrides = getLockerConfig().cropOverrides;
  const overrideEntry = overrides[species];
  const hasOverride = !!overrideEntry;
  const isEnabled = hasOverride && overrideEntry.enabled;

  const dot = document.createElement('div');
  dot.style.cssText =
    `width:8px;height:8px;border-radius:50%;flex-shrink:0;` +
    `background:${isEnabled ? 'var(--qpm-positive,#22c55e)' : hasOverride ? 'var(--qpm-danger,#ef4444)' : 'var(--qpm-text-muted,#555)'}`;
  dot.title = isEnabled ? 'Override active' : hasOverride ? 'Override disabled' : 'No override';

  // Sprite
  const spriteUrl = getCropSpriteDataUrl(species);
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.alt = displayName;
    img.style.cssText = 'width:24px;height:24px;image-rendering:pixelated;object-fit:contain;flex-shrink:0';
    row.appendChild(img);
  }

  const name = document.createElement('div');
  name.textContent = displayName;
  name.style.cssText = `font-size:11px;color:${isSelected ? 'var(--qpm-accent,#8f82ff)' : 'var(--qpm-text,#eef0ff)'};font-weight:${isSelected ? '600' : '400'};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;

  row.append(dot, name);

  row.addEventListener('mouseenter', () => { if (!isSelected) row.style.background = 'var(--qpm-surface-3,rgba(255,255,255,0.05))'; });
  row.addEventListener('mouseleave', () => { if (!isSelected) row.style.background = 'transparent'; });
  row.addEventListener('click', onSelect);

  return row;
}

// ── Detail pane (right side) ──────────────────────────────────────────────

function buildDetailPane(species: string, onConfigChange: () => void): HTMLElement {
  const displayName = getPlantSpecies(species)?.crop?.name ?? species;

  const pane = document.createElement('div');
  pane.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:1;min-width:0;overflow-y:auto';

  // Header with species name and sprite
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px';

  const spriteUrl = getCropSpriteDataUrl(species);
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.alt = displayName;
    img.style.cssText = 'width:32px;height:32px;image-rendering:pixelated;object-fit:contain;flex-shrink:0';
    header.appendChild(img);
  }

  const title = document.createElement('div');
  title.textContent = displayName;
  title.style.cssText = 'font-size:14px;color:var(--qpm-text,#eef0ff);font-weight:600;flex:1';
  header.appendChild(title);
  pane.appendChild(header);

  // Enable toggle
  const override = getLockerConfig().cropOverrides[species];
  const isEnabled = !!override?.enabled;

  pane.appendChild(makeToggleRow(
    t('feature.locker.filter.enableOverride'),
    isEnabled,
    (enabled) => {
      const cur = getLockerConfig();
      const nextOverrides = { ...cur.cropOverrides };
      if (enabled) {
        nextOverrides[species] = { enabled: true, settings: { ...DEFAULT_OVERRIDE_SETTINGS } };
      } else {
        delete nextOverrides[species];
      }
      updateLockerConfig({ cropOverrides: nextOverrides });
      onConfigChange();
    },
  ));

  // Filter editor — visible only while the override is active
  if (override?.enabled) {
    const settings = override.settings;
    const doChange = (patch: Partial<HarvestFilterSettings>): void => updateOverride(species, patch);
    const getLive = (): HarvestFilterSettings => getOverrideSettings(species);

    const editorWrap = document.createElement('div');
    editorWrap.style.cssText = `display:flex;flex-direction:column;gap:8px;padding:8px;border-radius:var(--qpm-radius-md,8px);border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;

    editorWrap.appendChild(buildFilterModeControl(settings, doChange));
    editorWrap.appendChild(buildSizeSection(settings, doChange, getLive));
    editorWrap.appendChild(buildColorSection(settings, doChange, getLive));
    editorWrap.appendChild(buildWeatherSection(settings, doChange, getLive));

    pane.appendChild(editorWrap);
  }

  return pane;
}

// ── Main export ─────────────────────────────────────────────────────────────

export function buildOverridesTabContent(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  panel.appendChild(makeHint(t('feature.locker.filter.overridesHint')));

  // Show All toggle — default to full catalog so the overrides picker feels catalog-driven
  let showAll = true;

  const splitPane = document.createElement('div');
  splitPane.style.cssText = 'display:flex;gap:8px;min-height:300px';

  // Left pane: species list
  const leftPane = document.createElement('div');
  leftPane.style.cssText = `width:180px;flex-shrink:0;display:flex;flex-direction:column;gap:2px;overflow-y:auto;max-height:420px;padding:4px;border-radius:var(--qpm-radius-md,8px);border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;

  // Right pane: detail editor
  const rightPane = document.createElement('div');
  rightPane.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column';

  let selectedSpecies: string | null = null;

  function getFilteredSpecies(): string[] {
    if (!areCatalogsReady()) return [];
    const all = getAllPlantSpecies();
    return showAll ? all : all.filter(sp => eligible.species.has(sp));
  }

  function rebuildList(): void {
    leftPane.innerHTML = '';
    const species = getFilteredSpecies();

    if (species.length === 0) {
      leftPane.appendChild(makeHint(areCatalogsReady() ? t('feature.locker.noPlantsInGarden') : t('feature.locker.plantCatalogNotLoaded')));
      return;
    }

    forEachRarityGroup(species, (rarity, list) => {
      const groupLabel = document.createElement('div');
      groupLabel.textContent = rarity;
      groupLabel.style.cssText = `font-size:9px;color:var(--qpm-text-muted,${TEXT_MUTED});text-transform:uppercase;letter-spacing:0.5px;padding:6px 4px 2px;font-weight:600`;
      leftPane.appendChild(groupLabel);

      for (const sp of list.sort()) {
        leftPane.appendChild(buildSpeciesItem(sp, sp === selectedSpecies, () => {
          selectedSpecies = sp;
          rebuildList();
          rebuildDetail();
        }));
      }
    });
  }

  function rebuildDetail(): void {
    rightPane.innerHTML = '';
    if (!selectedSpecies) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = `display:flex;align-items:center;justify-content:center;height:100%;color:var(--qpm-text-muted,${TEXT_MUTED});font-size:12px;font-style:italic`;
      placeholder.textContent = t('feature.locker.filter.selectCrop');
      rightPane.appendChild(placeholder);
      return;
    }
    rightPane.appendChild(buildDetailPane(selectedSpecies, () => {
      rebuildList();
      rebuildDetail();
    }));
  }

  // Show All toggle above the split pane
  const showAllRow = document.createElement('label');
  showAllRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--qpm-text-muted,#97a0c0)';
  const showAllCb = document.createElement('input');
  showAllCb.type = 'checkbox';
  showAllCb.checked = showAll;
  showAllCb.style.cssText = `width:14px;height:14px;cursor:pointer;accent-color:var(--qpm-accent,${ACCENT})`;
  showAllCb.addEventListener('change', () => {
    showAll = showAllCb.checked;
    rebuildList();
  });
  const showAllLabel = document.createElement('span');
  showAllLabel.textContent = t('feature.locker.showAll');
  showAllRow.append(showAllCb, showAllLabel);
  panel.appendChild(showAllRow);

  rebuildList();
  rebuildDetail();

  splitPane.append(leftPane, rightPane);
  panel.appendChild(splitPane);

  return panel;
}
