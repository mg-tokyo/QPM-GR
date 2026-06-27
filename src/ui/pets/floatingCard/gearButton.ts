// src/ui/pets/floatingCard/gearButton.ts
// Feed-keybind gear button + its popup. Extracted so the main card module
// stays under the 750-line hard limit.

import { getFeedKeybind, setFeedKeybind, clearFeedKeybind } from '../../../features/pets/feedKeybinds';
import { createKeybindButton, formatKeybind } from '../petsWindow/helpers';

export interface GearButtonHandle {
  el: HTMLButtonElement;
  /** Cleanup any popup listeners. Called from the card's onDestroy. */
  dispose: () => void;
}

export function createFeedKeybindGearButton(slotIndex: number): GearButtonHandle {
  const cleanups: Array<() => void> = [];
  const gearBtn = document.createElement('button');
  gearBtn.type = 'button';
  gearBtn.style.cssText = 'background:none;border:none;font-size:11px;color:rgba(224,224,224,0.4);cursor:pointer;padding:2px;flex-shrink:0;transition:color 0.12s;';
  gearBtn.textContent = '⚙';
  gearBtn.title = `Feed keybind: ${formatKeybind(getFeedKeybind(slotIndex)) || 'none'}`;

  let gearPopup: HTMLElement | null = null;

  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (gearPopup) {
      gearPopup.remove();
      gearPopup = null;
      return;
    }
    gearPopup = document.createElement('div');
    gearPopup.style.cssText = 'position:fixed;z-index:2147483647;background:rgba(14,17,25,0.98);border:1px solid rgba(143,130,255,0.35);border-radius:6px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,0.5);display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(224,224,224,0.7);';
    gearPopup.textContent = 'Feed key: ';
    const kbBtn = createKeybindButton({
      onSet(combo) {
        setFeedKeybind(slotIndex, combo);
        gearBtn.title = `Feed keybind: ${formatKeybind(combo)}`;
        if (gearPopup) { gearPopup.remove(); gearPopup = null; }
      },
      onClear() {
        clearFeedKeybind(slotIndex);
        gearBtn.title = 'Feed keybind: none';
        if (gearPopup) { gearPopup.remove(); gearPopup = null; }
      },
      readCurrent: () => getFeedKeybind(slotIndex),
      width: '80px',
    });
    gearPopup.appendChild(kbBtn);
    document.body.appendChild(gearPopup);
    const rect = gearBtn.getBoundingClientRect();
    gearPopup.style.left = `${Math.max(8, Math.round(rect.left))}px`;
    gearPopup.style.top = `${Math.round(rect.bottom + 4)}px`;
    const closePopup = (ev: MouseEvent): void => {
      if (gearPopup && !gearPopup.contains(ev.target as Node) && ev.target !== gearBtn) {
        gearPopup.remove();
        gearPopup = null;
        document.removeEventListener('mousedown', closePopup, true);
      }
    };
    document.addEventListener('mousedown', closePopup, true);
    cleanups.push(() => {
      document.removeEventListener('mousedown', closePopup, true);
      if (gearPopup) { gearPopup.remove(); gearPopup = null; }
    });
  });
  gearBtn.addEventListener('mouseenter', () => { gearBtn.style.color = 'rgba(224,224,224,0.7)'; });
  gearBtn.addEventListener('mouseleave', () => { gearBtn.style.color = 'rgba(224,224,224,0.4)'; });

  return {
    el: gearBtn,
    dispose: () => {
      for (const fn of cleanups) {
        try { fn(); } catch { /* ignore */ }
      }
      cleanups.length = 0;
    },
  };
}
