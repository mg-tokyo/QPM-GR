// src/features/dawnShop/index.ts
// Dawn Shop weather-gated lifecycle: clears Dawn alerts when Dawn weather ends.
// The existing shopRestockAlerts pipeline handles Dawn stock detection and alert
// creation automatically (via ShopCategory 'dawn'). This module adds the
// weather-bound cleanup behavior.

import { log } from '../../../utils/logger';
import { onWeatherSnapshot, type WeatherSnapshot } from '../../../store/weatherHub';
import { activeAlerts } from '../../../ui/shop/restockAlerts/alertState';
import { removeAlert } from '../../../ui/shop/restockAlerts/alertDom';

let weatherUnsubscribe: (() => void) | null = null;
let lastWeatherKind: string | null = null;

/**
 * Remove all Dawn shop alerts from the active alert set.
 * Called when Dawn weather ends.
 */
function clearDawnAlerts(): void {
  let cleared = 0;
  for (const [key, active] of activeAlerts) {
    if (active.model.shopType === 'dawn') {
      removeAlert(key);
      cleared++;
    }
  }
  if (cleared > 0) {
    log(`[DawnShop] Cleared ${cleared} Dawn alert(s) — weather ended`);
  }
}

function handleWeatherChange(snapshot: WeatherSnapshot): void {
  const wasDawn = lastWeatherKind === 'dawn';
  const isDawn = snapshot.kind === 'dawn';
  lastWeatherKind = snapshot.kind;

  if (wasDawn && !isDawn) {
    clearDawnAlerts();
  }
}

export function startDawnShopTracker(): void {
  if (weatherUnsubscribe) return;
  lastWeatherKind = null;
  weatherUnsubscribe = onWeatherSnapshot(handleWeatherChange, true);
  log('[DawnShop] Tracker started');
}

export function stopDawnShopTracker(): void {
  weatherUnsubscribe?.();
  weatherUnsubscribe = null;
  lastWeatherKind = null;
}
