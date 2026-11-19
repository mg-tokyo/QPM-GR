import { clampCardSize, getAlertRowSettings, getRowCardSize, writeRowCardSize } from '../../../features/alertHub/settings';
import { activeAlerts } from './alertState';
import { applyCardScale } from './cardShell';

/** The centre's restock row; its stored row holds the pin Desktop tick (ALR-13 PD2) and the card size. */
export const PIN_ROW_ID = 'linked.restock';

/** One size for every restock and weather card (user 2026-11-16, ALR-17.11b). */
export function getRestockCardSize(): number {
  return getRowCardSize(PIN_ROW_ID);
}

export function previewRestockCardSize(size: number): void {
  const scale = clampCardSize(size);
  for (const active of activeAlerts.values()) applyCardScale(active.root, scale);
}

export function setRestockCardSize(size: number): number {
  const next = writeRowCardSize(PIN_ROW_ID, size, getAlertRowSettings(PIN_ROW_ID, 'none'));
  previewRestockCardSize(next);
  return next;
}
