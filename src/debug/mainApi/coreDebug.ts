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
} from '../../features/pets/optimizer';
import { testPetData, testComparePets, testAbilityDefinitions } from '../../utils/petDataTester';
import { toggleWindow } from '../../ui/core/modalWindow';
import { togglePetsWindow } from '../../ui/pets/petsWindow';

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

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
      { name: 'unsafeWindow.PetsService', value: (typeof unsafeWindow !== 'undefined' ? (unsafeWindow as any).PetsService : undefined) },
      { name: 'unsafeWindow.QWS', value: (typeof unsafeWindow !== 'undefined' ? (unsafeWindow as any).QWS : undefined) },
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
