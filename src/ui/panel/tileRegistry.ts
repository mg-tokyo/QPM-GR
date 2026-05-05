// src/ui/panel/tileRegistry.ts
import { log } from '../../utils/logger';

export interface TileDefinition {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly action: () => void;
}

const registry: TileDefinition[] = [];

export function registerTile(def: TileDefinition): void {
  if (registry.some(t => t.id === def.id)) return;
  registry.push(def);
}

export function getAllTileDefinitions(): readonly TileDefinition[] {
  return registry;
}

export function getTileDefinition(id: string): TileDefinition | undefined {
  return registry.find(t => t.id === id);
}

/**
 * Register all built-in tile features.
 * Called once during panel init — each tile's action lazily imports its window.
 */
export function registerBuiltinTiles(): void {
  registerTile({
    id: 'pet-teams',
    icon: '👥',
    label: 'Pet Teams',
    action: () => {
      import('../petsWindow').then(({ togglePetsWindow }) => togglePetsWindow())
        .catch(e => log('⚠️ Failed to open Pets window', e));
    },
  });

  registerTile({
    id: 'shop-restock',
    icon: '🏪',
    label: 'Shop Restock',
    action: () => {
      import('../shopRestockWindow').then(({ openShopRestockWindow }) => openShopRestockWindow())
        .catch(e => log('⚠️ Failed to open Shop Restock', e));
    },
  });

  registerTile({
    id: 'public-rooms',
    icon: '🌐',
    label: 'Public Rooms',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('public-rooms', '🌐 Public Rooms', (root) => {
          import('../publicRoomsWindow')
            .then(({ renderPublicRoomsWindow }) => renderPublicRoomsWindow(root))
            .catch(e => log('⚠️ Failed to load Public Rooms', e));
        }, '950px', '85vh');
      });
    },
  });

  registerTile({
    id: 'journal-checker',
    icon: '📔',
    label: 'Journal Checker',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('journal-checker-window', '📔 Journal Checker', (root) => {
          root.style.padding = '0';
          import('../journalCheckerSection').then(({ createJournalCheckerSection }) => {
            root.appendChild(createJournalCheckerSection());
          }).catch(e => log('⚠️ Failed to load Journal Checker', e));
        }, '900px', '90vh');
      });
    },
  });

  registerTile({
    id: 'ability-tracker',
    icon: '📊',
    label: 'Ability Tracker',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-ability', '📊 Ability Tracker', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
          import('../trackerWindow').then(({ createAbilityTrackerWindow, setGlobalAbilityTrackerState }) => {
            const state = createAbilityTrackerWindow();
            setGlobalAbilityTrackerState(state);
            root.appendChild(state.root);
          }).catch(e => log('⚠️ Failed to load Ability Tracker', e));
        }, '1200px', '90vh');
      });
    },
  });

  registerTile({
    id: 'xp-tracker',
    icon: '✨',
    label: 'XP Tracker',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-xp', '✨ XP Tracker', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
          import('../xpTrackerWindow').then(({ createXpTrackerWindow, setGlobalXpTrackerState }) => {
            const state = createXpTrackerWindow();
            setGlobalXpTrackerState(state);
            root.appendChild(state.root);
          }).catch(e => log('⚠️ Failed to load XP Tracker', e));
        }, '900px', '90vh');
      });
    },
  });

  registerTile({
    id: 'turtle-timer',
    icon: '🐢',
    label: 'Turtle Timer',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-turtle', '🐢 Turtle Timer', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
          import('../turtleTimerWindow').then(({ createTurtleTimerWindow }) => {
            const state = createTurtleTimerWindow();
            root.appendChild(state.root);
          }).catch(e => log('⚠️ Failed to load Turtle Timer', e));
        }, '700px', '90vh');
      });
    },
  });

  registerTile({
    id: 'crop-boosts',
    icon: '🌱',
    label: 'Crop Boosts',
    action: () => {
      import('../cropBoostTrackerWindow').then(({ openCropBoostTrackerWindow }) => openCropBoostTrackerWindow())
        .catch(e => log('⚠️ Failed to open Crop Boosts', e));
    },
  });

  registerTile({
    id: 'value-display',
    icon: '💰',
    label: 'Value Display',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-storageValue', '💰 Value Display', (root) => {
          root.style.cssText = 'overflow-y:auto;';
          import('../storageValueWindow').then(({ renderStorageValueSettings }) => {
            renderStorageValueSettings(root);
          }).catch(e => log('⚠️ Failed to load Value Display', e));
        }, '420px', '78vh');
      });
    },
  });

  registerTile({
    id: 'activity-log',
    icon: '📜',
    label: 'Activity Log',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-activity-log', '📜 Activity Log', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/activityLogSection').then(({ createActivityLogSection }) => {
            root.appendChild(createActivityLogSection());
          }).catch(e => log('⚠️ Failed to load Activity Log', e));
        }, '580px', '78vh');
      });
    },
  });

  registerTile({
    id: 'locker',
    icon: '🔒',
    label: 'Protection',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-protection', '🔒 Protection', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/protectionSection').then(({ createProtectionSection }) => {
            root.appendChild(createProtectionSection().element);
          }).catch(e => log('⚠️ Failed to load Protection', e));
        }, '580px', '78vh');
      });
    },
  });

  registerTile({
    id: 'crop-calculator',
    icon: '🧮',
    label: 'Crop Calculator',
    action: () => {
      import('../cropCalculatorWindow').then(({ openCalculatorWindow }) => openCalculatorWindow())
        .catch(e => log('⚠️ Failed to open Crop Calculator', e));
    },
  });

  registerTile({
    id: 'texture-swapper',
    icon: '🖼️',
    label: 'Texture Swapper',
    action: () => {
      import('../textureSwapperWindow').then(({ openTextureSwapperWindow }) => openTextureSwapperWindow())
        .catch(e => log('⚠️ Failed to open Texture Swapper', e));
    },
  });

  registerTile({
    id: 'controller',
    icon: '🎮',
    label: 'Controller',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-controller', '🎮 Controller Settings', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/controllerSection').then(({ createControllerSection }) => {
            root.appendChild(createControllerSection(null, null));
          }).catch(e => log('⚠️ Failed to load Controller', e));
        }, '580px', '78vh');
      });
    },
  });
}
