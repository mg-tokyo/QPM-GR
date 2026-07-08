// src/ui/hubWindow/groups/trackersGroup.ts

import type { HubGroupDef, ExpandableCardConfig, LauncherCardConfig } from '../cards/types';
import { toggleWindow, openWindow, closeWindow, destroyWindow, isWindowOpen } from '../../core/modalWindow';
import { log } from '../../../utils/logger';
import { waitForCatalogs } from '../../../catalogs/gameCatalogs';
import { t } from '../../../i18n';
import {
  startTurtleTimerStatus,
  startCropBoostStatus,
  startShopRestockStatus,
  startActivityLogStatus,
} from '../../panel/tileStatusesCore';

/** Best-effort catalog wait — never rejects, just logs and continues */
async function awaitCatalogs(): Promise<void> {
  try { await waitForCatalogs(10000); }
  catch { log('[Hub] Catalogs not ready yet, rendering with fallbacks'); }
}

function makeTrackerExpanded(key: string): (container: HTMLElement) => (() => void) | void {
  return (container: HTMLElement) => {
    container.style.cssText = 'display:flex;flex-direction:column;min-height:360px;overflow:hidden;';
    const spinner = document.createElement('div');
    spinner.style.cssText = 'display:flex;align-items:center;justify-content:center;flex:1;color:rgba(224,224,224,0.45);font-size:12px;';
    spinner.textContent = `⏳ ${t('common.loading')}`;
    container.appendChild(spinner);

    let contentCleanup: (() => void) | undefined;

    (async () => {
      try {
        if (key === 'crops') await awaitCatalogs();
        if (key === 'ability') {
          const { renderAbilityTrackerContent } = await import('../../stats/trackerWindow');
          spinner.remove();
          contentCleanup = renderAbilityTrackerContent(container);
        } else if (key === 'turtle') {
          const { renderTurtleTimerContent } = await import('../../pets/turtleTimerWindow');
          spinner.remove();
          contentCleanup = renderTurtleTimerContent(container);
          // Tour — only in detached window context
          if (isWindowOpen('trackers-v2-turtle')) {
            import('../../tour').then(({ checkTour, injectReplayButton }) => {
              checkTour('trackers-v2-turtle', container);
              injectReplayButton('trackers-v2-turtle');
            });
          }
        } else if (key === 'xp') {
          const { renderXpTrackerContent } = await import('../../pets/xpTracker');
          spinner.remove();
          contentCleanup = renderXpTrackerContent(container);
          // Tour — only in detached window context
          if (isWindowOpen('trackers-v2-xp')) {
            import('../../tour').then(({ checkTour, injectReplayButton }) => {
              checkTour('trackers-v2-xp', container);
              injectReplayButton('trackers-v2-xp');
            });
          }
        } else if (key === 'crops') {
          const { renderCropBoostContent } = await import('../../pets/cropBoostTrackerWindow');
          // renderCropBoostSection overwrites root.style.cssText with overflow-y:auto
          // + overscroll-behavior:contain, which traps wheel events. Patch after
          // each re-render so the hub's own scroll container handles scrolling.
          contentCleanup = renderCropBoostContent(container) ?? undefined;
          let patching = false;
          const patchOverflow = (): void => {
            if (patching) return;
            if (container.style.overflowY === 'visible' && container.style.overscrollBehavior === 'auto') return;
            patching = true;
            container.style.overflowY = 'visible';
            container.style.overscrollBehavior = 'auto';
            patching = false;
          };
          patchOverflow();
          const mo = new MutationObserver(patchOverflow);
          mo.observe(container, { attributes: true, attributeFilter: ['style'] });
          const innerCleanup = contentCleanup;
          contentCleanup = () => { mo.disconnect(); innerCleanup?.(); };
        }
        spinner.remove();
      } catch (err) {
        log('⚠️ Failed to load tracker', err);
        spinner.textContent = `❌ ${t('common.loadError')}`;
      }
    })();

    return () => { contentCleanup?.(); };
  };
}

export function openDetachedTracker(windowId: string, title: string, key: string, width: string): void {
  // If window is currently visible, close it (toggle behaviour).
  if (isWindowOpen(windowId)) {
    closeWindow(windowId);
    return;
  }
  // Destroy any stale hidden window so the tracker is rebuilt with
  // fresh content + subscriptions.  Position/size restore from storage
  // automatically inside openWindow.
  destroyWindow(windowId);
  openWindow(windowId, title, (root) => {
    root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
    return makeTrackerExpanded(key)(root);
  }, width, '90vh');
}

export function getTrackersGroup(): HubGroupDef {
  const abilityCard: ExpandableCardConfig = {
    key: 'ability',
    label: t('hub.trackers.ability.label'),
    description: t('hub.trackers.ability.description'),
    icon: { kind: 'sprite', value: '📊', spriteKey: 'sprite/pet/Peacock', spriteMutations: ['Rainbow'], fallback: '📊' },
    labelColor: '#4ade80',
    tier: 'expandable',
    tile: {
      tileId: 'ability-tracker',
      icon: '📊',
      color: 'rgba(76, 175, 80, 0.28)',
      defaultStatus: '0.0 procs/hr / $0/hr',
      // statusProvider handled by multi-tile startPetDerivedStatuses
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.trackers.ability.summary');
    },
    renderExpanded: makeTrackerExpanded('ability'),
    detachWindowId: 'trackers-v2-ability',
    onDetach: () => openDetachedTracker('trackers-v2-ability', '📊 Ability Tracker', 'ability', '1200px'),
  };

  const xpCard: ExpandableCardConfig = {
    key: 'xp',
    label: t('hub.trackers.xp.label'),
    description: t('hub.trackers.xp.description'),
    icon: { kind: 'sprite', value: '✨', spriteKey: 'sprite/ui/StrengthStar', fallback: '✨' },
    labelColor: '#fbbf24',
    tier: 'expandable',
    tile: {
      tileId: 'xp-tracker',
      icon: '✨',
      color: 'rgba(255, 215, 0, 0.28)',
      defaultStatus: '0 XP skills / 0 XP/hr',
      // statusProvider handled by multi-tile startPetDerivedStatuses
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.trackers.xp.summary');
    },
    renderExpanded: makeTrackerExpanded('xp'),
    detachWindowId: 'trackers-v2-xp',
    onDetach: () => openDetachedTracker('trackers-v2-xp', '✨ XP Tracker', 'xp', '900px'),
  };

  const turtleCard: ExpandableCardConfig = {
    key: 'turtle',
    label: t('hub.trackers.turtle.label'),
    description: t('hub.trackers.turtle.description'),
    icon: {
      kind: 'sprite', value: '🐢', fallback: '🐢',
      bunched: [
        { spriteKey: 'sprite/pet/Turtle', offsetX: -7, scale: 0.9 },
        { spriteKey: 'sprite/pet/Chicken', offsetX: 7, offsetY: 1, scale: 0.75 },
      ],
    },
    labelColor: '#38bdf8',
    tier: 'expandable',
    tile: {
      tileId: 'turtle-timer',
      icon: '🐢',
      color: 'rgba(102, 187, 106, 0.28)',
      defaultStatus: '0 turtles / 0 crops / 0 eggs',
      statusProvider: startTurtleTimerStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.trackers.turtle.summary');
    },
    renderExpanded: makeTrackerExpanded('turtle'),
    detachWindowId: 'trackers-v2-turtle',
    onDetach: () => openDetachedTracker('trackers-v2-turtle', '🐢 Turtle Timer', 'turtle', '700px'),
  };

  const cropsCard: ExpandableCardConfig = {
    key: 'crops',
    label: t('hub.trackers.crops.label'),
    description: t('hub.trackers.crops.description'),
    icon: { kind: 'sprite', value: '🌱', spriteKey: 'sprite/plant/Sunflower', spriteMutations: ['Gold'], fallback: '🌱' },
    labelColor: '#a78bfa',
    tier: 'expandable',
    tile: {
      tileId: 'crop-boosts',
      icon: '🌱',
      color: 'rgba(139, 195, 74, 0.28)',
      defaultStatus: '0 boosters / 0 crops / ETA n/a',
      statusProvider: startCropBoostStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.trackers.crops.summary');
    },
    renderExpanded: makeTrackerExpanded('crops'),
    detachWindowId: 'trackers-v2-crops',
    onDetach: () => openDetachedTracker('trackers-v2-crops', '🌱 Crop Boosts', 'crops', '800px'),
  };

  const shopRestockCard: LauncherCardConfig = {
    key: 'shop-restock',
    label: t('hub.trackers.shopRestock.label'),
    description: t('hub.trackers.shopRestock.description'),
    icon: {
      kind: 'sprite', value: '🏪', fallback: '🏪',
      bunched: [
        { spriteKey: 'sprite/ui/Coin', offsetX: -8, offsetY: 2, scale: 0.7 },
        { spriteKey: 'sprite/plant/Starweaver', offsetX: -2, offsetY: -3, scale: 0.8 },
        { spriteKey: 'sprite/plant/DawnCelestialCrop', offsetX: 4, offsetY: 1, scale: 0.75 },
        { spriteKey: 'sprite/plant/MoonCelestialCrop', offsetX: 9, offsetY: -2, scale: 0.75 },
      ],
    },
    labelColor: '#f9a8d4',
    tier: 'launcher',
    tile: {
      icon: '🏪',
      color: 'rgba(0, 188, 212, 0.28)',
      defaultStatus: '0 tracked / 0 due',
      statusProvider: startShopRestockStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.trackers.shopRestock.summary');
    },
    onOpen: () => {
      import('../../shop/restockWindow').then(({ openShopRestockWindow }) => {
        openShopRestockWindow();
      }).catch(e => log('⚠️ Failed to open Shop Restock', e));
    },
  };

  const activityLogCard: LauncherCardConfig = {
    key: 'activity-log',
    label: t('hub.trackers.activityLog.label'),
    description: t('hub.trackers.activityLog.description'),
    icon: { kind: 'sprite', value: '📜', spriteKey: 'sprite/ui/ActivityLog', fallback: '📜' },
    labelColor: '#fdba74',
    tier: 'launcher',
    tile: {
      icon: '📜',
      color: 'rgba(158, 118, 255, 0.28)',
      defaultStatus: '0 saved / 0 replay / watching',
      statusProvider: startActivityLogStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.trackers.activityLog.summary');
    },
    onOpen: () => {
      toggleWindow('utility-feature-activity-log', '📜 Activity Log', (root) => {
        root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
        import('../../sections/activityLogSection').then(({ createActivityLogSection }) => {
          root.appendChild(createActivityLogSection());
        }).catch(e => log('⚠️ Failed to load Activity Log', e));
      }, '580px', '78vh');
    },
  };

  const chargedAbilitiesCard: LauncherCardConfig = {
    key: 'charged-abilities',
    label: t('hub.trackers.chargedAbilities.label'),
    description: t('hub.trackers.chargedAbilities.description'),
    icon: {
      kind: 'sprite', value: '⚡', fallback: '⚡',
      bunched: [
        { spriteKey: 'sprite/ui/MutationThunderstruck', offsetX: -6, offsetY: 0, scale: 0.85 },
        { spriteKey: 'sprite/ui/MutationDawnlit', offsetX: 8, offsetY: 0, scale: 0.85 },
      ],
    },
    labelColor: '#c084fc',
    tier: 'launcher',
    tile: {
      icon: '⚡',
      color: 'rgba(192, 132, 252, 0.28)',
      defaultStatus: '—',
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.trackers.chargedAbilities.summary');
    },
    onOpen: () => {
      import('../../../features/chargedAbilities').then(({ openChargedAbilitiesWindow }) => {
        openChargedAbilitiesWindow();
      }).catch(e => log('⚠️ Failed to open Charged Abilities', e));
    },
  };

  return {
    id: 'trackers',
    label: t('hub.trackers.label'),
    icon: {
      kind: 'sprite', value: '📊', fallback: '📊',
      bunched: [
        { spriteKey: 'sprite/pet/Peacock', mutations: ['Rainbow'], offsetX: -12, offsetY: -4, scale: 0.85 },
        { spriteKey: 'sprite/ui/StrengthStar', offsetX: 2, offsetY: -4, scale: 0.65 },
        { spriteKey: 'sprite/ui/Coin', offsetX: 14, offsetY: -4, scale: 0.65 },
        { spriteKey: 'sprite/pet/Chicken', offsetX: -5, offsetY: 6, scale: 0.7 },
        { spriteKey: 'sprite/pet/Turtle', offsetX: 9, offsetY: 6, scale: 0.7 },
      ],
    },
    cards: [abilityCard, xpCard, turtleCard, cropsCard, shopRestockCard, activityLogCard, chargedAbilitiesCard],
  };
}
