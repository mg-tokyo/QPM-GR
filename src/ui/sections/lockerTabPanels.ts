// src/ui/sections/lockerTabPanels.ts
// Tab panel builders and cross-cutting cards for the Locker UI.

import { createCard } from '../panelHelpers';
import { getLockerConfig, updateLockerConfig, type LockerConfig } from '../../features/locker/index';
import {
  areCatalogsReady, getEggCatalog, getAllPlantSpecies,
  getAllDecor, getDecor, getAllMutations,
} from '../../catalogs/gameCatalogs';
import {
  getSellAllPetsSettings, setSellAllPetsProtectionRules, SELL_ALL_PET_RARITY_OPTIONS,
} from '../../features/sellAllPets';
import {
  UNLOCKED_BG, UNLOCKED_BORDER, ACCENT, TEXT_MUTED, LABEL_CSS,
  type EligibleData,
  resolveEggSprite, resolveDecorSprite,
  makeToggleRow, makeBlockAllCheckbox, makeShowAllToggle, makeHint, makeGrid,
  makeLockTile, makeMutationTile, makeAccentTile, buildRarityGrid,
} from './lockerPrimitives';
import { buildCustomRulesCard } from './lockerCustomRules';
import { buildHarvestFilterCard } from './lockerHarvestFilters';
import { buildCropOverridesCard } from './lockerCropOverrides';
import { createInventoryCapacitySection } from './inventoryCapacitySection';
import { t } from '../../i18n';
import { log } from '../../utils/logger';

// ── Garden QOL Panel ────────────────────────────────────────────────────────

export function buildGardenQolPanel(config: LockerConfig): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  // 1. Insta-Harvest card
  const { root: instaRoot, body: instaBody } = createCard(t('feature.locker.instaHarvest'), { collapsible: true });
  instaBody.appendChild(makeHint(t('feature.locker.instaHarvestHint')));
  const instaGrid = makeGrid();
  instaGrid.appendChild(makeMutationTile(
    'Rainbow',
    () => getLockerConfig().instaHarvestRainbow,
    () => { updateLockerConfig({ instaHarvestRainbow: !getLockerConfig().instaHarvestRainbow }); },
  ));
  instaGrid.appendChild(makeMutationTile(
    'Gold',
    () => getLockerConfig().instaHarvestGold,
    () => { updateLockerConfig({ instaHarvestGold: !getLockerConfig().instaHarvestGold }); },
  ));
  instaGrid.appendChild(makeAccentTile(
    t('feature.locker.ariesHold'),
    () => getLockerConfig().ariesHold,
    () => { updateLockerConfig({ ariesHold: !getLockerConfig().ariesHold }); },
  ));
  instaBody.appendChild(instaGrid);

  // Hold rate slider
  const rateWrap = document.createElement('div');
  rateWrap.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:8px;border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;
  const rateHeader = document.createElement('div');
  rateHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  const rateLabel = document.createElement('div');
  rateLabel.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff)';
  rateLabel.textContent = t('feature.locker.holdRate');
  const rateValue = document.createElement('div');
  rateValue.style.cssText = `font-size:12px;color:${ACCENT};font-weight:600`;
  rateValue.textContent = `${config.holdRateHz} Hz`;
  rateHeader.append(rateLabel, rateValue);
  const rateSlider = document.createElement('input');
  rateSlider.type = 'range'; rateSlider.min = '5'; rateSlider.max = '20'; rateSlider.step = '1';
  rateSlider.value = String(config.holdRateHz);
  rateSlider.style.cssText = 'width:100%;cursor:pointer';
  rateSlider.addEventListener('input', () => { rateValue.textContent = `${rateSlider.value} Hz`; });
  rateSlider.addEventListener('change', () => {
    updateLockerConfig({ holdRateHz: Number(rateSlider.value) });
  });
  rateWrap.append(rateHeader, rateSlider);
  instaBody.appendChild(rateWrap);
  panel.appendChild(instaRoot);

  // 2. Hold Contexts card
  const { root: ctxRoot, body: ctxBody } = createCard(t('feature.locker.holdContexts'), { collapsible: true, startCollapsed: true });
  ctxBody.appendChild(makeHint(t('feature.locker.holdContextsHint')));
  const ctxKeys: Array<{ key: keyof typeof config.holdContexts; label: string }> = [
    { key: 'harvest', label: t('feature.locker.ctx.harvest') },
    { key: 'plant',   label: t('feature.locker.ctx.plant') },
    { key: 'shovel',  label: t('feature.locker.ctx.shovel') },
    { key: 'sell',    label: t('feature.locker.ctx.sell') },
    { key: 'hatch',   label: t('feature.locker.ctx.hatch') },
    { key: 'other',   label: t('feature.locker.ctx.other') },
  ];
  for (const { key, label: ctxLabel } of ctxKeys) {
    ctxBody.appendChild(makeToggleRow(ctxLabel, config.holdContexts[key], (v) => {
      const cur = getLockerConfig();
      updateLockerConfig({ holdContexts: { ...cur.holdContexts, [key]: v } });
    }));
  }
  panel.appendChild(ctxRoot);

  // 3. Inventory Capacity card (embedded from inventoryCapacitySection)
  try {
    panel.appendChild(createInventoryCapacitySection());
  } catch (err) {
    log('[Locker] Failed to load Inventory Capacity', err);
  }

  // 4. Inventory Reserve card
  panel.appendChild(buildInventoryReserveCard(config));

  return panel;
}

// ── Plants Panel ────────────────────────────────────────────────────────────

export function buildPlantsPanel(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  // 1. Harvest Filter card (expanded by default)
  panel.appendChild(buildHarvestFilterCard(config));

  // 2. Crop Overrides card (collapsed by default)
  panel.appendChild(buildCropOverridesCard(config, eligible));

  // 3. Quick Locks card (plant/mutation locks + blanket harvest lock)
  const blockAllCb = makeBlockAllCheckbox(t('feature.locker.blockAll'), config.harvestLock, (v) => {
    updateLockerConfig({ harvestLock: v });
  });

  const { root: lockerRoot, body: lockerBody } = createCard(t('feature.locker.filter.quickLocks'), {
    collapsible: true,
    startCollapsed: true,
    headerActions: [blockAllCb],
  });
  lockerBody.appendChild(makeHint(t('feature.locker.filter.quickLocksHint')));

  const showAllBtn = makeShowAllToggle((showAll) => rebuildPlantGrid(showAll));
  lockerBody.appendChild(showAllBtn);

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

  rebuildPlantGrid(false);
  lockerBody.appendChild(plantGridSlot);

  // Mutations sub-section
  if (areCatalogsReady()) {
    const mutations = getAllMutations();
    if (mutations.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 0';
      lockerBody.appendChild(divider);

      const mutHeader = document.createElement('div');
      mutHeader.textContent = t('feature.locker.mutations');
      mutHeader.style.cssText = LABEL_CSS + ';font-size:12px;padding:2px 0 2px';
      lockerBody.appendChild(mutHeader);

      lockerBody.appendChild(makeHint(t('feature.locker.blockHarvestMutations')));

      const mutGrid = makeGrid();
      for (const mutId of mutations.sort()) {
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
      lockerBody.appendChild(mutGrid);
    }
  }

  if (!config.enabled) lockerRoot.style.opacity = '0.55';
  panel.appendChild(lockerRoot);

  // 4. Custom Rules card
  panel.appendChild(buildCustomRulesCard(config, eligible));

  return panel;
}

// ── Eggs Panel ──────────────────────────────────────────────────────────────

export function buildEggsPanel(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  const blockAllCb = makeBlockAllCheckbox(t('feature.locker.blockAll'), config.hatchLock, (v) => {
    updateLockerConfig({ hatchLock: v });
  });

  const { root: lockerRoot, body: lockerBody } = createCard(t('feature.locker.eggLocker'), {
    collapsible: true,
    headerActions: [blockAllCb],
  });

  const showAllBtn = makeShowAllToggle((showAll) => rebuildEggGrid(showAll));
  lockerBody.appendChild(showAllBtn);

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
  lockerBody.appendChild(eggGridSlot);

  if (!config.enabled) lockerRoot.style.opacity = '0.55';
  panel.appendChild(lockerRoot);

  return panel;
}

// ── Decor Panel ─────────────────────────────────────────────────────────────

export function buildDecorPanel(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  const blockAllCb = makeBlockAllCheckbox(t('feature.locker.blockAll'), config.decorPickupLock, (v) => {
    updateLockerConfig({ decorPickupLock: v });
  });

  const { root: lockerRoot, body: lockerBody } = createCard(t('feature.locker.decorLocker'), {
    collapsible: true,
    headerActions: [blockAllCb],
  });

  const showAllBtn = makeShowAllToggle((showAll) => rebuildDecorGrid(showAll));
  lockerBody.appendChild(showAllBtn);

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
  lockerBody.appendChild(decorGridSlot);

  if (!config.enabled) lockerRoot.style.opacity = '0.55';
  panel.appendChild(lockerRoot);

  return panel;
}

// ── Sell Panel ──────────────────────────────────────────────────────────────

export function buildSellPanel(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  // Crop Sell Protection card
  const cropBlockAllCb = makeBlockAllCheckbox(t('feature.locker.blockAll'), config.sellAllCropsLock, (v) => {
    updateLockerConfig({ sellAllCropsLock: v });
  });

  const { root: cropSellRoot, body: cropSellBody } = createCard(t('feature.locker.cropSellProtection'), {
    collapsible: true,
    headerActions: [cropBlockAllCb],
  });

  const cropShowAllBtn = makeShowAllToggle((showAll) => rebuildCropSellGrid(showAll));
  cropSellBody.appendChild(cropShowAllBtn);
  cropSellBody.appendChild(makeHint(t('feature.locker.cropSellHint')));

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

  rebuildCropSellGrid(false);
  cropSellBody.appendChild(cropSellGridSlot);

  if (!config.enabled) cropSellRoot.style.opacity = '0.55';
  panel.appendChild(cropSellRoot);

  // Hold-Sell Protection toggle — blocks selling protected pets during hold-Space
  panel.appendChild(makeToggleRow(t('feature.locker.holdSellProtection'), config.petSellGuard, (v) => {
    updateLockerConfig({ petSellGuard: v });
  }));
  panel.appendChild(makeHint(t('feature.locker.holdSellHint')));

  // Sell All Pets Protections card
  panel.appendChild(buildSellAllPetsCard());

  return panel;
}

// ── Cross-cutting cards ─────────────────────────────────────────────────────

export function buildInventoryReserveCard(config: LockerConfig): HTMLElement {
  const { root, body } = createCard(t('feature.locker.inventoryReserve'), { collapsible: true, startCollapsed: true });

  body.appendChild(makeHint(t('feature.locker.inventoryReserveHint')));

  body.appendChild(makeToggleRow(t('feature.locker.enableInventoryReserve'), config.inventoryReserve.enabled, (v) => {
    updateLockerConfig({ inventoryReserve: { ...getLockerConfig().inventoryReserve, enabled: v } });
  }));

  const sliderWrap = document.createElement('div');
  sliderWrap.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:8px;border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;

  const sliderHeader = document.createElement('div');
  sliderHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  const sliderLabel = document.createElement('div');
  sliderLabel.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff)';
  sliderLabel.textContent = t('feature.locker.minFreeSlots');
  const sliderValue = document.createElement('div');
  sliderValue.style.cssText = `font-size:12px;color:${ACCENT};font-weight:600`;
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

function buildSellAllPetsCard(): HTMLElement {
  const { root, body } = createCard(t('feature.locker.sellAllPets'), { collapsible: true });
  const rules = getSellAllPetsSettings().protections;

  body.appendChild(makeToggleRow(t('feature.locker.enableProtections'), rules.enabled, (v) => { setSellAllPetsProtectionRules({ enabled: v }); }));
  body.appendChild(makeToggleRow(t('feature.locker.protectGold'), rules.protectGold, (v) => { setSellAllPetsProtectionRules({ protectGold: v }); }));
  body.appendChild(makeToggleRow(t('feature.locker.protectRainbow'), rules.protectRainbow, (v) => { setSellAllPetsProtectionRules({ protectRainbow: v }); }));
  body.appendChild(makeToggleRow(t('feature.locker.protectMaxStr'), rules.protectMaxStr, (v) => { setSellAllPetsProtectionRules({ protectMaxStr: v }); }));

  // STR threshold
  const strWrap = document.createElement('div');
  strWrap.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:8px;border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;
  const strHeader = document.createElement('div');
  strHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
  const strLabel = document.createElement('div');
  strLabel.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff)';
  strLabel.textContent = t('feature.locker.maxStrThreshold');
  const strValue = document.createElement('div');
  strValue.style.cssText = `font-size:12px;color:${ACCENT};font-weight:600`;
  strValue.textContent = `${rules.maxStrThreshold}%`;
  strHeader.append(strLabel, strValue);

  const strSlider = document.createElement('input');
  strSlider.type = 'range'; strSlider.min = '0'; strSlider.max = '100'; strSlider.step = '5';
  strSlider.value = String(rules.maxStrThreshold);
  strSlider.style.cssText = 'width:100%;cursor:pointer';
  strSlider.addEventListener('input', () => { strValue.textContent = `${strSlider.value}%`; });
  strSlider.addEventListener('change', () => { setSellAllPetsProtectionRules({ maxStrThreshold: Number(strSlider.value) }); });
  strWrap.append(strHeader, strSlider);
  body.appendChild(strWrap);

  // Protected rarities
  const rarityWrap = document.createElement('div');
  rarityWrap.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:8px;border:1px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG}`;
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
    cb.style.cssText = `width:14px;height:14px;cursor:pointer;accent-color:${ACCENT}`;
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
  body.appendChild(rarityWrap);
  return root;
}
