// src/ui/panel/tileRegistry.ts
import { log } from '../../utils/logger';
import { openDetachedTracker } from '../hub/groups/trackersGroup';
import { TEXTURE_MANIPULATOR_ENABLED } from '../../features/standalone/textureSwapper';
import { t } from '../../i18n';

export interface TileDefinition {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly color: string; // rgba color for background tint + glow
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
    label: t('tile.petTeams.label'),
    color: 'rgba(255, 152, 0, 0.28)',
    action: () => {
      import('../pets/petsWindow').then(({ togglePetsWindow }) => togglePetsWindow())
        .catch(e => log('⚠️ Failed to open Pets window', e));
    },
  });

  registerTile({
    id: 'shop-restock',
    icon: '🏪',
    label: t('tile.shopRestock.label'),
    color: 'rgba(0, 188, 212, 0.28)',
    action: () => {
      import('../shop/restockWindow').then(({ openShopRestockWindow }) => openShopRestockWindow())
        .catch(e => log('⚠️ Failed to open Shop Restock', e));
    },
  });

  registerTile({
    id: 'public-rooms',
    icon: '🌐',
    label: t('tile.publicRooms.label'),
    color: 'rgba(233, 30, 99, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('public-rooms', `🌐 ${t('tile.publicRooms.label')}`, (root) => {
          import('../standalone/publicRoomsWindow')
            .then(({ renderPublicRoomsWindow }) => renderPublicRoomsWindow(root))
            .catch(e => log('⚠️ Failed to load Public Rooms', e));
        }, '950px', '85vh');
      });
    },
  });

  registerTile({
    id: 'journal-checker',
    icon: '📔',
    label: t('tile.journalChecker.label'),
    color: 'rgba(121, 85, 72, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('journal-checker-window', `📔 ${t('tile.journalChecker.label')}`, (root) => {
          root.style.padding = '0';
          import('../journalChecker/index').then(({ createJournalCheckerSection }) => {
            root.appendChild(createJournalCheckerSection());
          }).catch(e => log('⚠️ Failed to load Journal Checker', e));
        }, '900px', '90vh');
      });
    },
  });

  registerTile({
    id: 'ability-tracker',
    icon: '📊',
    label: t('tile.abilityTracker.label'),
    color: 'rgba(76, 175, 80, 0.28)',
    action: () => {
      openDetachedTracker('trackers-v2-ability', `📊 ${t('tile.abilityTracker.label')}`, 'ability', '1200px');
    },
  });

  registerTile({
    id: 'xp-tracker',
    icon: '✨',
    label: t('tile.xpTracker.label'),
    color: 'rgba(255, 215, 0, 0.28)',
    action: () => {
      openDetachedTracker('trackers-v2-xp', `✨ ${t('tile.xpTracker.label')}`, 'xp', '900px');
    },
  });

  registerTile({
    id: 'turtle-timer',
    icon: '🐢',
    label: t('tile.turtleTimer.label'),
    color: 'rgba(102, 187, 106, 0.28)',
    action: () => {
      openDetachedTracker('trackers-v2-turtle', `🐢 ${t('tile.turtleTimer.label')}`, 'turtle', '700px');
    },
  });

  registerTile({
    id: 'crop-boosts',
    icon: '🌱',
    label: t('tile.cropBoosts.label'),
    color: 'rgba(139, 195, 74, 0.28)',
    action: () => {
      import('../pets/cropBoostTrackerWindow').then(({ openCropBoostTrackerWindow }) => openCropBoostTrackerWindow())
        .catch(e => log('⚠️ Failed to open Crop Boosts', e));
    },
  });

  registerTile({
    id: 'value-display',
    icon: '💰',
    label: t('tile.valueDisplay.label'),
    color: 'rgba(255, 193, 7, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-storageValue', `💰 ${t('tile.valueDisplay.label')}`, (root) => {
          root.style.cssText = 'overflow-y:auto;';
          import('../economy/storageValueWindow').then(({ renderStorageValueSettings }) => {
            renderStorageValueSettings(root);
          }).catch(e => log('⚠️ Failed to load Value Display', e));
        }, '420px', '78vh');
      });
    },
  });

  registerTile({
    id: 'activity-log',
    icon: '📜',
    label: t('tile.activityLog.label'),
    color: 'rgba(158, 118, 255, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-activity-log', `📜 ${t('tile.activityLog.label')}`, (root) => {
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
    label: t('tile.protection.label'),
    color: 'rgba(244, 67, 54, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-protection', `🔒 ${t('tile.protection.label')}`, (root) => {
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
    label: t('tile.cropCalculator.label'),
    color: 'rgba(3, 169, 244, 0.28)',
    action: () => {
      import('../economy/cropCalculatorWindow').then(({ openCalculatorWindow }) => openCalculatorWindow())
        .catch(e => log('⚠️ Failed to open Crop Calculator', e));
    },
  });

  registerTile({
    id: 'controller',
    icon: '🎮',
    label: t('tile.controller.label'),
    color: 'rgba(96, 125, 139, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-controller', `🎮 ${t('tile.controller.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/controllerSection').then(({ createControllerSection }) => {
            root.appendChild(createControllerSection(null, null));
          }).catch(e => log('⚠️ Failed to load Controller', e));
        }, '580px', '78vh');
      });
    },
  });

  // ── Garden group ────────────────────────────────────────────────────────────

  registerTile({
    id: 'garden-filters',
    icon: '🔍',
    label: t('tile.gardenFilters.label'),
    color: 'rgba(192, 132, 252, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-garden-filters', `🔍 ${t('tile.gardenFilters.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../garden/gardenFiltersSection').then(async ({ createGardenFiltersSection }) => {
            root.appendChild(await createGardenFiltersSection());
          }).catch(e => log('⚠️ Failed to load Garden Filters', e));
        }, '580px', '78vh');
      });
    },
  });

  registerTile({
    id: 'reminders',
    icon: '🔔',
    label: t('tile.reminders.label'),
    color: 'rgba(52, 211, 153, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-reminders', `🔔 ${t('tile.reminders.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../core/originalPanel').then(({ renderRemindersContent }) => {
            renderRemindersContent(root);
          }).catch(e => log('⚠️ Failed to load Reminders', e));
        }, '580px', '78vh');
      });
    },
  });

  registerTile({
    id: 'garden-stats',
    icon: '🌿',
    label: t('tile.gardenStats.label'),
    color: 'rgba(147, 197, 253, 0.28)',
    action: () => {
      import('../stats/statsHubWindow').then(({ openStatsHubWindow }) => openStatsHubWindow())
        .catch(e => log('⚠️ Failed to open Garden Stats', e));
    },
  });

  // ── Items group ─────────────────────────────────────────────────────────────

  registerTile({
    id: 'favorites',
    icon: '⭐',
    label: t('tile.favorites.label'),
    color: 'rgba(244, 114, 182, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('hub-favorites', `⭐ ${t('tile.favorites.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/favoritesSection').then(({ createFavoritesSection }) => {
            const { element } = createFavoritesSection();
            root.appendChild(element);
          }).catch(e => log('⚠️ Failed to load Favorites', e));
        }, '580px', '78vh');
      });
    },
  });

  // ── Config group ────────────────────────────────────────────────────────────

  registerTile({
    id: 'auto-reconnect',
    icon: '↻',
    label: t('tile.autoReconnect.label'),
    color: 'rgba(167, 139, 250, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('config-auto-reconnect', `↻ ${t('tile.autoReconnect.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../hub/groups/configGroup').then(({ renderAutoReconnectExpanded }) => {
            renderAutoReconnectExpanded(root);
          }).catch(e => log('⚠️ Failed to load Auto Reconnect', e));
        }, '420px', '50vh');
      });
    },
  });

  registerTile({
    id: 'shop-keybinds',
    icon: '⌨️',
    label: t('tile.shopKeybinds.label'),
    color: 'rgba(96, 165, 250, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('config-shop-keybinds', `⌨️ ${t('tile.shopKeybinds.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../hub/groups/configGroup').then(({ renderShopKeybindsExpanded }) => {
            renderShopKeybindsExpanded(root);
          }).catch(e => log('⚠️ Failed to load Shop Keybinds', e));
        }, '420px', '60vh');
      });
    },
  });

  registerTile({
    id: 'panel-shortcut',
    icon: '⌨️',
    label: t('tile.panelShortcut.label'),
    color: 'rgba(167, 139, 250, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('config-panel-shortcut', `⌨️ ${t('tile.panelShortcut.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../hub/groups/configGroup').then(({ renderPanelShortcutExpanded }) => {
            renderPanelShortcutExpanded(root);
          }).catch(e => log('⚠️ Failed to load Panel Shortcut', e));
        }, '420px', '50vh');
      });
    },
  });

  // ── Tools group ─────────────────────────────────────────────────────────────

  registerTile({
    id: 'guide',
    icon: '📖',
    label: t('tile.guide.label'),
    color: 'rgba(147, 197, 253, 0.28)',
    action: () => {
      import('../core/modalWindow').then(({ toggleWindow }) => {
        toggleWindow('guide-window', `📖 ${t('tile.guide.label')}`, (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/guideSection').then(({ createGuideSection }) => {
            root.appendChild(createGuideSection());
          }).catch(e => log('⚠️ Failed to load Guide', e));
        }, '700px', '85vh');
      });
    },
  });

  registerTile({
    id: 'decor-layout',
    icon: '🏰',
    label: t('tile.decorLayout.label'),
    color: 'rgba(196, 181, 253, 0.28)',
    action: () => {
      import('../hub/groups/toolsGroup').then(({ openExternalUrl }) => {
        openExternalUrl('https://mg-tokyo.github.io/MG-Decor-Layout-Customiser/');
      });
    },
  });

  registerTile({
    id: 'sprite-customizer',
    icon: '🖼️',
    label: t('tile.spriteCustomiser.label'),
    color: 'rgba(249, 168, 212, 0.28)',
    action: () => {
      import('../hub/groups/toolsGroup').then(({ openExternalUrl }) => {
        openExternalUrl('https://mg-tokyo.github.io/MG-Sprite-Customiser-V2/');
      });
    },
  });

  registerTile({
    id: 'celestial-calculator',
    icon: '🌟',
    label: t('tile.celestialCalculator.label'),
    color: 'rgba(253, 230, 138, 0.28)',
    action: () => {
      import('../hub/groups/toolsGroup').then(({ openExternalUrl }) => {
        openExternalUrl('https://mg-tokyo.github.io/Celestial-Position-Layout-Calculator/');
      });
    },
  });

  // ── Conditional: Texture Manipulator ────────────────────────────────────────

  if (TEXTURE_MANIPULATOR_ENABLED) {
    registerTile({
      id: 'texture-manipulator',
      icon: '🖌️',
      label: t('tile.textureManipulator.label'),
      color: 'rgba(134, 239, 172, 0.28)',
      action: () => {
        import('../standalone/textureSwapperWindow').then(({ openTextureSwapperWindow }) => openTextureSwapperWindow())
          .catch(e => log('⚠️ Failed to open Texture Manipulator', e));
      },
    });
  }
}
