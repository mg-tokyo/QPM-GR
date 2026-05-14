// src/ui/sections/protectionSection.ts — Protection (Locker)
// Inventory Capacity and Reserve are now inside the Locker's Garden QOL tab.

import { t } from '../../i18n';
import { log } from '../../utils/logger';

export function createProtectionSection(): { element: HTMLElement; cleanup: () => void } {
  const cleanups: Array<() => void> = [];

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

  const locksContent = document.createElement('div');
  locksContent.style.cssText = 'min-height:60px;';
  container.appendChild(locksContent);

  (async () => {
    try {
      const { createLockerSection } = await import('./lockerSection');
      locksContent.appendChild(createLockerSection());
    } catch (err) {
      log('Failed to load Locker section', err);
      locksContent.textContent = `${t('common.loadError')}`;
    }
  })();

  return {
    element: container,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; },
  };
}
