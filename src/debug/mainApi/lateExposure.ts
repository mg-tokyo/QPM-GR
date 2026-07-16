import { shareGlobal } from '../../core/pageContext';
import { log } from '../../utils/logger';
import { getStatsSnapshot } from '../../store/stats';
import {
  logCatalogStatus,
  diagnoseCatalogs,
  getCatalogs,
  areCatalogsReady,
  waitForCatalogs,
  forceWeatherCatalogRefresh,
} from '../../catalogs/gameCatalogs';
import { setupGardenInspector } from '../../ui/standalone/publicRoomsWindow';
import { exposeValidationCommands } from '../../utils/validationCommands';
import { registerUniversalProbe } from '../universalProbe';
import { createWsMonitor } from '../wsMonitor';
import { QPM_DEBUG_API } from './apiObject';
import { isDevModeEnabled, setDevModeEnabled } from '../../core/devMode';

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

// Phase-10 debug exposure: attaches late-bound entries to QPM_DEBUG_API and
// publishes __QPM_INTERNAL__ once the stores/features they read are running.
export async function exposeLateDebugApis(debugGlobalsEnabled: boolean): Promise<void> {
  if (debugGlobalsEnabled) {
    const gardenCommands = setupGardenInspector();
    shareGlobal('QPM_INSPECT_GARDEN', gardenCommands.QPM_INSPECT_GARDEN);
    shareGlobal('QPM_EXPOSE_GARDEN', gardenCommands.QPM_EXPOSE_GARDEN);
    shareGlobal('QPM_CURRENT_TILE', gardenCommands.QPM_CURRENT_TILE);
    (QPM_DEBUG_API as any).inspectGarden = gardenCommands.QPM_INSPECT_GARDEN;
    (QPM_DEBUG_API as any).exposeGarden = gardenCommands.QPM_EXPOSE_GARDEN;
    (QPM_DEBUG_API as any).currentTile = gardenCommands.QPM_CURRENT_TILE;
  }

  // Expose shop stock for debugging
  const { getShopStockState } = await import('../../store/shopStock');
  (QPM_DEBUG_API as any).shopStock = getShopStockState;

  // Expose stats + hatch stats for debugging
  (QPM_DEBUG_API as any).stats = getStatsSnapshot;
  const { getHatchStatsSnapshot, resetHatchStats } = await import('../../store/hatchStatsStore');
  (QPM_DEBUG_API as any).hatchStats = getHatchStatsSnapshot;
  (QPM_DEBUG_API as any).resetHatchStats = resetHatchStats;
  const { resetStats } = await import('../../store/stats');
  (QPM_DEBUG_API as any).resetStats = resetStats;
  const { getStatsRecorderStatus } = await import('../../store/statsRecorder');
  (QPM_DEBUG_API as any).statsRecorder = { status: getStatsRecorderStatus };

  // Expose jotai debug namespace (lazy — loads full debug API on first method call)
  const jotaiNs: Record<string, unknown> = {};
  for (const method of ['listAtoms', 'readAtom', 'shopStock', 'captureInfo'] as const) {
    Object.defineProperty(jotaiNs, method, {
      get() {
        return async (...args: unknown[]) => {
          const { getDebugApi } = await import('../debugApi');
          const api = await getDebugApi();
          const fn = (api.jotai as Record<string, unknown>)[method];
          return typeof fn === 'function' ? (fn as Function)(...args) : fn;
        };
      },
      configurable: true,
      enumerable: true,
    });
  }
  (QPM_DEBUG_API as any).jotai = jotaiNs;

  // Expose atoms debug namespace (lazy — loads full debug API on first method call)
  const atomsNs: Record<string, unknown> = {};
  for (const method of ['discover', 'health', 'read', 'list', 'status'] as const) {
    Object.defineProperty(atomsNs, method, {
      get() {
        return async (...args: unknown[]) => {
          const { getDebugApi } = await import('../debugApi');
          const api = await getDebugApi();
          const fn = (api.atoms as Record<string, unknown>)[method];
          return typeof fn === 'function' ? (fn as Function)(...args) : fn;
        };
      },
      configurable: true,
      enumerable: true,
    });
  }
  (QPM_DEBUG_API as any).atoms = atomsNs;

  // Expose catalog functions to global debug API
  (QPM_DEBUG_API as any).getCatalogs = getCatalogs;
  (QPM_DEBUG_API as any).areCatalogsReady = areCatalogsReady;
  (QPM_DEBUG_API as any).waitForCatalogs = waitForCatalogs;
  (QPM_DEBUG_API as any).logCatalogStatus = logCatalogStatus;
  (QPM_DEBUG_API as any).diagnoseCatalogs = diagnoseCatalogs;
  (QPM_DEBUG_API as any).forceWeatherCatalogRefresh = forceWeatherCatalogRefresh;

  // Expose flora blueprint + stitcher diagnostics
  const { diagnoseFloraBlueprints, testStitch, testStitchAll } = await import('../../sprite-v2/stitcher');
  (QPM_DEBUG_API as any).floraBlueprint = diagnoseFloraBlueprints;
  (QPM_DEBUG_API as any).testStitch = testStitch;
  (QPM_DEBUG_API as any).testStitchAll = testStitchAll;

  // Expose garden snapshot for debugging
  const { getGardenSnapshot, getMapSnapshot, isGardenBridgeReady } = await import('../../features/garden/bridge');
  (QPM_DEBUG_API as any).getGardenSnapshot = getGardenSnapshot;
  (QPM_DEBUG_API as any).getMapSnapshot = getMapSnapshot;
  (QPM_DEBUG_API as any).isGardenBridgeReady = isGardenBridgeReady;

  // Also expose to __QPM_INTERNAL__ for legacy/diagnostic access
  const { getGardenFiltersConfig, updateGardenFiltersConfig, applyGardenFiltersNow } = await import('../../features/garden/filters');
  const { getJotaiSubscriptionStats, debugReactiveRouting } = await import('../../core/jotaiBridge');
  const { getReactiveStats } = await import('../../core/reactive/manager');
  const { storage: reactiveKillStorage } = await import('../../utils/storage');
  const KILL_SWITCH_KEYS = {
    state:     'qpm.perf.reactive.stateEnabled',
    client:    'qpm.perf.reactive.clientEnabled',
    composite: 'qpm.perf.reactive.compositeEnabled',
    dynamic:   'qpm.perf.reactive.dynamicEnabled',
  } as const;
  type ReactiveTierName = keyof typeof KILL_SWITCH_KEYS;
  const setReactiveKillSwitch = (tier: ReactiveTierName, enabled: boolean): { tier: string; key: string; enabled: boolean } => {
    const key = KILL_SWITCH_KEYS[tier];
    if (!key) throw new Error(`Unknown tier "${tier}". Use one of: ${Object.keys(KILL_SWITCH_KEYS).join(', ')}. Reload after flipping.`);
    reactiveKillStorage.set(key, enabled);
    return { tier, key, enabled };
  };
  const getReactiveKillSwitches = (): Record<ReactiveTierName, boolean> => {
    const out = {} as Record<ReactiveTierName, boolean>;
    for (const [tier, key] of Object.entries(KILL_SWITCH_KEYS) as Array<[ReactiveTierName, string]>) {
      out[tier] = reactiveKillStorage.get<boolean>(key, true);
    }
    return out;
  };
  const { getRiveRules, reapplyAllRiveRules } = await import('../../features/standalone/riveControl');
  const riveControl = {
    rules: () => getRiveRules(),
    reapply: () => reapplyAllRiveRules(),
  };

  const setDevMode = (enabled: boolean): { enabled: boolean } => {
    setDevModeEnabled(!!enabled);
    return { enabled: isDevModeEnabled() };
  };
  const isDevMode = (): boolean => isDevModeEnabled();
  const globalTarget = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  (globalTarget as any).__QPM_INTERNAL__ = {
    ...(globalTarget as any).__QPM_INTERNAL__,
    getGardenSnapshot,
    getMapSnapshot,
    isGardenBridgeReady,
    getGardenFiltersConfig,
    updateGardenFiltersConfig,
    applyGardenFiltersNow,
    getJotaiSubscriptionStats,
    getReactiveStats,
    setReactiveKillSwitch,
    getReactiveKillSwitches,
    debugReactiveRouting,
    riveControl,
    setDevMode,
    isDevMode,
  };


  // Also expose to window for easy console access
  if (debugGlobalsEnabled && typeof window !== 'undefined') {
    (window as any).__QPM_DiagnoseCatalogs = diagnoseCatalogs;
    log('__QPM_DiagnoseCatalogs() available in console');
  }

  // Expose validation commands for testing
  if (debugGlobalsEnabled) {
    registerUniversalProbe(QPM_DEBUG_API as Record<string, unknown>);
    (QPM_DEBUG_API as Record<string, unknown>).ws = createWsMonitor();
    shareGlobal('QPM_DEBUG_API', QPM_DEBUG_API);
    shareGlobal('QPM', QPM_DEBUG_API);
    exposeValidationCommands();
  }
}
