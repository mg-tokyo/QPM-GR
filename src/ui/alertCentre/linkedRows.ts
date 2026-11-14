import type { AlertGroup } from '../../features/alertHub';
import { getInventoryCapacityConfig, subscribeToInventoryCapacityConfig, updateInventoryCapacityConfig } from '../../features/economy/inventoryCapacity';
import { getTileDefinition } from '../panel/tileRegistry';
import { openPopupSilencerWindow } from '../pets/popupSilencerWindow';
import { closeForecastWidget, isForecastWidgetOpen, onForecastWidgetOpenChange, openForecastWidget } from '../forecastWidget';

/** Producers that keep their own controls (ALR-9 PD3): the centre links to them and adds no flag. */
export interface LinkedRow {
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
}

const openTile = (tileId: string) => (): void => { getTileDefinition(tileId)?.action(); };

// Mutation reminder has no toggle here: mutationValueSection.ts:44 re-applies its own stored flag on load.
export function getLinkedRows(): LinkedRow[] {
  return [
    { id: 'linked.restock', group: 'shops', labelKey: 'feature.alertCentre.linked.restock', noteKey: 'feature.alertCentre.linked.restockNote', open: openTile('shop-restock') },
    { id: 'linked.popups', group: 'pets', labelKey: 'feature.alertCentre.linked.popups', noteKey: 'feature.alertCentre.linked.popupsNote', open: openPopupSilencerWindow },
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
    },
    { id: 'linked.mutationReminder', group: 'garden', labelKey: 'feature.alertCentre.linked.mutationReminder', noteKey: 'feature.alertCentre.linked.ownWindow', open: openTile('reminders') },
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
    },
  ];
}
