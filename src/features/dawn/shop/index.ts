// shopRestockAlerts already handles Dawn stock detection/alert creation; this module
// only clears those alerts when Dawn weather ends.

import { onWeatherSnapshot, type WeatherSnapshot } from '../../../store/weatherHub';
import { activeAlerts } from '../../../ui/shop/restockAlerts/alertState';
import { removeAlert } from '../../../ui/shop/restockAlerts/alertDom';
import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import type { Subsystem } from '../../../diagnostics/types';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:dawnShop';
const diag = createNamedLogger(FEATURE_SUBSYSTEM);
let busRegistered = false;

function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(FEATURE_SUBSYSTEM, { category: 'feature', status: 'starting' });
}

function publishOk(message: string, metrics?: Record<string, number | string>): void {
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

let weatherUnsubscribe: (() => void) | null = null;
let lastWeatherKind: string | null = null;

function clearDawnAlerts(): void {
  let cleared = 0;
  for (const [key, active] of activeAlerts) {
    if (active.model.shopType === 'dawn') {
      removeAlert(key);
      cleared++;
    }
  }
  if (cleared > 0) {
    diag.debug(`Cleared ${cleared} Dawn alert(s) — weather ended`);
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
  ensureBusRegistered();
  weatherUnsubscribe = onWeatherSnapshot(handleWeatherChange, true);
  publishOk('Started');
}

export function stopDawnShopTracker(): void {
  weatherUnsubscribe?.();
  weatherUnsubscribe = null;
  lastWeatherKind = null;
}
