import type { AlertGroup, AlertRowDef } from '../../features/alertHub';
import { getInventoryCapacityConfig, getInventoryCapacityState, subscribeToInventoryCapacityConfig, updateInventoryCapacityConfig } from '../../features/economy/inventoryCapacity';
import { getConfig as getReminderConfig } from '../../features/mutations/reminder';
import { readSync } from '../../core/gameState';
import { getAnySpriteDataUrl, isSpritesReady } from '../../sprite-v2/compat';
import { loadTrackedSet } from '../../store/restockTracked';
import { getWeatherDefSafe } from '../../utils/game/catalogHelpers';
import { t } from '../../i18n';
import { getTileDefinition } from '../panel/tileRegistry';
import { openPopupSilencerWindow } from '../pets/popupSilencerWindow';
import { getPinLook } from '../shop/restockAlerts/itemLook';
import { getRestockCardSize, PIN_ROW_ID, previewRestockCardSize, setRestockCardSize } from '../shop/restockAlerts/cardSize';
import { closeForecastWidget, isForecastWidgetOpen, onForecastWidgetOpenChange, openForecastWidget } from '../forecastWidget';
import { POPUPS_LOOK } from './popupsLook';

/** Drag previews on the open cards; release stores. */
export interface CardSizeHooks {
  get(): number;
  preview(size: number): void;
  commit(size: number): void;
}

/** Producers that keep their own controls (ALR-9 PD3): the centre links to them and adds no flag. */
export interface LinkedRow extends Pick<AlertRowDef, 'icon' | 'summary' | 'accent'> {
  id: string;
  group: AlertGroup;
  labelKey: string;
  noteKey: string;
  /** Opens the producer's own window. */
  open: () => void;
  toggle?: {
    get(): boolean;
    set(on: boolean): void;
    subscribe(cb: (on: boolean) => void): () => void;
  };
  cardSize?: CardSizeHooks;
  /** The producer sends desktop notifications under this row id (ALR-13 PD2: pins via `desktopRelay.ts`). */
  desktop?: boolean;
}

const openTile = (tileId: string) => (): void => { getTileDefinition(tileId)?.action(); };

// Keys checked in the live atlas 2026-11-15 (ALR-17 PD1; `ForecastDay` is beta-only, so SunnyIcon).
const SPRITE_PINS = 'sprite/ui/SeedsRestocked';
const SPRITE_BAG = 'sprite/ui/InventoryBag';
const SPRITE_REMINDER = 'sprite/ui/WeatherStationIcon';
const SPRITE_FORECAST = 'sprite/ui/SunnyIcon';

function uiSprite(key: string | null): string | null {
  return key && isSpritesReady() ? getAnySpriteDataUrl(key) || null : null;
}

function restockSummary(): string {
  const count = loadTrackedSet().size;
  return count > 0 ? t('feature.alertCentre.linked.restockSummary', { count }) : t('feature.alertCentre.linked.restockSummaryNone');
}

function reminderSummary(): string {
  const { enabled, showNotifications, highlightPlants } = getReminderConfig();
  if (!enabled || (!showNotifications && !highlightPlants)) return t('feature.alertCentre.linked.reminderOff');
  if (showNotifications && highlightPlants) return t('feature.alertCentre.linked.reminderBoth');
  return t(showNotifications ? 'feature.alertCentre.linked.reminderPopups' : 'feature.alertCentre.linked.reminderHighlights');
}

function currentWeatherDef(): ReturnType<typeof getWeatherDefSafe> {
  const weather = readSync('weather');
  return weather ? getWeatherDefSafe(weather) : null;
}

function forecastSummary(): string {
  const def = currentWeatherDef();
  return def ? t('feature.alertCentre.linked.forecastSummary', { weather: def.name }) : t('feature.alertCentre.linked.forecastSummaryClear');
}

// Mutation reminder has no toggle here: mutationValueSection.ts:44 re-applies its own stored flag on load.
export function getLinkedRows(): LinkedRow[] {
  return [
    {
      id: PIN_ROW_ID,
      group: 'shops',
      labelKey: 'feature.alertCentre.linked.restock',
      noteKey: 'feature.alertCentre.linked.restockNote',
      open: openTile('shop-restock'),
      cardSize: { get: getRestockCardSize, preview: previewRestockCardSize, commit: (v) => { setRestockCardSize(v); } },
      desktop: true,
      icon: () => (isSpritesReady() ? getPinLook(loadTrackedSet()).iconUrl : null) ?? uiSprite(SPRITE_PINS),
      summary: restockSummary,
      accent: () => getPinLook(loadTrackedSet()).accent ?? 'var(--qpm-accent)',
    },
    {
      id: 'linked.popups',
      group: 'pets',
      labelKey: 'feature.alertCentre.linked.popups',
      noteKey: 'feature.alertCentre.linked.popupsNote',
      open: openPopupSilencerWindow,
      ...POPUPS_LOOK,
    },
    {
      id: 'linked.bagFull',
      group: 'garden',
      labelKey: 'feature.alertCentre.linked.bagFull',
      noteKey: 'feature.alertCentre.linked.ownSound',
      open: openTile('inventory-capacity'),
      toggle: {
        get: () => getInventoryCapacityConfig().enabled,
        set: (on) => { updateInventoryCapacityConfig({ enabled: on }); },
        subscribe: (cb) => subscribeToInventoryCapacityConfig((cfg) => { cb(cfg.enabled); }),
      },
      icon: () => uiSprite(SPRITE_BAG),
      summary: () => t('feature.alertCentre.linked.bagFullSummary', {
        threshold: getInventoryCapacityConfig().warningThreshold,
        max: getInventoryCapacityState().max,
      }),
      accent: 'var(--qpm-warning)',
    },
    {
      id: 'linked.mutationReminder',
      group: 'garden',
      labelKey: 'feature.alertCentre.linked.mutationReminder',
      noteKey: 'feature.alertCentre.linked.ownWindow',
      open: openTile('reminders'),
      icon: () => uiSprite(SPRITE_REMINDER),
      summary: reminderSummary,
      accent: 'var(--qpm-positive)',
    },
    {
      id: 'linked.forecast',
      group: 'garden',
      labelKey: 'feature.alertCentre.linked.forecast',
      noteKey: 'feature.alertCentre.linked.forecastNote',
      open: openForecastWidget,
      toggle: {
        get: isForecastWidgetOpen,
        set: (on) => { if (on) openForecastWidget(); else closeForecastWidget(); },
        subscribe: onForecastWidgetOpenChange,
      },
      icon: () => uiSprite(currentWeatherDef()?.spriteKey ?? null) ?? uiSprite(SPRITE_FORECAST),
      summary: forecastSummary,
      accent: 'var(--qpm-info)',
    },
  ];
}
