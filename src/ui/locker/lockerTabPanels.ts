// src/ui/locker/lockerTabPanels.ts
// Panel builders for the 3-tab Locker UI: General, Overrides, Restrictions.

import { createCard } from '../components/card';
import { getLockerConfig, updateLockerConfig, type LockerConfig } from '../../features/locker/index';
import {
  areCatalogsReady, getEggCatalog, getAllPlantSpecies,
  getAllDecor, getDecor, getAllMutations,
} from '../../catalogs/gameCatalogs';
import {
  getSellAllPetsSettings, setSellAllPetsProtectionRules, SELL_ALL_PET_RARITY_OPTIONS,
} from '../../features/pets/sellAll';
import {
  UNLOCKED_BG, UNLOCKED_BORDER, ACCENT, TEXT_MUTED, LABEL_CSS,
  type EligibleData,
  resolveEggSprite, resolveDecorSprite,
  makeToggleRow, makeBlockAllCheckbox, makeShowAllToggle, makeHint, makeGrid,
  makeLockTile, makeMutationTile, buildRarityGrid, sortMutations,
} from './lockerPrimitives';
import { buildGeneralTabContent } from './lockerHarvestFilters';
import { buildOverridesTabContent } from './lockerCropOverrides';
import { createInventoryCapacitySection } from '../economy/inventoryCapacitySection';
import { t } from '../../i18n';
import { log } from '../../utils/logger';

// ── General Panel ──────────────────────────────────────────────────────────

export function buildGeneralPanel(config: LockerConfig): HTMLElement {
  return buildGeneralTabContent(config);
}

// ── Overrides Panel ────────────────────────────────────────────────────────

export function buildOverridesPanel(config: LockerConfig, eligible: EligibleData): HTMLElement {
  return buildOverridesTabContent(config, eligible);
}

// ── Restrictions Panel ─────────────────────────────────────────────────────

export function buildRestrictionsPanel(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  // 1. Quick Plant Locks
  panel.appendChild(buildQuickPlantLocksCard(config, eligible));

  // 2. Egg Locks
  panel.appendChild(buildEggLocksCard(config, eligible));

  // 3. Decor Locks
  panel.appendChild(buildDecorLocksCard(config, eligible));

  // 4. Sell Protection
  panel.appendChild(buildSellProtectionCard(config, eligible));

  // 5. Inventory Reserve
  panel.appendChild(buildInventoryReserveCard(config));

  // 6. Inventory Capacity
  try {
    panel.appendChild(createInventoryCapacitySection());
  } catch (err) {
    log('[Locker] Failed to load Inventory Capacity', err);
  }

  return panel;
}

// ── Quick Plant Locks ──────────────────────────────────────────────────────

function buildQuickPlantLocksCard(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const blockAllCb = makeBlockAllCheckbox(t('feature.locker.blockAll'), config.harvestLock, (v) => {
    updateLockerConfig({ harvestLock: v });
  });

  const { root, body } = createCard({
    title: t('feature.locker.filter.quickLocks'),
    collapsible: true,
    collapsed: true,
  });
  // Inject blockAll into header area (before indicator arrow so arrow stays far-right)
  const headerRow = root.querySelector('div') as HTMLElement;
  if (headerRow) {
    const indicator = headerRow.querySelector('span');
    if (indicator) headerRow.insertBefore(blockAllCb, indicator);
    else headerRow.appendChild(blockAllCb);
  }

  body.appendChild(makeHint(t('feature.locker.filter.quickLocksHint')));

  const showAllBtn = makeShowAllToggle((showAll) => rebuildPlantGrid(showAll), true);
  body.appendChild(showAllBtn);

  const plantGridSlot = document.createElement('div');

  function rebuildPlantGrid(showAll: boolean): void {
    plantGridSlot.innerHTML = '';
    if (!areCatalogsReady()) {
      plantGridSlot.appendChild(makeHint(t('feature.locker.plantCatalogNotLoaded')));
      return;
    }
    const all = getAllPlantSpecies();
    const filtered = showAll ? all : all.filter(sp => eligible.species.has(sp));
    if (filtered.length > 0) {
      plantGridSlot.appendChild(buildRarityGrid(filtered, getLockerConfig().plantLocks, 'plantLocks'));
    } else {
      plantGridSlot.appendChild(makeHint(t('feature.locker.noPlantsInGarden')));
    }
  }

  rebuildPlantGrid(true);
  body.appendChild(plantGridSlot);

  // Mutations sub-section
  if (areCatalogsReady()) {
    const mutations = getAllMutations();
    if (mutations.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:var(--qpm-border,rgba(255,255,255,0.08));margin:4px 0';
      body.appendChild(divider);

      const mutHeader = document.createElement('div');
      mutHeader.textContent = t('feature.locker.mutations');
      mutHeader.style.cssText = LABEL_CSS + ';font-size:12px;padding:2px 0 2px';
      body.appendChild(mutHeader);

      body.appendChild(makeHint(t('feature.locker.blockHarvestMutations')));

      const mutGrid = makeGrid();
      for (const mutId of sortMutations(mutations)) {
        mutGrid.appendChild(makeMutationTile(
          mutId,
          () => getLockerConfig().mutationLocks[mutId] === true,
          () => {
            const cur = getLockerConfig();
            const next = !cur.mutationLocks[mutId];
            const locks = { ...cur.mutationLocks, [mutId]: next };
            if (!next) delete locks[mutId];
            updateLockerConfig({ mutationLocks: locks });
          },
        ));
      }
      body.appendChild(mutGrid);
    }
  }

  if (!config.enabled) root.style.opacity = '0.55';
  return root;
}

// ── Egg Locks ──────────────────────────────────────────────────────────────

function buildEggLocksCard(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const blockAllCb = makeBlockAllCheckbox(t('feature.locker.blockAll'), config.hatchLock, (v) => {
    updateLockerConfig({ hatchLock: v });
  });

  const { root, body } = createCard({
    title: t('feature.locker.eggLocker'),
    collapsible: true,
    collapsed: true,
  });
  const headerRow = root.querySelector('div') as HTMLElement;
  if (headerRow) {
    const indicator = headerRow.querySelector('span');
    if (indicator) headerRow.insertBefore(blockAllCb, indicator);
    else headerRow.appendChild(blockAllCb);
  }

  const showAllBtn = makeShowAllToggle((showAll) => rebuildEggGrid(showAll));
  body.appendChild(showAllBtn);

  const eggGridSlot = document.createElement('div');

  function rebuildEggGrid(showAll: boolean): void {
    eggGridSlot.innerHTML = '';
    if (!areCatalogsReady()) {
      eggGridSlot.appendChild(makeHint(t('feature.locker.eggCatalogNotLoaded')));
      return;
    }
    const catalog = getEggCatalog();
    if (!catalog || Object.keys(catalog).length === 0) {
      eggGridSlot.appendChild(makeHint(t('feature.locker.noEggsInCatalog')));
      return;
    }
    const allIds = Object.keys(catalog).sort();
    const filtered = showAll ? allIds : allIds.filter(id => eligible.eggs.has(id));
    if (filtered.length === 0) {
      eggGridSlot.appendChild(makeHint(t('feature.locker.noEggsInGarden')));
      return;
    }
    const liveEggLocks = getLockerConfig().eggLocks;
    const grid = makeGrid();
    for (const eggId of filtered) {
      const entry = catalog[eggId];
      grid.appendChild(makeLockTile(entry?.name ?? eggId, resolveEggSprite(eggId), liveEggLocks[eggId] === true, (next) => {
        const cur = getLockerConfig();
        const locks = { ...cur.eggLocks, [eggId]: next };
        if (!next) delete locks[eggId];
        updateLockerConfig({ eggLocks: locks });
      }));
    }
    eggGridSlot.appendChild(grid);
  }

  rebuildEggGrid(false);
  body.appendChild(eggGridSlot);

  if (!config.enabled) root.style.opacity = '0.55';
  return root;
}

// ── Decor Locks ────────────────────────────────────────────────────────────

function buildDecorLocksCard(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const blockAllCb = makeBlockAllCheckbox(t('feature.locker.blockAll'), config.decorPickupLock, (v) => {
    updateLockerConfig({ decorPickupLock: v });
  });

  const { root, body } = createCard({
    title: t('feature.locker.decorLocker'),
    collapsible: true,
    collapsed: true,
  });
  const headerRow = root.querySelector('div') as HTMLElement;
  if (headerRow) {
    const indicator = headerRow.querySelector('span');
    if (indicator) headerRow.insertBefore(blockAllCb, indicator);
    else headerRow.appendChild(blockAllCb);
  }

  const showAllBtn = makeShowAllToggle((showAll) => rebuildDecorGrid(showAll));
  body.appendChild(showAllBtn);

  const decorGridSlot = document.createElement('div');

  function rebuildDecorGrid(showAll: boolean): void {
    decorGridSlot.innerHTML = '';
    if (!areCatalogsReady()) {
      decorGridSlot.appendChild(makeHint(t('feature.locker.decorCatalogNotLoaded')));
      return;
    }
    const allIds = getAllDecor();
    if (allIds.length === 0) {
      decorGridSlot.appendChild(makeHint(t('feature.locker.noDecorInCatalog')));
      return;
    }
    const sorted = allIds.sort();
    const filtered = showAll ? sorted : sorted.filter(id => eligible.decor.has(id));
    if (filtered.length === 0) {
      decorGridSlot.appendChild(makeHint(t('feature.locker.noDecorInGarden')));
      return;
    }
    const liveDecorLocks = getLockerConfig().decorLocks;
    const grid = makeGrid();
    for (const id of filtered) {
      const entry = getDecor(id);
      grid.appendChild(makeLockTile(entry?.name ?? id, resolveDecorSprite(id), liveDecorLocks[id] === true, (next) => {
        const cur = getLockerConfig();
        const locks = { ...cur.decorLocks, [id]: next };
        if (!next) delete locks[id];
        updateLockerConfig({ decorLocks: locks });
      }));
    }
    decorGridSlot.appendChild(grid);
  }

  rebuildDecorGrid(false);
  body.appendChild(decorGridSlot);

  if (!config.enabled) root.style.opacity = '0.55';
  return root;
}

// ── Sell Protection ────────────────────────────────────────────────────────

function buildSellProtectionCard(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const { root, body } = createCard({
    title: t('feature.locker.sellProtection'),
    collapsible: true,
    collapsed: true,
  });

  // Crop Sell sub-section
  const cropBlockAllCb = makeBlockAllCheckbox(t('feature.locker.blockAll'), config.sellAllCropsLock, (v) => {
    updateLockerConfig({ sellAllCropsLock: v });
  });
  const cropHeader = document.createElement('div');
  cropHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
  const cropLabel = document.createElement('div');
  cropLabel.textContent = t('feature.locker.cropSellProtection');
  cropLabel.style.cssText = LABEL_CSS + ';font-size:12px';
  cropHeader.append(cropLabel, cropBlockAllCb);
  body.appendChild(cropHeader);

  const cropShowAllBtn = makeShowAllToggle((showAll) => rebuildCropSellGrid(showAll), true);
  body.appendChild(cropShowAllBtn);
  body.appendChild(makeHint(t('feature.locker.cropSellHint')));

  const cropSellGridSlot = document.createElement('div');

  function rebuildCropSellGrid(showAll: boolean): void {
    cropSellGridSlot.innerHTML = '';
    if (!areCatalogsReady()) {
      cropSellGridSlot.appendChild(makeHint(t('feature.locker.plantCatalogNotLoaded')));
      return;
    }
    const all = getAllPlantSpecies();
    const filtered = showAll ? all : all.filter(sp => eligible.species.has(sp));
    if (filtered.length > 0) {
      cropSellGridSlot.appendChild(buildRarityGrid(filtered, getLockerConfig().cropSellLocks, 'cropSellLocks'));
    } else {
      cropSellGridSlot.appendChild(makeHint(t('feature.locker.noPlantsInGarden')));
    }
  }

  rebuildCropSellGrid(true);
  body.appendChild(cropSellGridSlot);

  // Divider
  const divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:var(--qpm-border,rgba(255,255,255,0.08));margin:8px 0';
  body.appendChild(divider);

  // Pet Sell Guard
  body.appendChild(makeToggleRow(t('feature.locker.holdSellProtection'), config.petSellGuard, (v) => {
    updateLockerConfig({ petSellGuard: v });
  }));
  body.appendChild(makeHint(t('feature.locker.holdSellHint')));

  // Sell All Pets Protections
  const divider2 = document.createElement('div');
  divider2.style.cssText = 'height:1px;background:var(--qpm-border,rgba(255,255,255,0.08));margin:8px 0';
  body.appendChild(divider2);
  body.appendChild(buildSellAllPetsSection());

  if (!config.enabled) root.style.opacity = '0.55';
  return root;
}

// ── Sell All Pets sub-section ──────────────────────────────────────────────

function buildSellAllPetsSection(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const header = document.createElement('div');
  header.textContent = t('feature.locker.sellAllPets');
  header.style.cssText = LABEL_CSS + ';font-size:12px';
  wrap.appendChild(header);

  const rules = getSellAllPetsSettings().protections;

  wrap.appendChild(makeToggleRow(t('feature.locker.enableProtections'), rules.enabled, (v) => { setSellAllPetsProtectionRules({ enabled: v }); }));
  wrap.appendChild(makeToggleRow(t('feature.locker.protectGold'), rules.protectGold, (v) => { setSellAllPetsProtectionRules({ protectGold: v }); }));
  wrap.appendChild(makeToggleRow(t('feature.locker.protectRainbow'), rules.protectRainbow, (v) => { setSellAllPetsProtectionRules({ protectRainbow: v }); }));
  wrap.appendChild(makeToggleRow(t('feature.locker.protectMaxStr'), rules.protectMaxStr, (v) => { setSellAllPetsProtectionRules({ protectMaxStr: v }); }));

  // STR threshold slider
  const strWrap = document.createElement('div');
  strWrap.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:var(--qpm-radius-md,8px);border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;
  const strHeader = document.createElement('div');
  strHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  const strLabel = document.createElement('div');
  strLabel.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff)';
  strLabel.textContent = t('feature.locker.maxStrThreshold');
  const strValue = document.createElement('div');
  strValue.style.cssText = `font-size:12px;color:var(--qpm-accent,${ACCENT});font-weight:600`;
  strValue.textContent = `${rules.maxStrThreshold}%`;
  strHeader.append(strLabel, strValue);

  const strSlider = document.createElement('input');
  strSlider.type = 'range'; strSlider.min = '0'; strSlider.max = '100'; strSlider.step = '5';
  strSlider.value = String(rules.maxStrThreshold);
  strSlider.style.cssText = 'width:100%;cursor:pointer';
  strSlider.addEventListener('input', () => { strValue.textContent = `${strSlider.value}%`; });
  strSlider.addEventListener('change', () => { setSellAllPetsProtectionRules({ maxStrThreshold: Number(strSlider.value) }); });
  strWrap.append(strHeader, strSlider);
  wrap.appendChild(strWrap);

  // Protected rarities
  const rarityWrap = document.createElement('div');
  rarityWrap.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:var(--qpm-radius-md,8px);border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;
  const rarityLabel = document.createElement('div');
  rarityLabel.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff);margin-bottom:2px';
  rarityLabel.textContent = t('feature.locker.protectedRarities');
  rarityWrap.appendChild(rarityLabel);

  const currentProtected = new Set(rules.protectedRarities.map(r => r.toLowerCase()));
  for (const rarity of SELL_ALL_PET_RARITY_OPTIONS) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:1px 0';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = currentProtected.has(rarity.toLowerCase());
    cb.style.cssText = `width:14px;height:14px;cursor:pointer;accent-color:var(--qpm-accent,${ACCENT})`;
    cb.addEventListener('change', () => {
      const cur = getSellAllPetsSettings().protections.protectedRarities;
      const set = new Set(cur.map(r => r.toLowerCase()));
      if (cb.checked) set.add(rarity.toLowerCase()); else set.delete(rarity.toLowerCase());
      setSellAllPetsProtectionRules({ protectedRarities: SELL_ALL_PET_RARITY_OPTIONS.filter(r => set.has(r.toLowerCase())) });
    });
    const cbLabel = document.createElement('span');
    cbLabel.style.cssText = 'font-size:11px;color:var(--qpm-text,#fff)';
    cbLabel.textContent = rarity;
    row.append(cb, cbLabel);
    rarityWrap.appendChild(row);
  }
  wrap.appendChild(rarityWrap);

  return wrap;
}

// ── Inventory Reserve ──────────────────────────────────────────────────────

export function buildInventoryReserveCard(config: LockerConfig): HTMLElement {
  const { root, body } = createCard({
    title: t('feature.locker.inventoryReserve'),
    collapsible: true,
    collapsed: true,
  });

  body.appendChild(makeHint(t('feature.locker.inventoryReserveHint')));

  body.appendChild(makeToggleRow(t('feature.locker.enableInventoryReserve'), config.inventoryReserve.enabled, (v) => {
    updateLockerConfig({ inventoryReserve: { ...getLockerConfig().inventoryReserve, enabled: v } });
  }));

  const sliderWrap = document.createElement('div');
  sliderWrap.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:var(--qpm-radius-md,8px);border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;

  const sliderHeader = document.createElement('div');
  sliderHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  const sliderLabel = document.createElement('div');
  sliderLabel.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff)';
  sliderLabel.textContent = t('feature.locker.minFreeSlots');
  const sliderValue = document.createElement('div');
  sliderValue.style.cssText = `font-size:12px;color:var(--qpm-accent,${ACCENT});font-weight:600`;
  sliderValue.textContent = String(config.inventoryReserve.minFreeSlots);
  sliderHeader.append(sliderLabel, sliderValue);

  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '50'; slider.step = '1';
  slider.value = String(config.inventoryReserve.minFreeSlots);
  slider.style.cssText = 'width:100%;cursor:pointer';
  slider.addEventListener('input', () => { sliderValue.textContent = slider.value; });
  slider.addEventListener('change', () => {
    updateLockerConfig({ inventoryReserve: { ...getLockerConfig().inventoryReserve, minFreeSlots: Number(slider.value) } });
  });
  sliderWrap.append(sliderHeader, slider);
  body.appendChild(sliderWrap);

  if (!config.enabled) root.style.opacity = '0.55';
  return root;
}
