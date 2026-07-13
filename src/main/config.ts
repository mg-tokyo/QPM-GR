import { storage } from '../utils/storage';

// Load configuration similar to original
const LS_KEY = 'quinoa-pet-manager';
const defaultCfg = {
  enabled: false,
  threshold: 40,
  pollMs: 3000,
  clickCooldownMs: 4000,
  retryDelaySeconds: 15,
  logs: true,
  ui: {
    preventScrollClicks: true,
  },
  inventoryLocker: {
    syncMode: true,
  },
  mutationReminder: {
    enabled: true,
    showNotifications: true,
    highlightPlants: true,
  },
  harvestReminder: {
    enabled: false,
    highlightEnabled: true,
    toastEnabled: true,
    minSize: 80,
    selectedMutations: {
      Rainbow: true,
      Gold: false,
      Frozen: false,
      Wet: false,
      Chilled: false,
      Dawnlit: false,
      Amberlit: false,
      Amberbound: false,
      Dawnbound: false,
    },
  },
  turtleTimer: {
    enabled: true,
    includeBoardwalk: false,
    minActiveHungerPct: 2,
    fallbackTargetScale: 1.5,
    focus: 'latest' as const,
  },
};

export type QpmConfig = typeof defaultCfg;

function loadCfg(): Partial<QpmConfig> {
  return storage.get<Partial<QpmConfig>>(LS_KEY, {});
}

export function buildCfg(): QpmConfig {
  const loadedCfg = loadCfg();
  return {
    ...defaultCfg,
    ...loadedCfg,
    ui: { ...defaultCfg.ui, ...(loadedCfg.ui || {}) },
    inventoryLocker: { ...defaultCfg.inventoryLocker, ...(loadedCfg.inventoryLocker || {}) },
    mutationReminder: { ...defaultCfg.mutationReminder, ...(loadedCfg.mutationReminder || {}) },
    harvestReminder: {
      ...defaultCfg.harvestReminder,
      ...(loadedCfg.harvestReminder || {}),
      selectedMutations: {
        ...defaultCfg.harvestReminder.selectedMutations,
        ...(loadedCfg.harvestReminder?.selectedMutations || {}),
      },
    },
    turtleTimer: {
      ...defaultCfg.turtleTimer,
      ...(loadedCfg.turtleTimer || {}),
    },
  };
}
