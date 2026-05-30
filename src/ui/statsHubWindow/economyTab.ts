// src/ui/statsHubWindow/economyTab.ts
// Economy tab — balances, spending, transactions, compare with room player.

import { onGardenSnapshot, getGardenSnapshot } from '../../features/garden/bridge';
import { t } from '../../i18n';
import { formatCoinsAbbreviated } from '../../features/economy/valueCalculator';
import { computeGardenValueFromCatalog } from '../../features/economy/valueCalculator';
import { computeInventoryValue, computeAllStoragesValue, computeActivePetsValue, computePlacedDecorAndEggValue, computeGrowingCropsValue, onStorageDataChange } from '../../features/economy/storageValue';
import { onInventoryChange, getInventoryItems } from '../../store/inventory';
import { onActivePetInfos, getActivePetInfos } from '../../store/pets';
import { debounceCancelable } from '../../utils/debounce';
import { toggleValueCard, isValueCardOpen, type ValueCardType } from '../economy/valueFloatingCard';
import { getFriendBonusMultiplier, onFriendBonusChange } from '../../store/friendBonus';
import { getTopGardenItems, getTopInventoryItems, getTopNetWorthItems } from '../../features/economy/topValueItems';
import { getCachedStorages } from '../../features/economy/storageValue';
import { subscribeEconomy, getEconomySnapshot, type EconomySnapshot, type Transaction } from '../../store/economyTracker';
import type { ShopCategoryKey } from '../../store/stats';
import {
  startRoomPlayerEconomy,
  getRoomPlayersSnapshot,
  onRoomPlayersChange,
  type RoomPlayersSnapshot,
  type RoomPlayerEconomy,
} from '../../features/economy/roomPlayerEconomy';
import {
  togglePlayerCompareCard,
  isPlayerCompareCardOpen,
  getCompareTargetPlayerId,
  setCompareTarget,
} from '../economy/playerCompareFloatingCard';
import { CURRENCY_LABELS } from './constants';
import { currencyIcon, chipIcon } from './spriteHelpers';
import { pillBtnCss, timeAgo, appendSectionHeader, inlineVal } from './styleHelpers';
import { embedTopDropdown } from './economyTopValue';

// ---------------------------------------------------------------------------
// Balance chip
// ---------------------------------------------------------------------------

/** Balance chip — currency sprite + value + label + optional rate + pop-out button */
function balanceChip(
  value: string, label: string, currencyType: 'coins' | 'credits' | 'dust',
  accentColor: string, rate: number | null, connected: boolean,
  cardType: ValueCardType,
): HTMLElement {
  const el = document.createElement('div');
  const bg = connected ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)';
  el.style.cssText = `background:${bg};border:1px solid rgba(143,130,255,0.14);border-radius:8px;padding:7px 10px;display:flex;align-items:center;gap:7px;min-width:0;`;

  // Sprite icon (compact) — card-type-aware
  el.appendChild(chipIcon(cardType, 22));

  // Text column
  const col = document.createElement('div');
  col.style.cssText = 'display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;overflow:hidden;';

  const num = document.createElement('div');
  num.setAttribute('data-value-num', '');
  num.style.cssText = `font-size:15px;font-weight:700;line-height:1;color:${connected ? accentColor : 'rgba(224,224,224,0.4)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
  num.textContent = connected ? value : '\u2014';
  col.appendChild(num);

  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:10px;font-weight:600;color:rgba(224,224,224,0.5);white-space:nowrap;';
  lbl.textContent = label;
  col.appendChild(lbl);

  if (!connected) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:9px;color:rgba(224,224,224,0.35);';
    note.textContent = t('feature.statsHub.economy.notConnected');
    col.appendChild(note);
  } else if (rate != null && Math.abs(rate) >= 1) {
    const rateEl = document.createElement('div');
    const sign = rate >= 0 ? '+' : '';
    const rateColor = rate >= 0 ? 'var(--qpm-positive)' : 'var(--qpm-danger)';
    rateEl.style.cssText = `font-size:9px;color:${rateColor};font-weight:600;white-space:nowrap;`;
    rateEl.textContent = `${sign}${formatCoinsAbbreviated(Math.round(rate))}/hr`;
    col.appendChild(rateEl);
  }

  el.appendChild(col);

  // Pop-out button
  const popBtn = document.createElement('button');
  popBtn.type = 'button';
  popBtn.title = t('feature.statsHub.economy.popOut', { label });
  const open = isValueCardOpen(cardType);
  popBtn.style.cssText = `background:none;border:1px solid rgba(143,130,255,${open ? '0.5' : '0.25'});border-radius:4px;color:rgba(224,224,224,${open ? '0.8' : '0.45'});font-size:11px;cursor:pointer;padding:1px 4px;flex-shrink:0;transition:color 0.12s,border-color 0.12s;line-height:1;`;
  popBtn.textContent = '\u2197';
  popBtn.addEventListener('mouseenter', () => {
    popBtn.style.color = 'var(--qpm-text)';
    popBtn.style.borderColor = 'rgba(143,130,255,0.6)';
  });
  popBtn.addEventListener('mouseleave', () => {
    const isOpen = isValueCardOpen(cardType);
    popBtn.style.color = `rgba(224,224,224,${isOpen ? '0.8' : '0.45'})`;
    popBtn.style.borderColor = `rgba(143,130,255,${isOpen ? '0.5' : '0.25'})`;
  });
  popBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleValueCard(cardType);
    const isOpen = isValueCardOpen(cardType);
    popBtn.style.color = `rgba(224,224,224,${isOpen ? '0.8' : '0.45'})`;
    popBtn.style.borderColor = `rgba(143,130,255,${isOpen ? '0.5' : '0.25'})`;
  });
  el.appendChild(popBtn);

  return el;
}

// ---------------------------------------------------------------------------
// Spending row
// ---------------------------------------------------------------------------

/** Compact spending row — label + inline coin/credit/dust values */
function spendingRow(label: string, coins: number, credits: number, dust: number): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(224,224,224,0.6);padding:2px 0;';

  const lbl = document.createElement('span');
  lbl.style.cssText = 'min-width:50px;color:rgba(224,224,224,0.5);';
  lbl.textContent = label;
  row.appendChild(lbl);

  if (coins > 0) row.appendChild(inlineVal(formatCoinsAbbreviated(coins), '#ffd600'));
  if (credits > 0) row.appendChild(inlineVal(formatCoinsAbbreviated(credits) + ' cr', '#42a5f5'));
  if (dust > 0) row.appendChild(inlineVal(formatCoinsAbbreviated(dust) + ' dust', '#ab47bc'));

  return row;
}

// ---------------------------------------------------------------------------
// Transaction row
// ---------------------------------------------------------------------------

function buildTransactionRow(tx: Transaction): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:5px 0',
    'border-bottom:1px solid rgba(255,255,255,0.04)',
  ].join(';');

  const isIncome = tx.amount > 0;
  const label = CURRENCY_LABELS[tx.currency] ?? t('feature.statsHub.economy.currency');

  // Currency sprite
  row.appendChild(currencyIcon(tx.currency, 20));

  // Description — use WS context when available, fall back to generic
  const desc = document.createElement('span');
  desc.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.65);flex:1;';
  if (tx.context) {
    desc.textContent = tx.context;
  } else {
    desc.textContent = isIncome ? t('feature.statsHub.economy.earned', { label }) : t('feature.statsHub.economy.spent', { label });
  }
  row.appendChild(desc);

  // Amount (green for income, red for expense)
  const amountEl = document.createElement('span');
  const sign = isIncome ? '+' : '';
  amountEl.style.cssText = `font-size:12px;font-weight:700;color:${isIncome ? 'var(--qpm-positive)' : 'var(--qpm-danger)'};white-space:nowrap;`;
  amountEl.textContent = `${sign}${formatCoinsAbbreviated(Math.round(tx.amount))}`;
  row.appendChild(amountEl);

  // Time
  const timeEl = document.createElement('span');
  timeEl.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.3);white-space:nowrap;flex-shrink:0;margin-left:4px;';
  timeEl.textContent = timeAgo(tx.timestamp);
  row.appendChild(timeEl);

  return row;
}

// ---------------------------------------------------------------------------
// Compare grid
// ---------------------------------------------------------------------------

function buildCompareGrid(self: RoomPlayerEconomy | null, target: RoomPlayerEconomy | null, parent: HTMLElement): void {
  parent.innerHTML = '';
  if (!target || !self) return;

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:52px 1fr 1fr 1fr;gap:3px 6px;font-size:12px;margin-top:8px;';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:contents;font-size:10px;font-weight:700;color:rgba(224,224,224,0.55);';
  for (const text of ['', t('feature.statsHub.economy.you'), t('feature.statsHub.economy.them'), t('feature.statsHub.economy.delta')]) {
    const el = document.createElement('span');
    el.textContent = text;
    el.style.textAlign = text === '' ? 'left' : 'right';
    el.style.paddingBottom = '3px';
    el.style.borderBottom = '1px solid rgba(143,130,255,0.1)';
    hdr.appendChild(el);
  }
  grid.appendChild(hdr);

  function addRow(label: string, myVal: number, theirVal: number, useInt: boolean): void {
    const fmt = useInt ? (n: number) => String(Math.round(n)) : formatCoinsAbbreviated;
    const diff = myVal - theirVal;
    const deltaSign = diff > 0 ? '+' : '';
    const deltaColor = Math.abs(diff) < 1 ? 'rgba(224,224,224,0.35)' : diff > 0 ? 'var(--qpm-positive)' : 'var(--qpm-danger)';
    const deltaText = Math.abs(diff) < 1 ? '\u2014' : `${deltaSign}${fmt(Math.round(diff))}`;

    const row = document.createElement('div');
    row.style.cssText = 'display:contents;';

    const metricEl = document.createElement('span');
    metricEl.style.cssText = 'color:rgba(224,224,224,0.5);font-weight:600;padding:2px 0;';
    metricEl.textContent = label;
    row.appendChild(metricEl);

    const myEl = document.createElement('span');
    myEl.style.cssText = 'text-align:right;color:var(--qpm-gold);font-weight:700;padding:2px 0;';
    myEl.textContent = fmt(myVal);
    row.appendChild(myEl);

    const theirEl = document.createElement('span');
    theirEl.style.cssText = 'text-align:right;color:var(--qpm-text);font-weight:700;padding:2px 0;';
    theirEl.textContent = fmt(theirVal);
    row.appendChild(theirEl);

    const deltaEl = document.createElement('span');
    deltaEl.style.cssText = `text-align:right;font-weight:700;font-size:10px;padding:2px 0;color:${deltaColor};`;
    deltaEl.textContent = deltaText;
    row.appendChild(deltaEl);

    grid.appendChild(row);
  }

  addRow(t('feature.statsHub.economy.coins'), self.coins, target.coins, false);
  addRow(t('feature.statsHub.economy.garden'), self.gardenValue, target.gardenValue, false);
  addRow(t('feature.statsHub.economy.invAbbrev'), self.inventoryValue + self.storageValue, target.inventoryValue + target.storageValue, false);
  addRow(t('feature.statsHub.economy.pets'), self.petCount, target.petCount, true);
  addRow(t('feature.statsHub.economy.worth'),
    (self.coins || 0) + (self.gardenValue || 0) + (self.growingCropsValue || 0) + (self.placedDecorValue || 0) + (self.inventoryValue || 0) + (self.storageValue || 0) + (self.activePetsValue || 0),
    (target.coins || 0) + (target.gardenValue || 0) + (target.growingCropsValue || 0) + (target.placedDecorValue || 0) + (target.inventoryValue || 0) + (target.storageValue || 0) + (target.activePetsValue || 0),
    false);

  parent.appendChild(grid);
}

// ---------------------------------------------------------------------------
// Main economy tab builder
// ---------------------------------------------------------------------------

export function buildEconomyTab(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:14px;';
  container.appendChild(content);

  // Stable container for garden/inventory/net-worth value chips — updated independently
  const gardenNumRef = { el: null as HTMLElement | null };
  const inventoryNumRef = { el: null as HTMLElement | null };
  const netWorthNumRef = { el: null as HTMLElement | null };

  function updateAssetValues(): void {
    const fb = getFriendBonusMultiplier();
    const snap = getGardenSnapshot();
    const gardenVal = computeGardenValueFromCatalog(snap, fb);
    const growingVal = computeGrowingCropsValue(snap);
    const invVal = computeInventoryValue(fb);
    const storageVal = computeAllStoragesValue(fb);
    const petsVal = computeActivePetsValue(fb);
    const placedDecorVal = computePlacedDecorAndEggValue(snap);
    if (gardenNumRef.el) {
      gardenNumRef.el.textContent = formatCoinsAbbreviated(gardenVal);
    }
    if (inventoryNumRef.el) {
      inventoryNumRef.el.textContent = formatCoinsAbbreviated(invVal);
    }
    if (netWorthNumRef.el) {
      const coins = getEconomySnapshot().coins.balance || 0;
      const nw = (gardenVal || 0) + (growingVal || 0) + (invVal || 0) + (storageVal || 0) + (petsVal || 0) + (placedDecorVal || 0);
      netWorthNumRef.el.textContent = formatCoinsAbbreviated(coins + nw);
    }
  }

  const debouncedAssetUpdate = debounceCancelable(() => updateAssetValues(), 250);

  const unsubGarden = onGardenSnapshot(() => debouncedAssetUpdate(), false);
  const unsubInventory = onInventoryChange(() => debouncedAssetUpdate());
  const unsubPets = onActivePetInfos(() => debouncedAssetUpdate(), false);
  const unsubFriendBonus = onFriendBonusChange(() => debouncedAssetUpdate());
  const unsubStorage = onStorageDataChange(() => debouncedAssetUpdate());

  // --- Compare with Room Player section (outside content so it doesn't get wiped) ---
  const compareCleanups: Array<() => void> = [];
  const compareSection = document.createElement('div');
  compareSection.style.cssText = 'padding:8px 14px 12px;border-top:1px solid rgba(143,130,255,0.12);flex-shrink:0;';
  container.appendChild(compareSection);

  // Lazy-start roomPlayerEconomy
  let roomEconStarted = false;
  const compareSelectRef = { el: null as HTMLSelectElement | null };
  const compareGridRef = { el: null as HTMLElement | null };

  function updateCompareDropdown(snap: RoomPlayersSnapshot): void {
    const select = compareSelectRef.el;
    if (!select) return;

    const prevValue = select.value;
    select.innerHTML = '';

    if (snap.others.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = t('feature.statsHub.economy.noOtherPlayers');
      opt.disabled = true;
      opt.selected = true;
      select.appendChild(opt);
      select.disabled = true;
      // Clear grid
      if (compareGridRef.el) compareGridRef.el.innerHTML = '';
      return;
    }

    select.disabled = false;

    // Placeholder
    const placeholder = document.createElement('option');
    placeholder.textContent = t('feature.statsHub.economy.selectPlayer');
    placeholder.value = '';
    placeholder.disabled = true;
    select.appendChild(placeholder);

    let foundPrev = false;
    for (const player of snap.others) {
      const opt = document.createElement('option');
      opt.value = player.playerId;
      opt.textContent = player.displayName;
      if (player.playerId === prevValue) {
        opt.selected = true;
        foundPrev = true;
      }
      select.appendChild(opt);
    }

    if (!foundPrev) {
      placeholder.selected = true;
      if (compareGridRef.el) compareGridRef.el.innerHTML = '';
      // If the previously selected player left, show notice
      if (prevValue) {
        if (compareGridRef.el) {
          const notice = document.createElement('div');
          notice.style.cssText = 'color:rgba(224,224,224,0.35);font-size:11px;padding:6px 0;text-align:center;';
          notice.textContent = t('feature.statsHub.economy.playerLeft');
          compareGridRef.el.innerHTML = '';
          compareGridRef.el.appendChild(notice);
        }
      }
    } else {
      // Refresh comparison grid
      const target = snap.others.find((p) => p.playerId === prevValue) ?? null;
      if (compareGridRef.el) buildCompareGrid(snap.self, target, compareGridRef.el);
      // Update floating card if open
      if (isPlayerCompareCardOpen() && getCompareTargetPlayerId() !== prevValue && prevValue) {
        setCompareTarget(prevValue);
      }
    }
  }

  function initCompareSection(): void {
    compareSection.innerHTML = '';
    appendSectionHeader(compareSection, t('feature.statsHub.economy.compareHeader'));

    // Dropdown row
    const dropdownRow = document.createElement('div');
    dropdownRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';

    const select = document.createElement('select');
    select.style.cssText = [
      'flex:1',
      'background:rgba(18,20,26,0.95)',
      'border:1px solid rgba(143,130,255,0.25)',
      'border-radius:6px',
      'color:var(--qpm-text)',
      'font-size:12px',
      'padding:5px 8px',
      'outline:none',
      'cursor:pointer',
      'appearance:auto',
      'color-scheme:dark',
    ].join(';');
    compareSelectRef.el = select;

    // Pop-out button
    const popBtn = document.createElement('button');
    popBtn.type = 'button';
    popBtn.title = t('feature.statsHub.economy.popOutComparison');
    const cardOpen = isPlayerCompareCardOpen();
    popBtn.style.cssText = `background:none;border:1px solid rgba(143,130,255,${cardOpen ? '0.5' : '0.25'});border-radius:4px;color:rgba(224,224,224,${cardOpen ? '0.8' : '0.45'});font-size:11px;cursor:pointer;padding:2px 5px;flex-shrink:0;transition:color 0.12s,border-color 0.12s;line-height:1;`;
    popBtn.textContent = '\u2197';
    popBtn.addEventListener('mouseenter', () => {
      popBtn.style.color = 'var(--qpm-text)';
      popBtn.style.borderColor = 'rgba(143,130,255,0.6)';
    });
    popBtn.addEventListener('mouseleave', () => {
      const isOpen = isPlayerCompareCardOpen();
      popBtn.style.color = `rgba(224,224,224,${isOpen ? '0.8' : '0.45'})`;
      popBtn.style.borderColor = `rgba(143,130,255,${isOpen ? '0.5' : '0.25'})`;
    });
    popBtn.addEventListener('click', () => {
      const targetId = select.value;
      if (!targetId) return;
      togglePlayerCompareCard(targetId);
      const isOpen = isPlayerCompareCardOpen();
      popBtn.style.color = `rgba(224,224,224,${isOpen ? '0.8' : '0.45'})`;
      popBtn.style.borderColor = `rgba(143,130,255,${isOpen ? '0.5' : '0.25'})`;
    });

    dropdownRow.appendChild(select);
    dropdownRow.appendChild(popBtn);
    compareSection.appendChild(dropdownRow);

    // Comparison grid container
    const gridContainer = document.createElement('div');
    compareGridRef.el = gridContainer;
    compareSection.appendChild(gridContainer);

    // Select change handler
    select.addEventListener('change', () => {
      const targetId = select.value;
      if (!targetId) {
        gridContainer.innerHTML = '';
        return;
      }
      const snap = getRoomPlayersSnapshot();
      const target = snap.others.find((p) => p.playerId === targetId) ?? null;
      buildCompareGrid(snap.self, target, gridContainer);
      // Update floating card if open
      if (isPlayerCompareCardOpen()) {
        setCompareTarget(targetId);
      }
    });

    // Initial dropdown populate
    updateCompareDropdown(getRoomPlayersSnapshot());

    // Subscribe to room player changes
    const unsubRoom = onRoomPlayersChange((snap) => {
      updateCompareDropdown(snap);
    });
    compareCleanups.push(unsubRoom);
  }

  function render(snapshot: EconomySnapshot): void {
    content.innerHTML = '';

    // --- All value chips in a grid (3 cols → balances on row 1, assets on row 2) ---
    const chips = document.createElement('div');
    chips.dataset.tour = 'stats-balance-chips';
    chips.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;';

    chips.appendChild(balanceChip(
      formatCoinsAbbreviated(snapshot.coins.balance),
      t('feature.statsHub.economy.coins'), 'coins', '#ffd600',
      snapshot.coins.rate, snapshot.coins.connected, 'coins',
    ));
    chips.appendChild(balanceChip(
      formatCoinsAbbreviated(snapshot.credits.balance),
      t('feature.statsHub.economy.credits'), 'credits', '#42a5f5',
      null, snapshot.credits.connected, 'credits',
    ));
    chips.appendChild(balanceChip(
      formatCoinsAbbreviated(snapshot.dust.balance),
      t('feature.statsHub.economy.magicDust'), 'dust', '#ab47bc',
      snapshot.dust.rate, snapshot.dust.connected, 'dust',
    ));

    // Garden value chip
    const fb = getFriendBonusMultiplier();
    const gardenChip = balanceChip(
      formatCoinsAbbreviated(computeGardenValueFromCatalog(getGardenSnapshot(), fb)),
      t('feature.statsHub.economy.garden'), 'coins', '#ffd600',
      null, true, 'garden',
    );
    gardenNumRef.el = gardenChip.querySelector('[data-value-num]');
    chips.appendChild(gardenChip);

    // Inventory value chip
    const invChip = balanceChip(
      formatCoinsAbbreviated(computeInventoryValue(fb)),
      t('feature.statsHub.economy.inventory'), 'coins', '#ffd600',
      null, true, 'inventory',
    );
    inventoryNumRef.el = invChip.querySelector('[data-value-num]');
    chips.appendChild(invChip);

    // Net Worth chip (coins + garden + growing + inventory + storages + active pets + placed decor/eggs)
    const initSnap = getGardenSnapshot();
    const gardenVal = computeGardenValueFromCatalog(initSnap, fb);
    const growingVal = computeGrowingCropsValue(initSnap);
    const invVal = computeInventoryValue(fb);
    const storageVal = computeAllStoragesValue(fb);
    const petsVal = computeActivePetsValue(fb);
    const placedDecorVal = computePlacedDecorAndEggValue(initSnap);
    const netWorthVal = (snapshot.coins.balance || 0) + (gardenVal || 0) + (growingVal || 0) + (invVal || 0) + (storageVal || 0) + (petsVal || 0) + (placedDecorVal || 0);
    const nwChip = balanceChip(
      formatCoinsAbbreviated(netWorthVal),
      t('feature.statsHub.economy.netWorth'), 'coins', '#8f82ff',
      null, true, 'netWorth',
    );
    netWorthNumRef.el = nwChip.querySelector('[data-value-num]');
    chips.appendChild(nwChip);

    content.appendChild(chips);

    // --- Top-10 overlay dropdowns on Garden, Inventory, and Net Worth chips ---
    const gardenDd = embedTopDropdown(gardenChip);
    const invDd = embedTopDropdown(invChip);
    const nwDd = embedTopDropdown(nwChip);

    function refreshDropdowns(): void {
      const fb2 = getFriendBonusMultiplier();
      gardenDd.update(getTopGardenItems(getGardenSnapshot(), fb2));
      invDd.update(getTopInventoryItems(getInventoryItems(), fb2));
      nwDd.update(getTopNetWorthItems(
        getGardenSnapshot(), getInventoryItems(), getCachedStorages(), getActivePetInfos(), fb2,
      ));
    }
    refreshDropdowns();
    const debouncedDropdownRefresh = debounceCancelable(refreshDropdowns, 300);
    const unsubDropdownGarden = onGardenSnapshot(() => debouncedDropdownRefresh(), false);
    const unsubDropdownInv = onInventoryChange(() => debouncedDropdownRefresh());
    const unsubDropdownPets = onActivePetInfos(() => debouncedDropdownRefresh(), false);
    const unsubDropdownBonus = onFriendBonusChange(() => debouncedDropdownRefresh());
    const unsubDropdownStorage = onStorageDataChange(() => debouncedDropdownRefresh());
    compareCleanups.push(unsubDropdownGarden, unsubDropdownInv, unsubDropdownPets, unsubDropdownBonus, unsubDropdownStorage, debouncedDropdownRefresh.cancel, gardenDd.destroy, invDd.destroy, nwDd.destroy);

    // --- Spending ---
    const totalData = snapshot.spending.total;
    const hasSpending = totalData.coins > 0 || totalData.credits > 0 || totalData.dust > 0;

    if (hasSpending) {
      appendSectionHeader(content, t('feature.statsHub.economy.sessionSpending'));

      const categories: Array<{ key: ShopCategoryKey; label: string }> = [
        { key: 'seeds', label: t('feature.statsHub.economy.seeds') },
        { key: 'eggs', label: t('feature.statsHub.economy.eggs') },
        { key: 'tools', label: t('feature.statsHub.economy.tools') },
        { key: 'decor', label: t('feature.statsHub.economy.decor') },
      ];

      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

      for (const cat of categories) {
        const d = snapshot.spending.byCategory[cat.key];
        if (!d || (d.coins === 0 && d.credits === 0 && d.dust === 0)) continue;
        list.appendChild(spendingRow(cat.label, d.coins, d.credits, d.dust));
      }

      // Total row
      const totEl = spendingRow(t('feature.statsHub.economy.total'), totalData.coins, totalData.credits, totalData.dust);
      totEl.style.borderTop = '1px solid rgba(143,130,255,0.12)';
      totEl.style.paddingTop = '4px';
      totEl.style.marginTop = '2px';
      totEl.style.fontWeight = '700';
      list.appendChild(totEl);

      content.appendChild(list);
    }

    // --- Transaction log ---
    if (snapshot.transactions.length > 0) {
      appendSectionHeader(content, t('feature.statsHub.economy.recentActivity'));

      const txList = document.createElement('div');
      txList.style.cssText = 'display:flex;flex-direction:column;';

      for (const tx of snapshot.transactions.slice(0, 20)) {
        txList.appendChild(buildTransactionRow(tx));
      }
      content.appendChild(txList);
    } else if (!hasSpending) {
      const note = document.createElement('div');
      note.style.cssText = 'color:rgba(224,224,224,0.3);font-size:12px;padding:8px 0;';
      note.textContent = t('feature.statsHub.economy.noActivity');
      content.appendChild(note);
    }
  }

  const unsub = subscribeEconomy(render);

  // Start room player economy and build section
  void startRoomPlayerEconomy().then(() => {
    roomEconStarted = true;
    initCompareSection();
  });

  return () => {
    unsub();
    unsubGarden();
    unsubInventory();
    unsubPets();
    unsubFriendBonus();
    unsubStorage();
    debouncedAssetUpdate.cancel();
    compareCleanups.forEach((fn) => fn());
    compareCleanups.length = 0;
  };
}
