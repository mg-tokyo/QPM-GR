import { diag, warnCore } from './_diagnostics';
import { yieldToBrowser } from '../utils/scheduling/scheduling';
import { initializeAntiAfk } from '../features/standalone/antiAfk';
import { startInventoryStore } from '../store/inventory';
import { startHutchStore } from '../store/hutch';
import { startSeedSiloStore } from '../store/seedSilo';
import { startDecorShedStore } from '../store/decorShed';
import { startPetInfoStore } from '../store/pets';
import { startAbilityTriggerStore } from '../store/abilityLogs';
import { startActivityLogEnhancer, isActivityLogEnhancerEnabled } from '../features/activity/activityLogNativeEnhancer';
import { initializeStatsStore } from '../store/stats';
import { initializePetXpTracker } from '../store/petXpTracker';
import { initializeXpTracker } from '../store/xpTracker';
import { initializeMutationValueTracking } from '../features/mutations/valueTracking';
import { initEconomyTracker } from '../store/economyTracker';
import { initializeAutoFavorite } from '../features/standalone/autoFavorite';
import { startBulkFavorite } from '../features/standalone/bulkFavorite';
import { initializeFoodRules } from '../features/pets/foodRules';
import { startSellSnapshotWatcher } from '../store/sellSnapshot';
import { initPetTeamsStore } from '../store/petTeams';
import { initPetTeamsLogs } from '../store/petTeamsLogs';
import { startGardenBridge } from '../features/garden/bridge';
import { initializeGardenFilters } from '../features/garden/filters';
import { initializeHarvestReminder, configureHarvestReminder } from '../features/garden/harvestReminder';
import { initializeTurtleTimer, configureTurtleTimer } from '../features/pets/turtleTimer';
import { startMutationReminder } from '../features/mutations/reminder';
import { startMutationTracker } from '../features/mutations/tracker';
import { startMountStateTracker } from '../store/mountState';
import { startLocker } from '../features/locker/index';
import { startGardenQol } from '../features/gardenQol/index';
import { startCropBoostTracker } from '../features/pets/cropBoostTracker';
import { startPetOptimizer } from '../features/pets/optimizer';
import { initTooltipInjection } from '../features/standalone/tooltipInjection';
import { startNativeFeedIntercept } from '../features/pets/nativeFeedIntercept';
import { startController } from '../features/input/controller/index';
import { startShopKeybinds } from '../features/shop/keybinds';
import { startShopEnhancer } from '../features/shop/enhancer/index';
import { startStorageValue } from '../features/economy/storageValue';
import { startStorageValueOverlay } from '../ui/economy/storageValueOverlay';
import { startInventoryCapacity } from '../features/economy/inventoryCapacity';
import { startInventoryCapacityOverlay } from '../ui/economy/inventoryCapacityOverlay';
import { initTextureSwapper, TEXTURE_MANIPULATOR_ENABLED } from '../features/standalone/textureSwapper';
import { exposeAriesBridge } from '../integrations/ariesBridge';
import { startNativeCardViewDiagnostics } from '../integrations/nativeCardView';
import type { QpmConfig } from './config';

// Store/feature init ladder (init phases 1–9). Sequencing and yield points
// are load-bearing — do not reorder without checking dependents.
// QPM FULL PRIVATE's apply-transforms.js anchors automation injection to the
// antiAfk import line above and to the "Phase 3" comment — keep both literal.
export async function runFeaturePhases(cfg: QpmConfig): Promise<void> {
  await initializeAntiAfk().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:antiAfk' }, error);
  });
  await startInventoryStore().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:inventoryStore' }, error);
  });
  await startHutchStore().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:hutchStore' }, error);
  });
  await startSeedSiloStore().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:seedSiloStore' }, error);
  });
  await startDecorShedStore().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:decorShedStore' }, error);
  });
  await yieldToBrowser();
  await startPetInfoStore().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:petInfoStore' }, error);
  });
  await startAbilityTriggerStore().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:abilityTriggerStore' }, error);
  });
  await yieldToBrowser();
  if (isActivityLogEnhancerEnabled()) {
    await startActivityLogEnhancer().catch((error) => {
      warnCore('QPM-INIT-001', { what: 'phase:activityLog' }, error);
    });
  } else {
    diag.debug('Activity Log enhancer disabled by config');
  }
  // OPTIMIZATION: Initialize core stores in batches with yields to prevent main thread blocking
  // Phase 1: Critical stores that other features depend on
  initializeStatsStore();
  initializePetXpTracker();
  const { startFriendBonusStore } = await import('../store/friendBonus');
  startFriendBonusStore();
  await yieldToBrowser(); // Let browser paint

  // Phase 2: XP tracking and inventory
  initializeXpTracker();
  initializeMutationValueTracking();
  const { initHatchStatsStore } = await import('../store/hatchStatsStore');
  initHatchStatsStore();
  initEconomyTracker().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:economyTracker' }, error);
  });
  await yieldToBrowser();
  const { startPetHatchingTracker } = await import('../store/petHatchingTracker');
  await startPetHatchingTracker().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'phase:petHatchingTracker' }, error);
  });
  await yieldToBrowser();

  // Phase 3: Auto-favorite and bulk operations
  initializeAutoFavorite();
  startBulkFavorite();
  initializeFoodRules();
  await startSellSnapshotWatcher();
  await yieldToBrowser();

  // Phase 3b: Pet Teams (needs inventory + pet stores ready)
  initPetTeamsLogs();
  initPetTeamsStore();
  await yieldToBrowser();

  // Phase 4: Garden bridge (needed for reminders)
  await startGardenBridge();
  await yieldToBrowser();

  // Phase 4b: Initialize garden filters (needs PIXI and game loaded)
  initializeGardenFilters();
  await yieldToBrowser();

  // Phase 5: Initialize harvest and turtle timer
  initializeHarvestReminder({
    enabled: cfg.harvestReminder.enabled,
    highlightEnabled: cfg.harvestReminder.highlightEnabled,
    toastEnabled: cfg.harvestReminder.toastEnabled,
    minSize: cfg.harvestReminder.minSize,
    selectedMutations: cfg.harvestReminder.selectedMutations,
  });
  initializeTurtleTimer(cfg.turtleTimer);
  await yieldToBrowser();

  // Phase 6: Mutation tracking
  startMutationReminder();
  startMutationTracker();
  await yieldToBrowser();

  // Phase 7: Configure features
  configureHarvestReminder({
    enabled: cfg.harvestReminder.enabled,
    highlightEnabled: cfg.harvestReminder.highlightEnabled,
    toastEnabled: cfg.harvestReminder.toastEnabled,
    minSize: cfg.harvestReminder.minSize,
    selectedMutations: cfg.harvestReminder.selectedMutations,
  });
  configureTurtleTimer(cfg.turtleTimer);
  await yieldToBrowser();

  // Phase 7b: nativeSendObserver starts on-demand via first onNativeSend() call
  startMountStateTracker();

  // Phase 7c: Action guard
  startLocker();
  startGardenQol();
  await yieldToBrowser();

  // Phase 8: Non-critical features (can load after UI is visible)
  startCropBoostTracker();
  startPetOptimizer();
  initTooltipInjection();
  startNativeFeedIntercept();
  await yieldToBrowser();
  startController();
  startShopKeybinds();
  startShopEnhancer();
  startStorageValue();
  await yieldToBrowser();
  startStorageValueOverlay();
  startInventoryCapacity();
  startInventoryCapacityOverlay();
  // RiveEngine: started in init(), right after initCatalogLoader, to race
  // ahead of the game's first rive.load(). Texture swapper depends on the
  // engine being initialized — it is, by this phase.
  if (TEXTURE_MANIPULATOR_ENABLED) {
    initTextureSwapper();
    // Expose the gating diagnostic command for catalog↔journal comparison.
    void import('../ui/standalone/textureSwapperWindow/gatingDiagnostic').then(m => m.exposeGatingDiagnosticGlobal());
  }
  await yieldToBrowser();

  // Phase 8b: Stats recorder (subscribes to myDataAtom activity log → stats.ts)
  const { startStatsRecorder } = await import('../store/statsRecorder');
  startStatsRecorder();
  await yieldToBrowser();

  // Phase 9: Expose Aries bridge + register native card view diagnostics
  exposeAriesBridge();
  startNativeCardViewDiagnostics();
  await yieldToBrowser();
}
