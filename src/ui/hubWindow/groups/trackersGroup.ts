// src/ui/hubWindow/groups/trackersGroup.ts

import type { HubGroupDef, ExpandableCardConfig, LauncherCardConfig } from '../cards/types';
import { toggleWindow, openWindow, closeWindow, destroyWindow, isWindowOpen } from '../../modalWindow';
import { log } from '../../../utils/logger';
import { waitForCatalogs } from '../../../catalogs/gameCatalogs';
import { t } from '../../../i18n';

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
          const { createAbilityTrackerWindow, setGlobalAbilityTrackerState } = await import('../../trackerWindow');
          const state = createAbilityTrackerWindow();
          setGlobalAbilityTrackerState(state);
          embedWindowRoot(state.root, container);
        } else if (key === 'turtle') {
          const { createTurtleTimerWindow } = await import('../../turtleTimerWindow');
          const state = createTurtleTimerWindow();
          embedWindowRoot(state.root, container);
        } else if (key === 'xp') {
          const { createXpTrackerWindow, setGlobalXpTrackerState } = await import('../../xpTrackerWindow');
          const state = createXpTrackerWindow();
          setGlobalXpTrackerState(state);
          embedWindowRoot(state.root, container);
        } else if (key === 'crops') {
          const { renderCropBoostContent } = await import('../../cropBoostTrackerWindow');
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

function embedWindowRoot(windowRoot: HTMLElement, container: HTMLElement): void {
  const chromeCursors = new Set(['move', 'grab', 'grabbing', 'se-resize']);
  for (const child of Array.from(windowRoot.children) as HTMLElement[]) {
    const cursor = child.style.cursor?.trim().toLowerCase() ||
      window.getComputedStyle(child).cursor?.trim().toLowerCase();
    if (cursor && chromeCursors.has(cursor)) {
      child.style.display = 'none';
    }
  }
  windowRoot.style.cssText = [
    'position:relative',
    'top:auto',
    'left:auto',
    'width:100%',
    'height:auto',
    'min-height:340px',
    'min-width:400px',
    'max-width:none',
    'max-height:none',
    'z-index:auto',
    'box-shadow:none',
    'border-radius:0',
    'border:none',
    'display:flex',
    'flex-direction:column',
    'overflow:hidden',
  ].join(';');
  container.innerHTML = '';
  container.appendChild(windowRoot);
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
    makeTrackerExpanded(key)(root);
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
      el.textContent = t('hub.trackers.shopRestock.summary');
    },
    onOpen: () => {
      import('../../shopRestockWindow').then(({ openShopRestockWindow }) => {
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
    renderSummary: (el) => {
      el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.45);margin-top:2px;';
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
    cards: [abilityCard, xpCard, turtleCard, cropsCard, shopRestockCard, activityLogCard],
  };
}
