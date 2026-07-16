/**
 * Controller feature lifecycle orchestrator.
 * Replaces MG-Controller/src/main.ts — adapted for QPM's window system.
 */

import { Cursor } from './cursor';
import { GamepadPoller } from './gamepad';
import {
  loadBindings,
  loadCursorSpeed,
  saveBindings,
  CURSOR_SPEED_VALUES,
  type Action,
  type CursorSpeed,
} from './bindings';
import { tapKey, cycleHotbar, deselectHotbarSlot } from './synthesis';
import { initPetSlotAtoms, cyclePetSlot, isGrowSlotContextActive } from './controllerContext';
import { toggleWindow } from '../../../ui/core/modalWindow';
import { warnFeature } from './_diagnostics';

// ---------------------------------------------------------------------------
// Action handler — called by GamepadPoller on rising-edge button press
// ---------------------------------------------------------------------------

async function handleAction(action: Action, cursor: Cursor): Promise<void> {
  switch (action) {
    case 'primaryAction': {
      if (cursor.isVisible()) {
        cursor.click();
      } else {
        tapKey(' ');
      }
      break;
    }
    case 'back':
      tapKey('Escape');
      break;
    case 'inventory':
      tapKey('e');
      break;
    case 'rotateDecor':
      tapKey('r');
      break;
    case 'prevHotbarSlot':
      isGrowSlotContextActive() ? tapKey('x') : cycleHotbar('prev');
      break;
    case 'nextHotbarSlot':
      isGrowSlotContextActive() ? tapKey('c') : cycleHotbar('next');
      break;
    case 'prevPetSlot':
      await cyclePetSlot('prev');
      break;
    case 'nextPetSlot':
      await cyclePetSlot('next');
      break;
    case 'zoomIn':
      tapKey('=');
      break;
    case 'zoomOut':
      tapKey('-');
      break;
    case 'cursorClick':
      cursor.click();
      break;
    case 'openSettings':
      document.dispatchEvent(new CustomEvent('qpm:controller:openSettings'));
      break;
    case 'deselectSlot':
      deselectHotbarSlot();
      break;
    case 'nextGrowSlot':
      tapKey('c');
      break;
    case 'prevGrowSlot':
      tapKey('x');
      break;
  }
}

// ---------------------------------------------------------------------------
// Main initializer
// ---------------------------------------------------------------------------

export interface ControllerRuntime {
  poller: GamepadPoller;
  cursor: Cursor;
  cleanup: () => void;
}

/**
 * Initializes the controller feature. Returns the live runtime + a cleanup fn.
 */
export async function initializeController(): Promise<ControllerRuntime> {
  const bindings = loadBindings();
  const speed: CursorSpeed = loadCursorSpeed();
  const cursor = new Cursor(CURSOR_SPEED_VALUES[speed]);

  // Fire-and-forget — resolves when pet slot atoms are found (enables RT/LT)
  void initPetSlotAtoms();

  const poller = new GamepadPoller(
    bindings,
    cursor,
    (action) => { void handleAction(action, cursor); },
    (_profile) => { /* profile change handled live by badge listeners in UI */ },
  );
  poller.start();

  // Listen for settings open (dispatched by the openSettings action)
  const onOpenSettings = (): void => {
    toggleWindow(
      'utility-feature-controller',
      '🎮 Controller Settings',
      (windowRoot) => {
        windowRoot.style.cssText =
          'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../../ui/sections/controllerSection').then(({ createControllerSection }) => {
          windowRoot.appendChild(createControllerSection(poller, cursor));
        }).catch((err) => {
          warnFeature('QPM-FEATURE-004', { what: 'settingsSection:load' }, err);
        });
      },
      '580px',
      '78vh',
    );
  };
  document.addEventListener('qpm:controller:openSettings', onOpenSettings);

  return {
    poller,
    cursor,
    cleanup: (): void => {
      poller.stop();
      cursor.destroy();
      document.removeEventListener('qpm:controller:openSettings', onOpenSettings);
    },
  };
}
