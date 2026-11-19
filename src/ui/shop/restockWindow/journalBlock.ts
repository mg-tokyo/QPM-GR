// ALR-16.6: "Journal seeds" block under Pinned. Its switch is the centre's `shops.journalSeed` row;
// the list is the watched-seed core (features/journalSeeds), stock is read as the alert card reads it.

import { t } from '../../../i18n';
import { createMutationBadge, createToggle } from '../../components';
import { getAlertRow, getAlertRowSettings, setAlertRowEnabled } from '../../../features/alertHub';
import { getJournalSeedsState, getWatchedSeeds, onWatchedSeedsChange, type WatchedSeed } from '../../../features/journalSeeds';
import { resolveWeatherMutationEntry } from '../../../features/garden/cropMutationAnalytics';
import { findVariantBadge } from '../../../features/mutations/data/variantBadges';
import { getItemEligibleShops } from '../../../catalogs/shopEligibility';
import { getShopStockState, onShopStock } from '../../../store/shopStock';
import { isTrackedItem } from '../../../store/restockTracked';
import { getWeatherSnapshot } from '../../../store/weatherHub';
import { canonicalItemId, type RestockItem } from '../../../utils/restock/dataService';
import { getMutationName, getPlantSafe } from '../../../utils/game/catalogHelpers';
import { areAlertsWipEnabled } from '../../../utils/wipFeatures';
import { getAlertSpriteUrl } from '../restockAlerts/itemLook';
import { JOURNAL_SEED_ROW, registerJournalSeedRows } from '../restockAlerts/journalSeedCard';
import { listStockedSeedIds } from '../restockAlerts/stockProcessor';
import { getItemName, getItemRarity } from '../restockWindowMeta';
import { rarityBorderStyle, rarityColor } from '../restockWindowFormatters';

const MAX_CHIPS = 3;
const ROW_BG = 'color-mix(in srgb, var(--qpm-surface-2) 50%, transparent)';

export interface JournalBlockOptions {
  /** The window's restock rows (pins are keyed on them). */
  getRows: () => readonly RestockItem[];
  getTracked: () => Set<string>;
  /** Called after the block changed the pin set. */
  onPinsChanged: () => void;
}

export interface JournalBlock {
  section: HTMLDivElement;
  refresh: () => void;
  destroy: () => void;
}

function rowOn(): boolean {
  const def = getAlertRow(JOURNAL_SEED_ROW);
  return getAlertRowSettings(JOURNAL_SEED_ROW, def?.defaultSound ?? 'chime', def?.defaultEnabled).enabled;
}

const cropName = (species: string): string => getPlantSafe(species)?.crop.name ?? species;

/** The restock row the window pins for this seed: a shop the catalog lists for it, else the seed shop. */
function pinRowFor(species: string, rows: readonly RestockItem[]): RestockItem | null {
  const eligible = getItemEligibleShops(species);
  const shops = eligible.length > 0 ? eligible : ['seed'];
  return rows.find((r) => shops.includes(r.shop_type)
    && canonicalItemId(r.shop_type, r.item_id).toLowerCase() === canonicalItemId(r.shop_type, species).toLowerCase()) ?? null;
}

function missingText(seed: WatchedSeed): string {
  const count = seed.missing.length;
  if (seed.forSpecies !== seed.seedSpecies) return t('feature.shopRestock.journalMissingFor', { count, species: cropName(seed.forSpecies) });
  return count === 1 ? t('feature.shopRestock.journalMissingOne') : t('feature.shopRestock.journalMissing', { count });
}

function chip(text: string, color: string, tint: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText = `font-size:10px;font-weight:600;padding:2px 8px;border-radius:9999px;white-space:nowrap;color:${color};background:${tint};`;
  return el;
}

function iconWrap(species: string, rarity: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `width:36px;height:36px;border-radius:8px;background:var(--qpm-accent-tint);${rarityBorderStyle(rarity)}display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
  const url = getAlertSpriteUrl('seed', species, species);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.cssText = 'width:28px;height:28px;object-fit:contain;';
    wrap.appendChild(img);
  }
  return wrap;
}

function buildRow(seed: WatchedSeed, inStock: boolean, opts: JournalBlockOptions): HTMLDivElement {
  const rarity = getItemRarity(seed.seedSpecies, 'seed');
  const weatherColor = seed.weatherMatch ? findVariantBadge(seed.weatherMatch)?.color ?? null : null;
  const baseBg = weatherColor ? `color-mix(in srgb, ${weatherColor} 10%, transparent)` : ROW_BG;
  const pinRow = pinRowFor(seed.seedSpecies, opts.getRows());
  const pinned = pinRow ? isTrackedItem(opts.getTracked(), pinRow.shop_type, pinRow.item_id) : false;

  const row = document.createElement('div');
  row.style.cssText = `display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:8px;background:${baseBg};transition:transform 0.15s, background 0.15s;cursor:${pinRow ? 'pointer' : 'default'};`;
  row.dataset.journalSeed = seed.seedSpecies;
  if (pinRow) {
    row.title = pinned ? t('feature.shopRestock.clickToUnpin') : t('feature.shopRestock.clickToPin');
    row.addEventListener('mouseenter', () => { row.style.transform = 'scale(1.01)'; row.style.background = 'var(--qpm-accent-tint)'; });
    row.addEventListener('mouseleave', () => { row.style.transform = ''; row.style.background = baseBg; });
    row.addEventListener('click', () => {
      const tracked = opts.getTracked();
      if (pinned) {
        for (const key of Array.from(tracked)) {
          if (isTrackedItem(new Set([key]), pinRow.shop_type, pinRow.item_id)) tracked.delete(key);
        }
      } else {
        tracked.add(`${pinRow.shop_type}:${pinRow.item_id}`);
      }
      opts.onPinsChanged();
    });
  }

  const text = document.createElement('div');
  text.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;';
  const name = document.createElement('div');
  name.style.cssText = `font-size:14px;font-weight:700;color:${rarityColor(rarity)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
  name.textContent = getItemName(seed.seedSpecies, 'seed');
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:12px;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  sub.textContent = missingText(seed);
  text.append(name, sub);

  const badges = document.createElement('div');
  badges.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:flex-end;';
  const order = seed.weatherMatch ? [seed.weatherMatch, ...seed.missing.filter((v) => v !== seed.weatherMatch)] : seed.missing;
  for (const variant of order.slice(0, MAX_CHIPS)) badges.appendChild(createMutationBadge(getMutationName(variant), { size: 'compact' }));
  if (order.length > MAX_CHIPS) badges.appendChild(chip(`+${order.length - MAX_CHIPS}`, 'var(--qpm-text-muted)', 'var(--qpm-surface-2)'));

  const status = document.createElement('div');
  status.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';
  if (seed.weatherMatch) {
    const weather = resolveWeatherMutationEntry(getWeatherSnapshot().kind).displayName ?? '';
    const color = weatherColor ?? 'var(--qpm-accent-hover)';
    status.appendChild(chip(t('feature.shopRestock.journalWeatherNow', { weather, mutation: getMutationName(seed.weatherMatch) }), color, `color-mix(in srgb, ${color} 18%, transparent)`));
  }
  status.appendChild(inStock
    ? chip(t('feature.shopRestock.journalInStock'), 'var(--qpm-positive)', 'color-mix(in srgb, var(--qpm-positive) 15%, transparent)')
    : chip(t('feature.shopRestock.journalNotInStock'), 'var(--qpm-text-muted)', 'var(--qpm-surface-2)'));
  if (pinned) status.appendChild(chip(t('feature.shopRestock.pinned'), 'var(--qpm-accent-hover)', 'var(--qpm-accent-subtle)'));

  row.append(iconWrap(seed.seedSpecies, rarity), text, badges, status);
  return row;
}

/** Weather match first, then in stock, then journal order (stable sort keeps the core's order). */
function sortSeeds(seeds: readonly WatchedSeed[], stocked: Set<string>): WatchedSeed[] {
  const rank = (s: WatchedSeed): number => (s.weatherMatch ? 0 : 2) + (stocked.has(s.seedSpecies) ? 0 : 1);
  return [...seeds].sort((a, b) => rank(a) - rank(b));
}

/** Null when the alerts preview is off: the alert behind the switch only runs then. */
export function createJournalSeedsBlock(opts: JournalBlockOptions): JournalBlock | null {
  if (!areAlertsWipEnabled()) return null;
  registerJournalSeedRows();
  const cleanups: Array<() => void> = [];
  let enabled = rowOn();
  let open = enabled;

  const section = document.createElement('div');
  section.style.cssText = 'flex-shrink:0;border-bottom:1px solid var(--qpm-accent-subtle);';
  section.dataset.tour = 'restock-journal';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;user-select:none;background:var(--qpm-accent-tint);';
  const title = document.createElement('span');
  title.style.cssText = 'font-size:12px;font-weight:700;color:var(--qpm-text);';
  title.textContent = t('feature.shopRestock.journalTitle');
  const count = chip('', 'var(--qpm-accent-hover)', 'var(--qpm-accent-subtle)');
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  const toggle = createToggle({ size: 'compact', checked: enabled, onChange: (on) => { setAlertRowEnabled(JOURNAL_SEED_ROW, on); setEnabled(on); } });
  toggle.input.setAttribute('aria-label', t('feature.shopRestock.journalToggleAria'));
  toggle.root.addEventListener('click', (e) => { e.stopPropagation(); });
  const chevron = document.createElement('span');
  chevron.style.cssText = 'font-size:9px;color:var(--qpm-text-muted);';
  header.append(title, count, spacer, toggle.root, chevron);

  const body = document.createElement('div');
  const desc = document.createElement('div');
  desc.style.cssText = 'padding:6px 16px 4px;font-size:12px;color:var(--qpm-text-muted);';
  desc.textContent = t('feature.shopRestock.journalDescription');
  const list = document.createElement('div');
  list.style.cssText = 'padding:4px 10px 8px;display:flex;flex-direction:column;gap:2px;max-height:240px;overflow-y:auto;';
  body.append(desc, list);
  section.append(header, body);

  const applyOpen = (): void => {
    body.style.display = open ? '' : 'none';
    chevron.textContent = open ? 'v' : '>';
  };
  function setEnabled(on: boolean): void {
    enabled = on;
    open = on;
    applyOpen();
  }
  header.addEventListener('click', () => { open = !open; applyOpen(); });

  const refresh = (): void => {
    const seeds = getWatchedSeeds();
    count.textContent = t('feature.shopRestock.journalWatched', { count: seeds.length });
    list.innerHTML = '';
    if (seeds.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 4px;font-size:12px;color:var(--qpm-text-muted);font-style:italic;';
      empty.textContent = getJournalSeedsState().myDataSeen === true ? t('feature.shopRestock.journalEmpty') : t('feature.shopRestock.journalWaiting');
      list.appendChild(empty);
      return;
    }
    const stocked = listStockedSeedIds(getShopStockState());
    const frag = document.createDocumentFragment();
    for (const seed of sortSeeds(seeds, stocked)) frag.appendChild(buildRow(seed, stocked.has(seed.seedSpecies), opts));
    list.appendChild(frag);
  };

  // The centre writes the same row; catch up when the pointer comes back (the centre's own pattern, alertsTab.ts).
  const syncSwitch = (): void => {
    const now = rowOn();
    if (now === enabled) return;
    toggle.setChecked(now);
    setEnabled(now);
  };
  section.addEventListener('pointerenter', syncSwitch);
  cleanups.push(() => { section.removeEventListener('pointerenter', syncSwitch); });
  cleanups.push(onWatchedSeedsChange(refresh));
  cleanups.push(onShopStock(refresh, false));

  applyOpen();
  refresh();
  return {
    section,
    refresh,
    destroy: () => { while (cleanups.length > 0) cleanups.pop()?.(); },
  };
}
