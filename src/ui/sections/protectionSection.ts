// src/ui/sections/protectionSection.ts — Unified Protection (Locker + Inventory Capacity)

import { t } from '../../i18n';
import { log } from '../../utils/logger';

export function createProtectionSection(): { element: HTMLElement; cleanup: () => void } {
  const cleanups: Array<() => void> = [];

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

  // Section: Locks
  const locksHeader = document.createElement('div');
  locksHeader.style.cssText = 'font-size:12px;font-weight:600;color:#8f82ff;text-transform:uppercase;letter-spacing:0.5px;';
  locksHeader.textContent = t('feature.protection.locksHeader');

  const locksContent = document.createElement('div');
  locksContent.style.cssText = 'min-height:60px;';

  // Section: Capacity
  const capacityHeader = document.createElement('div');
  capacityHeader.style.cssText = 'font-size:12px;font-weight:600;color:#8f82ff;text-transform:uppercase;letter-spacing:0.5px;margin-top:8px;';
  capacityHeader.textContent = t('feature.protection.capacityHeader');

  const capacityContent = document.createElement('div');
  capacityContent.style.cssText = 'min-height:60px;';

  container.append(locksHeader, locksContent, capacityHeader, capacityContent);

  // Load both sections
  (async () => {
    try {
      const { createLockerSection } = await import('./lockerSection');
      locksContent.appendChild(createLockerSection());
    } catch (err) {
      log('⚠️ Failed to load Locker section', err);
      locksContent.textContent = `❌ ${t('common.loadError')}`;
    }
  })();

  (async () => {
    try {
      const { createInventoryCapacitySection } = await import('./inventoryCapacitySection');
      capacityContent.appendChild(createInventoryCapacitySection());
    } catch (err) {
      log('⚠️ Failed to load Capacity section', err);
      capacityContent.textContent = `❌ ${t('common.loadError')}`;
    }
  })();

  (async () => {
    try {
      const [{ buildInventoryReserveCard }, { getLockerConfig }] = await Promise.all([
        import('./lockerTabPanels'),
        import('../../features/locker/index'),
      ]);
      capacityContent.appendChild(buildInventoryReserveCard(getLockerConfig()));
    } catch (err) {
      log('⚠️ Failed to load Inventory Reserve', err);
    }
  })();

  return {
    element: container,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; },
  };
}
