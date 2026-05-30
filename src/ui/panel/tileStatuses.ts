// src/ui/panel/tileStatuses.ts
// Status helpers, defaults, new tile status updaters, and the orchestrator.

import { getAllTileDefinitions } from './tileRegistry';
import { t } from '../../i18n';
import {
  startPetDerivedStatuses,
  startPublicRoomsStatus,
  startShopRestockStatus,
  startJournalStatus,
  startTurtleTimerStatus,
  startCropBoostStatus,
  startValueDisplayStatus,
  startActivityLogStatus,
  startProtectionStatus,
  startCropCalculatorStatus,
  startControllerStatus,
} from './tileStatusesCore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TileStatusTone = 'normal' | 'muted' | 'positive' | 'alert';

export type RestockTileItem = {
  item_id: string;
  shop_type: string;
  estimated_next_timestamp?: number | null;
  predicted_next_ms?: number | null;
};

export type GetStatusEl = (tileId: string) => HTMLElement | null;
export type AddLiveCleanup = (version: number, cleanup: () => void) => void;

// ---------------------------------------------------------------------------
// Version tracking (shared with tileStatusesCore)
// ---------------------------------------------------------------------------

let currentVersion = 0;

export function getCurrentVersion(): number {
  return currentVersion;
}

// ---------------------------------------------------------------------------
// Default status strings (shown before live data loads)
// ---------------------------------------------------------------------------

const TILE_STATUS_DEFAULTS: Record<string, string> = {
  // Existing tiles
  'pet-teams': '0 active / 0 teams / 0 slots',
  'shop-restock': '0 tracked / 0 due',
  'public-rooms': '0 rooms / 0 players',
  'journal-checker': '0% / catalog loading',
  'ability-tracker': '0 abilities / 0.0 procs/hr',
  'xp-tracker': '0 XP skills / 0 XP/hr',
  'turtle-timer': '0 turtles / 0 crops / 0 eggs',
  'crop-boosts': '0 boosters / 0 crops / ETA n/a',
  'value-display': '0/4 surfaces / 0 inv / 0 coins',
  'activity-log': '0 saved / 0 replay / watching',
  'locker': 'locker off / 0 slots / 0 fav',
  'crop-calculator': '0 crops / 0 pets / catalogs loading',
  'controller': '0 binds / medium / no gamepad',
  // New tiles
  'garden-filters': 'Off / 0 filters',
  'reminders': '0 ready / 0 pending',
  'garden-stats': '0 species / $0',
  'favorites': 'Off / 0 rules',
  'auto-reconnect': 'Off / 0s delay',
  'shop-keybinds': 'Off',
  'panel-shortcut': 'Alt+Q',
  'guide': 'Game reference',
  'decor-layout': 'External tool',
  'sprite-customizer': 'External tool',
  'celestial-calculator': 'External tool',
  'texture-manipulator': '0 rules / 0 active',
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function getStatusClasses(tone: TileStatusTone, rich = false): string {
  const classes = ['qpm-tile__status'];
  if (rich) classes.push('qpm-tile__status--rich');
  if (tone !== 'normal') classes.push(`qpm-tile__status--${tone}`);
  return classes.join(' ');
}

export function setStatusText(el: HTMLElement | null, text: string, tone: TileStatusTone = 'normal'): void {
  if (!el || !el.isConnected) return;
  el.className = getStatusClasses(tone);
  el.textContent = text;
  el.title = text;
}

export function setStatusRich(
  el: HTMLElement | null,
  nodes: Node[],
  fallbackText: string,
  tone: TileStatusTone = 'normal',
): void {
  if (!el || !el.isConnected) return;
  el.className = getStatusClasses(tone, true);
  el.textContent = '';
  for (const node of nodes) {
    el.appendChild(node);
  }
  el.title = fallbackText;
}

export function makeStatusText(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'qpm-tile-status-text';
  span.textContent = text;
  return span;
}

export function makeStatusSprite(src: string, title: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'qpm-tile-status-sprite';
  img.src = src;
  img.alt = '';
  img.title = title;
  img.draggable = false;
  return img;
}

export function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return '0';
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}b`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  const abs = Math.max(0, Math.abs(ms));
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value)}%`;
}

export function truncateStatusText(value: string, max = 12): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}...`;
}

export function uniqueMapValues<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

export function formatRestockMetric(trackedCount: number, trackedItems: RestockTileItem[]): string {
  if (trackedCount === 0) return '0 tracked / 0 due';
  const now = Date.now();
  const timestamps = trackedItems
    .map((item) => item.estimated_next_timestamp ?? item.predicted_next_ms ?? null)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const due = timestamps.filter((timestamp) => timestamp <= now).length;
  if (due > 0) return `${trackedCount} tracked / ${due} due`;
  const next = timestamps.filter((timestamp) => timestamp > now).sort((a, b) => a - b)[0] ?? null;
  if (next) return `${trackedCount} tracked / next ${formatDurationShort(next - now)}`;
  return `${trackedCount} tracked / ETA n/a`;
}

export function renderShopRestockSprites(
  el: HTMLElement | null,
  trackedKeys: string[],
  items: RestockTileItem[],
  getSpriteUrl: (item: RestockTileItem) => string | null,
  getItemName: (itemId: string, shopType: string) => string,
): void {
  if (!trackedKeys.length) {
    setStatusText(el, 'No tracked items', 'muted');
    return;
  }

  const trackedSet = new Set(trackedKeys);
  const trackedItems = items.filter((item) => trackedSet.has(`${item.shop_type}:${item.item_id}`));
  const spriteWrap = document.createElement('span');
  spriteWrap.className = 'qpm-tile-status-sprites';

  for (const item of trackedItems.slice(0, 4)) {
    const url = getSpriteUrl(item);
    if (!url) continue;
    spriteWrap.appendChild(makeStatusSprite(url, getItemName(item.item_id, item.shop_type)));
  }

  const label = formatRestockMetric(trackedKeys.length, trackedItems);
  if (spriteWrap.childElementCount > 0) {
    setStatusRich(el, [spriteWrap, makeStatusText(label)], label);
    return;
  }

  setStatusText(el, label);
}

// ---------------------------------------------------------------------------
// NEW tile status functions
// ---------------------------------------------------------------------------

function startGardenFiltersStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const el = getStatusEl('garden-filters');
  if (!el) return;

  import('../../features/garden/filters').then(({ getGardenFiltersConfig, subscribeToGardenFiltersConfig }) => {
    if (version !== currentVersion) return;
    const render = (): void => {
      const cfg = getGardenFiltersConfig();
      if (!cfg.enabled) {
        setStatusText(el, t('common.off'), 'muted');
        return;
      }
      const count = cfg.mutations.length + cfg.cropSpecies.length + cfg.eggTypes.length + cfg.growthStates.length;
      setStatusText(el, t('tile.status.enabledFilterCount', { count }), 'positive');
    };
    render();
    const unsub = subscribeToGardenFiltersConfig(render);
    addLiveCleanup(version, unsub);
  }).catch(() => {});
}

function startRemindersStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const el = getStatusEl('reminders');
  if (!el) return;

  Promise.all([
    import('../../features/garden/harvestReminder'),
    import('../../store/mutationSummary'),
  ]).then(([harvest, mutation]) => {
    if (version !== currentVersion) return;
    const render = (): void => {
      const summary = harvest.getHarvestSummary();
      const mutSummary = mutation.getMutationSummary();
      const readyCount = summary.readyCount;
      const pendingCount = mutSummary?.overallPendingFruitCount ?? 0;

      if (readyCount > 0) {
        setStatusText(el, `${readyCount} ready / ${formatCompactNumber(summary.totalValue)} coins`, 'positive');
      } else if (pendingCount > 0) {
        setStatusText(el, `0 ready / ${pendingCount} pending`, 'normal');
      } else {
        setStatusText(el, '0 ready / 0 pending', 'muted');
      }
    };
    render();
    const unsubHarvest = harvest.onHarvestSummary(render, false);
    const unsubMutation = mutation.onMutationSummary(render, false);
    addLiveCleanup(version, () => {
      unsubHarvest();
      unsubMutation();
    });
  }).catch(() => {});
}

function startGardenStatsStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const el = getStatusEl('garden-stats');
  if (!el) return;

  Promise.all([
    import('../../features/garden/bridge'),
    import('../statsHubWindow/tileHelpers'),
  ]).then(([gardenBridge, tileHelpers]) => {
    if (version !== currentVersion) return;
    const render = (snapshot: import('../../features/garden/bridge').GardenSnapshot): void => {
      if (!snapshot) {
        setStatusText(el, '0 species / $0', 'muted');
        return;
      }
      const tiles = tileHelpers.extractTiles(snapshot);
      const speciesSet = new Set(tiles.flatMap(t => t.slots.map(s => s.species)).filter(Boolean));
      const gardenValue = tiles.reduce((sum, t) => sum + tileHelpers.tileValue(t), 0);
      const valueStr = formatCompactNumber(gardenValue);
      setStatusText(el, `${speciesSet.size} species / $${valueStr}`, speciesSet.size > 0 ? 'positive' : 'muted');
    };
    const unsub = gardenBridge.onGardenSnapshot(render);
    addLiveCleanup(version, unsub);
  }).catch(() => {});
}

function startFavoritesStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const el = getStatusEl('favorites');
  if (!el) return;

  import('../../features/standalone/autoFavorite').then(({ getAutoFavoriteConfig, subscribeToAutoFavoriteConfig }) => {
    if (version !== currentVersion) return;
    const render = (): void => {
      const cfg = getAutoFavoriteConfig();
      if (!cfg.enabled) {
        setStatusText(el, t('tile.status.offRuleCount', { count: 0 }), 'muted');
        return;
      }
      const count = cfg.species.length + cfg.mutations.length + cfg.petAbilities.length;
      setStatusText(el, t('tile.status.enabledRuleCount', { count }), 'positive');
    };
    render();
    const unsub = subscribeToAutoFavoriteConfig(render);
    addLiveCleanup(version, unsub);
  }).catch(() => {});
}

function startAutoReconnectStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const el = getStatusEl('auto-reconnect');
  if (!el) return;

  import('../../features/standalone/autoReconnect').then(({ getAutoReconnectConfig, subscribeToAutoReconnectConfig }) => {
    if (version !== currentVersion) return;
    const render = (): void => {
      const cfg = getAutoReconnectConfig();
      if (!cfg.enabled) {
        setStatusText(el, t('common.off'), 'muted');
        return;
      }
      const delay = cfg.delayMs <= 0 ? t('tile.status.instantDelay') : t('tile.status.secondsDelay', { seconds: Math.round(cfg.delayMs / 1000) });
      setStatusText(el, t('tile.status.enabledDelay', { delay }), 'positive');
    };
    render();
    const unsub = subscribeToAutoReconnectConfig(render);
    addLiveCleanup(version, unsub);
  }).catch(() => {});
}

function startShopKeybindsStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const el = getStatusEl('shop-keybinds');
  if (!el) return;

  import('../../features/shop/keybinds').then(({ isShopKeybindsEnabled, getAllShopKeybinds }) => {
    if (version !== currentVersion) return;
    const render = (): void => {
      if (!isShopKeybindsEnabled()) {
        setStatusText(el, t('common.off'), 'muted');
        return;
      }
      const count = Object.keys(getAllShopKeybinds()).length;
      setStatusText(el, t('tile.status.enabledBindCount', { count }), 'positive');
    };
    render();
    const timer = window.setInterval(render, 5_000);
    addLiveCleanup(version, () => window.clearInterval(timer));
  }).catch(() => {});
}

function startPanelShortcutStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const el = getStatusEl('panel-shortcut');
  if (!el) return;

  Promise.all([
    import('../../features/input/panelHotkey'),
    import('../petsWindow/helpers'),
  ]).then(([hotkey, helpers]) => {
    if (version !== currentVersion) return;
    const render = (): void => {
      const combo = hotkey.getPanelToggleKeybind();
      setStatusText(el, helpers.formatKeybind(combo));
    };
    render();
    const unsub = hotkey.onPanelToggleKeybindChange(() => render());
    addLiveCleanup(version, unsub);
  }).catch(() => {});
}

function startTextureManipulatorStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const el = getStatusEl('texture-manipulator');
  if (!el) return;

  import('../../features/standalone/textureSwapper').then(({ getTextureSwapperState }) => {
    if (version !== currentVersion) return;
    const render = (): void => {
      const state = getTextureSwapperState();
      const total = state.rules.length;
      const active = state.rules.filter(r => r.enabled).length;
      if (active > 0) {
        setStatusText(el, t('tile.status.ruleCountActive', { total, active }), 'positive');
      } else if (total > 0) {
        setStatusText(el, t('tile.status.ruleCountActive', { total, active: 0 }), 'normal');
      } else {
        setStatusText(el, t('tile.status.ruleCountActive', { total: 0, active: 0 }), 'muted');
      }
    };
    render();
    const handler = (): void => render();
    window.addEventListener('qpm:texture-manipulator-updated', handler);
    addLiveCleanup(version, () => window.removeEventListener('qpm:texture-manipulator-updated', handler));
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function startAllLiveStatuses(
  getStatusEl: GetStatusEl,
  addLiveCleanup: AddLiveCleanup,
  version: number,
): void {
  currentVersion = version;

  // Set defaults for all tiles
  for (const def of getAllTileDefinitions()) {
    const fallback = TILE_STATUS_DEFAULTS[def.id];
    if (fallback) {
      setStatusText(getStatusEl(def.id), fallback, 'muted');
    }
  }

  // Existing tile statuses (from tileStatusesCore)
  startPetDerivedStatuses(getStatusEl, addLiveCleanup, version);
  startPublicRoomsStatus(getStatusEl, addLiveCleanup, version);
  startShopRestockStatus(getStatusEl, addLiveCleanup, version);
  startJournalStatus(getStatusEl, addLiveCleanup, version);
  startTurtleTimerStatus(getStatusEl, addLiveCleanup, version);
  startCropBoostStatus(getStatusEl, addLiveCleanup, version);
  startValueDisplayStatus(getStatusEl, addLiveCleanup, version);
  startActivityLogStatus(getStatusEl, addLiveCleanup, version);
  startProtectionStatus(getStatusEl, addLiveCleanup, version);
  startCropCalculatorStatus(getStatusEl, addLiveCleanup, version);
  startControllerStatus(getStatusEl, addLiveCleanup, version);

  // New tile statuses
  startGardenFiltersStatus(getStatusEl, addLiveCleanup, version);
  startRemindersStatus(getStatusEl, addLiveCleanup, version);
  startGardenStatsStatus(getStatusEl, addLiveCleanup, version);
  startFavoritesStatus(getStatusEl, addLiveCleanup, version);
  startAutoReconnectStatus(getStatusEl, addLiveCleanup, version);
  startShopKeybindsStatus(getStatusEl, addLiveCleanup, version);
  startPanelShortcutStatus(getStatusEl, addLiveCleanup, version);
  // guide, decor-layout, sprite-customizer, celestial-calculator are static — defaults only
  startTextureManipulatorStatus(getStatusEl, addLiveCleanup, version);
}
