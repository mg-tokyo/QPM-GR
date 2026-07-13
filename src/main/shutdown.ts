import { timerManager } from '../utils/scheduling/timerManager';
import { stopController } from '../features/input/controller/index';
import { stopShopKeybinds } from '../features/shop/keybinds';
import { stopShopEnhancer } from '../features/shop/enhancer/index';
import { stopPanelHotkey } from '../features/input/panelHotkey';
import { stopAntiAfk } from '../features/standalone/antiAfk';
import { stopActivityLogEnhancer } from '../features/activity/activityLogNativeEnhancer';
import { stopAbilityTriggerStore } from '../store/abilityLogs';
import { stopNativeFeedIntercept } from '../features/pets/nativeFeedIntercept';
import { stopPetTeamsStore } from '../store/petTeams';
import { stopPetTeamsLogs } from '../store/petTeamsLogs';
import { stopPetsWindow } from '../ui/pets/petsWindow';
import { stopInventoryCapacityOverlay } from '../ui/economy/inventoryCapacityOverlay';
import { stopInventoryCapacity } from '../features/economy/inventoryCapacity';
import { stopStorageValueOverlay } from '../ui/economy/storageValueOverlay';
import { stopStorageValue } from '../features/economy/storageValue';
import { stopSeedSiloStore } from '../store/seedSilo';
import { stopDecorShedStore } from '../store/decorShed';
import { stopDawnShopTracker } from '../features/dawn/shop';
import { stopCapsuleTracker } from '../features/dawn/capsule';
import { stopChargedAbilities } from '../features/chargedAbilities';
import { stopDawnCaptureTracker } from '../features/dawn/capture';
import { stopThunderchargerTracker } from '../features/thunder/charger';
import { destroyDawnEconomy } from '../store/dawnEconomy';
import { stopMountStateTracker } from '../store/mountState';
import { stopPetInfoStore } from '../store/pets';
import { stopInventoryStore } from '../store/inventory';
import { stopHutchStore } from '../store/hutch';
import { stopWeatherHub } from '../store/weatherHub';
import { destroyEconomyTracker } from '../store/economyTracker';
import { stopNativeSendObserver } from '../websocket/nativeSendObserver';
import { stopWebsocketDiagnostics } from '../websocket/api';
import { stopCatalogsDiagnostics } from '../catalogs/catalogLoader';
import { stopJotaiBridgeDiagnostics } from '../core/jotaiBridge';
import { stopSpriteV2Diagnostics } from '../sprite-v2/index';
import { stopRestockDataDiagnostics } from '../utils/restock/dataService';
import { stopVersionChecker } from '../utils/versionChecker';
import { stopBloblingPresets } from '../features/bloblingCustomiser/presets/store';
import { stopGardenPainterPresets } from '../features/standalone/textureSwapper/presets/store';
import { teardownDiagnostics } from '../diagnostics/init';

// Live holder for one-shot disposers set during init() and consumed at
// beforeunload. These subsystems return closures instead of exposing named
// stop fns the way other subsystems do.
// QPM FULL PRIVATE's apply-transforms.js anchors automation stop injection to
// the antiAfk import line above and to the stopAntiAfk() call — keep literal.
export const disposers = {
  // RiveEngine is started during init() and stopped in beforeunload.
  riveEngine: null as (() => void) | null,
  // Blobling custom skins — installed early in init so the fetch interceptor
  // catches startup cosmetic requests; torn down near riveEngine.
  customSkins: null as (() => void) | null,
  // The .riv fetch interceptor installs MUCH earlier than initRiveEngine —
  // before the game's own startup fetches its avatar/currency .riv bundles.
  rivFetchInterceptor: null as (() => void) | null,
  // The Object.prototype.runtime setter trap that catches the
  // @rive-app/canvas-advanced rive instance the moment a RiveFile constructor
  // runs. Auto-removes itself once both expected runtimes are wrapped.
  canvasRuntimeTrap: null as (() => void) | null,
};

// Global error filter to silence noisy external proxy errors
const _errorHandler = (event: ErrorEvent): boolean => {
  try {
    const message = String(event?.message || '');
    if (message.includes("Failed to execute 'contains' on 'Node'")) {
      event.stopImmediatePropagation?.();
      event.preventDefault?.();
      return false;
    }
  } catch {}
  return true;
};

export function installGlobalHandlers(): void {
  window.addEventListener('error', _errorHandler, true);
  window.addEventListener('beforeunload', () => {
    window.removeEventListener('error', _errorHandler, true);
    stopController();
    stopShopKeybinds();
    stopShopEnhancer();
    stopPanelHotkey();
    // stopAutoReconnect() — auto reconnect disabled
    stopAntiAfk();
    stopActivityLogEnhancer();
    stopAbilityTriggerStore();
    timerManager.destroy();
    stopNativeFeedIntercept();
    stopPetTeamsStore();
    stopPetTeamsLogs();
    stopPetsWindow();
    stopInventoryCapacityOverlay();
    stopInventoryCapacity();
    stopStorageValueOverlay();
    stopStorageValue();
    stopSeedSiloStore();
    stopDecorShedStore();
    stopDawnShopTracker();
    stopCapsuleTracker();
    stopChargedAbilities();
    stopDawnCaptureTracker();
    stopThunderchargerTracker();
    destroyDawnEconomy();
    stopMountStateTracker();
    stopPetInfoStore();
    stopInventoryStore();
    stopHutchStore();
    stopWeatherHub();
    destroyEconomyTracker();
    stopNativeSendObserver();
    stopWebsocketDiagnostics();
    stopCatalogsDiagnostics();
    stopJotaiBridgeDiagnostics();
    stopSpriteV2Diagnostics();
    stopRestockDataDiagnostics();
    stopVersionChecker();
    try { disposers.riveEngine?.(); } catch { /* best effort */ }
    disposers.riveEngine = null;
    // Custom skins interceptor tears down before the rive fetch interceptor
    // since it installed AFTER it (LIFO chain — spec §2.4).
    try { disposers.customSkins?.(); } catch { /* best effort */ }
    disposers.customSkins = null;
    try { stopBloblingPresets(); } catch { /* best effort */ }
    try { stopGardenPainterPresets(); } catch { /* best effort */ }
    try { disposers.rivFetchInterceptor?.(); } catch { /* best effort */ }
    disposers.rivFetchInterceptor = null;
    try { disposers.canvasRuntimeTrap?.(); } catch { /* best effort */ }
    disposers.canvasRuntimeTrap = null;
    teardownDiagnostics();
  }, { once: true });
}
