import { isVerboseLogsEnabled, setVerboseLogsEnabled } from '../../utils/logger';
import {
  listActivityLogEnhancerEntries,
  exportActivityLogEnhancerEntries,
  clearActivityLogEnhancerEntries,
  setActivityLogEnhancerSummaryVisible,
  getActivityLogEnhancerStatus,
  forceActivityLogEnhancerReplay,
  verifyActivityLogEnhancerEntries,
  isActivityLogEnhancerEnabled,
  setActivityLogEnhancerEnabled,
} from '../../features/activity/activityLogNativeEnhancer';
import {
  getOptimizerDebugSnapshot,
  getOptimizerDebugFamily,
  getOptimizerDebugExplain,
  setOptimizerConfig,
} from '../../features/pets/optimizer';
import type { OptimizerConfig } from '../../features/pets/optimizer';
import { getAbilityCatalogDrift, getAbilityRateReport, getCropSizeBoostDrift, getDayStageDrift } from '../../features/pets/data/petAbilities/drift';
import { isHighValueAbility, isLowValueAbility } from '../../features/pets/data/petAbilities';
import { getAllAbilities, getMutationCatalog, waitForPetAbilities } from '../../catalogs/gameCatalogs';
import { getMutationRulesDrift } from '../../catalogs/logic/mutationRulesCatalog';
import { getRarePatchPairsDrift } from '../../catalogs/logic/rarePatchPairsCatalog';
import { getBagLimit, getBagLimitStatus } from '../../catalogs/logic/bagLimitCatalog';
import { getChargedAbilityRulesStatus } from '../../catalogs/logic/chargedAbilityRulesCatalog';
import { getGameHotkeysStatus, isGameHotkey } from '../../catalogs/logic/gameHotkeysCatalog';
import { getGamePanelsStatus } from '../../catalogs/logic/gamePanelsCatalog';
import { assignKeybind, clearKeybindAction, listKeybindActions } from '../../features/input/keybinds';
import { getSelectItemDebugState, selectBagItem, type SelectTarget } from '../../features/input/selectItem';
import { isBagFullFor } from '../../ui/shop/restockAlerts/bagRoom';
import { readOwnershipData } from '../../ui/shop/restockAlerts/oneTimeOwnership';
import { isRecord } from '../../utils/typeGuards';
import { RARE_PATCH_VARIANTS } from '../../catalogs/pityThresholds';
import { getMutationApplicationResult } from '../../utils/mutationCompatibility';
import { mutationDebugApi } from '../../store/mutationSummary';
import { getMutationEtaSnapshot } from '../../features/garden/mutationEta';
import { getMutationEtaBellState } from '../../features/garden/mutationEtaBell';
import { getMutationGainAlarmState, getMutationGainDebugState, setWatchedMutations } from '../../features/garden/mutationGain';
import { getRecentReadyEdges } from '../../features/chargedAbilities/readyEdge';
import { getChargedReadyAlarmDiagnostics, previewChargedReadyCard } from '../../features/chargedAbilities/readyAlarm';
import { getAllAbilityProjections } from '../../features/chargedAbilities/abilities';
import { scanGardenForAbility } from '../../features/chargedAbilities/footprintScan';
import { getAbilityTargets } from '../../features/chargedAbilities/selector';
import { getMaxStrAlarmState, setMaxStrLeadMinutes } from '../../features/pets/maxStrAlarm';
import { getEggReadyAlarmState, getEggReadyState, setEggReadyLeadMinutes } from '../../features/garden/eggReady';
import { getFriendBonusState } from '../../store/friendBonus';
import { getCropMaxSizeAlarmState, getCropMaxSizeState, getRecentSizeEdges } from '../../features/garden/cropMaxSize';
import { getJournalSeedsState } from '../../features/journalSeeds';
import { testPetData, testComparePets, testAbilityDefinitions } from '../../utils/petDataTester';
import { toggleWindow } from '../../ui/core/modalWindow';
import { togglePetsWindow } from '../../ui/pets/petsWindow';
import { readDurable, storageReadsBeforeInit } from '../../utils/storage';
import { gmInfo, gmUnsafeWindow } from '../../utils/gm';
import { pageWindow } from '../../core/pageContext';

export const coreDebugApi = {
  setVerboseLogs: (enabled: boolean) => {
    setVerboseLogsEnabled(Boolean(enabled));
    return { verboseLogs: isVerboseLogsEnabled() };
  },
  getVerboseLogs: () => isVerboseLogsEnabled(),
  activityLogList: () => listActivityLogEnhancerEntries(),
  activityLogExport: () => exportActivityLogEnhancerEntries(),
  activityLogClear: () => clearActivityLogEnhancerEntries(),
  activityLogSummary: (enabled?: boolean) => setActivityLogEnhancerSummaryVisible(enabled),
  activityLogVerify: () => verifyActivityLogEnhancerEntries(),
  optimizerSnapshot: (mode?: 'specialist' | 'slot_efficiency') => getOptimizerDebugSnapshot(mode),
  optimizerFamily: (familyKeyOrAbility: string, mode?: 'specialist' | 'slot_efficiency') =>
    getOptimizerDebugFamily(familyKeyOrAbility, mode),
  optimizerExplain: (petIdOrName: string, mode?: 'specialist' | 'slot_efficiency') =>
    getOptimizerDebugExplain(petIdOrName, mode),
  abilityCatalogDrift: () => getAbilityCatalogDrift(),
  cropSizeBoostDrift: () => getCropSizeBoostDrift(),
  dayStageDrift: () => getDayStageDrift(),
  mutationRulesDrift: () => getMutationRulesDrift(getMutationCatalog()),
  rarePatchPairsDrift: () => getRarePatchPairsDrift(RARE_PATCH_VARIANTS),
  bagLimit: () => getBagLimitStatus(),
  chargedAbilityRules: () => getChargedAbilityRulesStatus(),
  gameHotkeys: () => getGameHotkeysStatus(),
  gamePanels: () => getGamePanelsStatus(),
  /** true = the game acts on this combo, null = the game's tables are not read. */
  isGameHotkey: (combo: string) => isGameHotkey(combo),
  keybinds: {
    list: () => listKeybindActions(),
    assign: (actionId: string, combo: string) => assignKeybind(actionId, combo),
    clear: (actionId: string) => clearKeybindAction(actionId),
  },
  /** Sends a real pick/put-away (INP-4.2): live checks only through the fixture. */
  selectItem: {
    press: (target: SelectTarget, name?: string) => selectBagItem(target, name),
    state: () => getSelectItemDebugState(),
  },
  /** Read-only: would one more `itemType`/`id` find no bag slot? `limit` overrides the parsed one for probes. */
  bagFullCheck: (itemType: string, id: string, limit?: number) => {
    const myData = readOwnershipData();
    const inventory = isRecord(myData) ? myData.inventory : null;
    return isBagFullFor(inventory, { itemType, id }, limit ?? getBagLimit());
  },
  mutationApply: (existing: string[], add: string) => getMutationApplicationResult(existing, add),
  mutationSummaryDebug: mutationDebugApi,
  mutationEta: { snapshot: () => getMutationEtaSnapshot(), bell: () => getMutationEtaBellState() },
  mutationGain: {
    lastDiff: () => getMutationGainDebugState(),
    alarm: () => getMutationGainAlarmState(),
    setMutations: (ids: string[]) => { setWatchedMutations(ids); return getMutationGainAlarmState().watched; },
  },
  chargedAbilities: {
    readyEdges: () => getRecentReadyEdges(),
    readyAlarm: () => getChargedReadyAlarmDiagnostics(),
    previewReady: (abilityId: string, petSlotId?: string, targets?: number) => previewChargedReadyCard(abilityId, petSlotId, targets),
    projections: () => getAllAbilityProjections().map((p) => {
      const garden = scanGardenForAbility(p);
      return {
        abilityId: p.abilityId, yieldKind: p.yieldKind, tileRadius: p.tileRadius, cooldownMs: p.cooldownMs,
        targetMutations: p.targetMutations, replacementMutation: p.replacementMutation, capsuleSpriteKey: p.capsuleSpriteKey,
        requiredSpecies: p.requiredSpecies, gardenTargets: garden.slots.length, gardenGain: garden.totalGain,
      };
    }),
    targets: () => getAbilityTargets().map((s) => ({
      abilityId: s.abilityId, petSlotId: s.petSlotId, ready: s.ready, qualifyingCount: s.qualifyingCount,
      projectedGain: s.projectedGain, best: s.optimality.bestPatch,
    })),
  },
  maxStrAlarm: { state: () => getMaxStrAlarmState(), setLead: (minutes: number) => setMaxStrLeadMinutes(minutes) },
  eggReady: { state: () => getEggReadyState(), setLead: (minutes: number) => setEggReadyLeadMinutes(minutes), alarm: () => getEggReadyAlarmState() },
  friendBonus: { state: () => getFriendBonusState() },
  cropMaxSize: { lastEdges: () => getRecentSizeEdges(), state: () => getCropMaxSizeState(), alarm: () => getCropMaxSizeAlarmState() },
  journalSeeds: { state: () => getJournalSeedsState() },
  abilityRates: () => getAbilityRateReport(),
  abilityClassification: () => {
    const ids = getAllAbilities();
    return {
      high: ids.filter(isHighValueAbility),
      low: ids.filter(isLowValueAbility),
      unclassified: ids.filter((id) => !isHighValueAbility(id) && !isLowValueAbility(id)),
    };
  },
  waitForPetAbilities: (ms?: number) => waitForPetAbilities(ms),
  setOptimizerConfig: (partial: Partial<OptimizerConfig>) => setOptimizerConfig(partial),
  storageReadDurable: (key: string) => readDurable(key),
  storageReadsBeforeInit: () => storageReadsBeforeInit(),
  activityLogEnabled: async (enabled?: boolean) => {
    if (typeof enabled === 'boolean') {
      await setActivityLogEnhancerEnabled(enabled);
    }
    return {
      enabled: isActivityLogEnhancerEnabled(),
      status: getActivityLogEnhancerStatus(),
    };
  },

  debugAllAtoms: () => {
    try {
      const cache = (window as any).__qpmJotaiAtomCache__;
      if (!cache || typeof cache.entries !== 'function') {
        console.error('Jotai atom cache not available');
        return null;
      }

      console.log('=== All Available Atoms ===');
      const atomList: Array<{label: string, hasValue: boolean}> = [];
      for (const [atom, meta] of cache.entries()) {
        if (meta && typeof meta === 'object' && 'debugLabel' in meta) {
          const label = (meta as any).debugLabel;
          if (typeof label === 'string') {
            atomList.push({
              label,
              hasValue: cache.has(atom)
            });
          }
        }
      }
      console.table(atomList);

      // Also check for pet-related atoms specifically
      console.log('\n=== Pet-related Atoms ===');
      const petAtoms = atomList.filter(a => a.label.toLowerCase().includes('pet'));
      console.table(petAtoms);

      return atomList;
    } catch (error) {
      console.error('Failed to list atoms:', error);
      return null;
    }
  },

  // === PET DATA TESTER (for Comparison Hub development) ===
  testPetData: testPetData,
  testComparePets: testComparePets,
  testAbilityDefinitions: testAbilityDefinitions,

  // === ARIES MOD INTEGRATION DEBUG ===
  debugAriesIntegration: () => {
    console.log('=== Aries Mod Integration Debug ===\n');

    // Check different global locations
    const checks = [
      { name: 'window.PetsService', value: (window as any).PetsService },
      { name: 'window.QWS', value: (window as any).QWS },
      { name: 'window.QWS?.PetsService', value: (window as any).QWS?.PetsService },
      { name: 'pageWindow.PetsService', value: (pageWindow as any).PetsService },
      { name: 'pageWindow.QWS', value: (pageWindow as any).QWS },
    ];

    console.log('Checking for PetsService in various locations:\n');
    checks.forEach(check => {
      if (check.value !== undefined) {
        console.log(`✅ ${check.name}:`, check.value);
        if (check.value && typeof check.value === 'object') {
          console.log(`   Properties:`, Object.keys(check.value));
          if (typeof check.value.getTeams === 'function') {
            try {
              const teams = check.value.getTeams();
              console.log(`   Teams (${Array.isArray(teams) ? teams.length : 'N/A'}):`, teams);
            } catch (e) {
              console.log(`   Error calling getTeams():`, e);
            }
          }
        }
      } else {
        console.log(`❌ ${check.name}: Not found`);
      }
    });

    console.log('\n=== Instructions ===');
    console.log('If PetsService is not detected:');
    console.log('1. Make sure Aries mod is installed and running');
    console.log('2. Check that both scripts are loaded (QPM and Aries)');
    console.log('3. Try reloading the page');
    console.log('4. Check console for "[Aries]" prefixed logs from QPM');
    console.log('\nIf you see PetsService but it\'s not working:');
    console.log('• Open Pet Hub (QPM menu) and go to "3v3 Compare" tab');
    console.log('• Click the "🔄 Refresh" button in the Aries section');
    console.log('• Check console for detection logs');
  },

  openPetHub3v3: async () => {
    try {
      // Prefer clicking the existing Pet Hub button so the window opens in the normal QPM chrome
      const btn = document.querySelector('button[data-window-id="pet-hub"]') as HTMLButtonElement | null;
      if (btn) {
        btn.click();
        setTimeout(() => {
          const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('3v3 Compare')) as HTMLButtonElement | undefined;
          tab?.click();
        }, 300);
        return true;
      }

      // Fallback: open via toggleWindow so it still mounts inside the QPM window system
      const render = (root: HTMLElement) => import('../../ui/pets/hubWindow').then(({ renderPetHubWindow }) => renderPetHubWindow(root));
      toggleWindow('pet-hub', '🐾 Pet Hub', render, '1600px', '92vh');
      setTimeout(() => {
        const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('3v3 Compare')) as HTMLButtonElement | undefined;
        tab?.click();
      }, 400);
      return true;
    } catch (error) {
      console.error('Failed to open Pet Hub 3v3', error);
      return false;
    }
  },
  resetTutorials: async () => {
    const { resetAllTours } = await import('../../ui/tour');
    resetAllTours();
    console.log('All tour progress reset. Reload to see tours again.');
  },

  showTour: async (windowId?: string) => {
    const { checkTour } = await import('../../ui/tour');
    const target = document.querySelector('.qpm-panel') as HTMLElement | null;
    if (target) {
      checkTour(windowId ?? 'welcome', target);
    }
  },

  /** The diagnostics window's Copy-for-Discord payload plus the details it
   * truncates or lacks: script-handler environment, capture source, full drift
   * lists, and Bad Luck Protection account/counters. No player ids — account
   * age is a date, counters are QPM's own observations. */
  supportReport: async () => {
    const { renderCopyPayload } = await import('../../diagnostics/copyPayload');
    const { getPitySnapshot, getPityAccountError, isPityKindEnabled } = await import('../../store/pityTracker');
    const { captureSources, catalogReplacements } = await import('../../catalogs/catalogLoader/state');
    const { getHookEnvironment } = await import('../../catalogs/catalogLoader');
    const { isChainTrapInstalled } = await import('../../websocket/roomConnectionEvents');

    const pity = getPitySnapshot();
    const counters: Record<string, string> = {};
    for (const [key, c] of Object.entries(pity.counters)) {
      counters[key] = `${c.misses} miss / ${c.hits} hit / ${c.totalPulls} pulls`;
    }
    const info = gmInfo();
    const extras = {
      environment: {
        scriptHandler: info ? `${info.handler ?? '?'} ${info.handlerVersion ?? ''}`.trim() : null,
        // Violentmonkey on Firefox can silently fall back to the isolated
        // content world; that breaks the Object.* catalog hooks.
        isolatedWorld: (() => {
          try {
            const pageWindow = gmUnsafeWindow();
            return pageWindow !== null && pageWindow !== window;
          } catch { return null; }
        })(),
        petAbilitiesSource: captureSources.petAbilities,
        petAbilitiesCount: getAllAbilities().length,
        // Per-catalog capture path: 'hook' alone means the enumeration-race
        // capture was never verified/topped-up from bundle text.
        catalogSources: { ...captureSources },
        // Captured copies swapped for the bundle blueprint (another mod's data).
        catalogReplacements: { ...catalogReplacements },
        // Other mods wrapping Object.* shift enumeration order — the trigger
        // for partial dex captures. Says who owns Object.keys right now.
        objectHooks: getHookEnvironment(),
        // Accessor traps replace the send-chain 2 s poll (spec F6/D9).
        chainTraps: isChainTrapInstalled(),
      },
      abilityDrift: getAbilityCatalogDrift(),
      pity: {
        enabled: { seed: isPityKindEnabled('seed'), egg: isPityKindEnabled('egg'), capsule: isPityKindEnabled('capsule') },
        accountCreatedAt: pity.account?.createdAt ? new Date(pity.account.createdAt).toISOString() : null,
        accountError: getPityAccountError(),
        gaps: pity.gaps,
        lifetimeCapsules: pity.lifetime.capsules,
        counters,
      },
    };
    const text = `${renderCopyPayload()}\n\`\`\`\n${JSON.stringify(extras, null, 1)}\n\`\`\``;
    console.log('=== QPM SUPPORT REPORT (copy everything below) ===\n' + text);
    return text;
  },

  /** Manually verify one dex catalog against bundle text and heal it —
   * support-session counterpart of the automatic symptom triggers/audit. */
  catalogMerge: async (name: 'eggCatalog' | 'petCatalog' | 'mutationCatalog' | 'plantCatalog' | 'itemCatalog' | 'decorCatalog') => {
    const { mergeCatalogIfIncomplete } = await import('../../catalogs/gameCatalogs');
    return mergeCatalogIfIncomplete(name);
  },
  /** Run the completeness audit across every dex catalog now (bypasses the
   * once-per-session guard; per-catalog attempt caps still apply). */
  catalogAudit: async () => {
    const { runDexCompletenessAudit } = await import('../../catalogs/gameCatalogs');
    return runDexCompletenessAudit(true);
  },

  // Pet Teams debug helpers
  togglePetsWindow,
  getPetTeams: async () => {
    const { getTeamsConfig } = await import('../../store/petTeams');
    return getTeamsConfig();
  },
  applyPetTeam: async (teamId: string) => {
    const { applyTeam } = await import('../../store/petTeams');
    return applyTeam(teamId);
  },
  getPetPool: async () => {
    const { getAllPooledPets } = await import('../../store/petTeams');
    return getAllPooledPets();
  },
};

export const activityLogApi = {
  list: () => listActivityLogEnhancerEntries(),
  export: () => exportActivityLogEnhancerEntries(),
  clear: () => clearActivityLogEnhancerEntries(),
  summary: (enabled?: boolean) => setActivityLogEnhancerSummaryVisible(enabled),
  verify: () => verifyActivityLogEnhancerEntries(),
  status: () => getActivityLogEnhancerStatus(),
  replay: () => forceActivityLogEnhancerReplay(),
  enabled: async (enabled?: boolean) => {
    if (typeof enabled === 'boolean') {
      await setActivityLogEnhancerEnabled(enabled);
    }
    return isActivityLogEnhancerEnabled();
  },
};
