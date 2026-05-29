// src/ui/originalPanel.ts - Main panel orchestrator
import { log } from '../utils/logger';
import { storage } from '../utils/storage';
import { t } from '../i18n';

import { startVersionChecker, onVersionChange, getCurrentVersion, type VersionInfo, type VersionStatus } from '../utils/versionChecker';
import { ensurePanelStyles } from './panelStyles';
import { toggleWindow } from './modalWindow';
import { UIState, createInitialUIState } from './panelState';
import { createMutationSection } from './mutations/mutationValueSection';
import { startPanelHotkey } from '../features/panelHotkey';

let uiState = createInitialUIState();

const PANEL_POSITION_KEY = 'quinoa-ui-panel-position';
const PANEL_COLLAPSED_KEY = 'quinoa-ui-panel-collapsed';
const PANEL_SIZE_KEY = 'quinoa-ui-panel-size';
const DEFAULT_PANEL_WIDTH = 560;
const MIN_PANEL_WIDTH = 520;
const MIN_HOME_WIDTH = 340;
const MAX_PANEL_WIDTH = 700;

let _panelResizeCleanup: (() => void) | null = null;
let currentViewId = 'home';

// Configuration shape passed down from main.ts via setCfg()
interface PanelCfg {
  ui?: Record<string, unknown>;
  mutationReminder?: { enabled?: boolean; showNotifications?: boolean; highlightPlants?: boolean };
  turtleTimer?: { enabled?: boolean; [key: string]: unknown };
  harvestReminder?: Record<string, unknown>;
  inventoryLocker?: Record<string, unknown>;
  [key: string]: unknown;
}

let cfg: PanelCfg = {};



export async function createOriginalUI(): Promise<HTMLElement> {
  ensurePanelStyles();
  if (uiState.panel) return uiState.panel;

  const panel = document.createElement('div');
  panel.className = 'qpm-panel';

  const titleBar = document.createElement('div');
  titleBar.className = 'qpm-panel__titlebar';
  titleBar.title = t('panel.titlebar.tooltip');

  const titleText = document.createElement('span');
  titleText.textContent = `🍖 ${t('panel.title')}`;

  // Create version bubble
  const versionBubble = document.createElement('a');
  versionBubble.className = 'qpm-version-bubble';
  versionBubble.dataset.status = 'checking';
  versionBubble.textContent = `v${getCurrentVersion()}`;
  versionBubble.title = t('panel.version.checking');
  versionBubble.style.cursor = 'pointer';
  versionBubble.target = '_blank';
  versionBubble.rel = 'noopener noreferrer';

  const renderVersionInfo = (info: VersionInfo): void => {
    const statusMap: Record<VersionStatus, 'up-to-date' | 'outdated' | 'checking' | 'error'> = {
      current: 'up-to-date',
      outdated: 'outdated',
      checking: 'checking',
      error: 'error',
    };

    versionBubble.dataset.status = statusMap[info.status];

    if (info.status === 'outdated' && info.latest) {
      versionBubble.textContent = `v${info.current} → v${info.latest}`;
      versionBubble.title = t('panel.version.outdated', { current: info.current, latest: info.latest });
    } else if (info.status === 'error') {
      versionBubble.textContent = `v${info.current}`;
      versionBubble.title = t('panel.version.error');
    } else if (info.status === 'checking') {
      versionBubble.textContent = `v${info.current}`;
      versionBubble.title = t('panel.version.checking');
    } else {
      versionBubble.textContent = `v${info.current}`;
      versionBubble.title = t('panel.version.upToDate', { version: info.current });
    }
  };

  const VERSION_SCRIPT_URL = 'https://raw.githubusercontent.com/mg-tokyo/QPM-GR/master/dist/QPM.user.js';
  versionBubble.href = VERSION_SCRIPT_URL;

  const openVersionLink = (): void => {
    const freshUrl = `${VERSION_SCRIPT_URL}?t=${Date.now()}`;
    versionBubble.href = freshUrl;

    const gmOpen = (globalThis as any).GM_openInTab || (globalThis as any).GM?.openInTab;
    if (typeof gmOpen === 'function') {
      try {
        gmOpen(freshUrl, { active: true, insert: true, setParent: true });
        return;
      } catch (error) {
        console.warn('[QPM] GM_openInTab failed, falling back', error);
      }
    }

    const win = window.open(freshUrl, '_blank', 'noopener,noreferrer');
    if (!win) {
      window.location.href = freshUrl;
    }
  };

  versionBubble.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openVersionLink();
  });

  onVersionChange(renderVersionInfo);
  startVersionChecker();

  const collapseButton = document.createElement('button');
  collapseButton.type = 'button';
  collapseButton.dataset.qpmCollapseButton = 'true';
  collapseButton.className = 'qpm-button';
  collapseButton.setAttribute('aria-label', t('panel.collapse'));

  const collapseIcon = document.createElement('span');
  collapseIcon.textContent = '▼';
  collapseButton.appendChild(collapseIcon);

  titleBar.append(titleText, versionBubble, collapseButton);

  // ── Content area: nav bar + view switcher ──
  const content = document.createElement('div');
  content.className = 'qpm-content';
  content.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;flex:1;min-height:0;padding:0;gap:0;';

  // Lazy-load view switcher with hub groups
  (async () => {
    try {
      const { createViewSwitcher } = await import('./panel/viewSwitcher');
      const { getTrackersGroup } = await import('./hubWindow/groups/trackersGroup');
      const { getItemsGroup } = await import('./hubWindow/groups/itemsGroup');
      const { getGardenGroup } = await import('./hubWindow/groups/gardenGroup');
      const { getConfigGroup } = await import('./hubWindow/groups/configGroup');
      const { getToolsGroup } = await import('./hubWindow/groups/toolsGroup');

      const groups = [getTrackersGroup(), getItemsGroup(), getGardenGroup(), getConfigGroup(), getToolsGroup()];
      const viewSwitcherResult = createViewSwitcher(groups);
      content.appendChild(viewSwitcherResult.navElement);
      content.appendChild(viewSwitcherResult.viewElement);
      content.appendChild(viewSwitcherResult.footerElement);

      // Tour: check panel-home tour once the view switcher content is ready
      import('./tour').then(({ checkTour }) => {
        checkTour('panel-home', content);
      });

      // Tour: check hub tour + discovery when navigating to a group view
      const onHubTour = (e: Event) => {
        const viewId = (e as CustomEvent<{ viewId: string }>).detail.viewId;
        if (viewId !== 'home') {
          import('./tour').then(({ checkTour, startDiscovery }) => {
            checkTour('qpm-hub', content);
            startDiscovery('qpm-hub', content);
          });
        } else {
          import('./tour').then(({ stopDiscovery }) => {
            stopDiscovery('qpm-hub');
          });
        }
      };
      document.addEventListener('qpm:panel-view-change', onHubTour);
    } catch (e) {
      log('⚠️ Failed to load panel view switcher', e);
      content.textContent = `❌ ${t('panel.loadError')}`;
    }
  })();

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'qpm-panel__resize-handle';
  panel.append(titleBar, content, resizeHandle);

  let isPanelHidden = false;
  const setPanelHidden = (hidden: boolean) => {
    isPanelHidden = hidden;
    panel.style.display = hidden ? 'none' : '';
    if (!hidden) {
      requestAnimationFrame(() => clampPanelPosition());
    }
  };

  // ── Position / Collapse / Drag / Resize ──

  const applyPosition = (left: number, top: number) => {
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const savedPosition = storage.get<{ left: number; top: number } | null>(PANEL_POSITION_KEY, null);
  if (savedPosition && Number.isFinite(savedPosition.left) && Number.isFinite(savedPosition.top)) {
    applyPosition(savedPosition.left, savedPosition.top);
  }

  let isCollapsed = false;

  const applyCollapsed = (collapsed: boolean) => {
    isCollapsed = collapsed;
    content.style.display = collapsed ? 'none' : '';
    collapseIcon.textContent = collapsed ? '▲' : '▼';
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    storage.set(PANEL_COLLAPSED_KEY, collapsed);
    if (!collapsed) {
      requestAnimationFrame(() => clampPanelPosition());
    }
  };

  collapseButton.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  collapseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    applyCollapsed(!isCollapsed);
  });

  applyCollapsed(!!storage.get<boolean>(PANEL_COLLAPSED_KEY, false));

  let isDragging = false;
  let dragMoved = false;
  let pointerId: number | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let suppressClick = false;

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const getAvailablePanelWidth = () => Math.max(280, window.innerWidth - 32);
  const getMinPanelWidth = () => Math.min(currentViewId === 'home' ? MIN_HOME_WIDTH : MIN_PANEL_WIDTH, getAvailablePanelWidth());
  const getMaxPanelWidth = () => Math.min(MAX_PANEL_WIDTH, getAvailablePanelWidth());
  const clampPanelWidth = (width: number) => clamp(width, getMinPanelWidth(), getMaxPanelWidth());
  const applyPanelWidth = (width: number) => {
    panel.style.width = `${clampPanelWidth(width)}px`;
  };

  // Apply saved panel width
  const savedSize = storage.get<{ width: number; homeWidth?: number } | null>(PANEL_SIZE_KEY, null);
  if (savedSize?.width && Number.isFinite(savedSize.width)) {
    // Start on home — use homeWidth if available, otherwise default
    if (savedSize.homeWidth && Number.isFinite(savedSize.homeWidth)) {
      applyPanelWidth(savedSize.homeWidth);
    } else {
      applyPanelWidth(savedSize.width);
    }
  } else {
    applyPanelWidth(DEFAULT_PANEL_WIDTH);
  }

  // Resize handle
  let isResizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;
  let resizePointerId: number | null = null;

  resizeHandle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    if (!panel.style.left || panel.style.left === '') {
      const rect = panel.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
    }
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = panel.offsetWidth;
    resizePointerId = e.pointerId;
    resizeHandle.setPointerCapture(e.pointerId);
    panel.style.willChange = 'width';
  });

  resizeHandle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isResizing || resizePointerId !== e.pointerId) return;
    const newWidth = clampPanelWidth(resizeStartWidth + (e.clientX - resizeStartX));
    panel.style.width = `${newWidth}px`;
  });

  resizeHandle.addEventListener('pointerup', (e: PointerEvent) => {
    if (resizePointerId !== e.pointerId) return;
    isResizing = false;
    resizePointerId = null;
    panel.style.willChange = '';
    const currentSize = storage.get<{ width: number; homeWidth?: number } | null>(PANEL_SIZE_KEY, null) ?? { width: DEFAULT_PANEL_WIDTH };
    if (currentViewId === 'home') {
      currentSize.homeWidth = panel.offsetWidth;
    } else {
      currentSize.width = panel.offsetWidth;
    }
    storage.set(PANEL_SIZE_KEY, currentSize);
    clampPanelPosition();
  });

  resizeHandle.addEventListener('pointercancel', (e: PointerEvent) => {
    if (resizePointerId !== e.pointerId) return;
    isResizing = false;
    resizePointerId = null;
    panel.style.willChange = '';
  });

  const clampPanelPosition = () => {
    const clampedWidth = clampPanelWidth(panel.offsetWidth);
    if (Math.abs(clampedWidth - panel.offsetWidth) > 1) {
      panel.style.width = `${clampedWidth}px`;
    }

    const rect = panel.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - panelHeight - 8);

    const newLeft = clamp(rect.left, 8, maxLeft);
    const newTop = clamp(rect.top, 8, maxTop);

    if (Math.abs(newLeft - rect.left) > 1 || Math.abs(newTop - rect.top) > 1) {
      applyPosition(newLeft, newTop);
      storage.set(PANEL_POSITION_KEY, { left: Math.round(newLeft), top: Math.round(newTop) });
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isDragging || pointerId !== event.pointerId) return;

    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - panelHeight - 8);

    const newLeft = clamp(event.clientX - offsetX, 8, maxLeft);
    const newTop = clamp(event.clientY - offsetY, 8, maxTop);
    const rect = panel.getBoundingClientRect();

    if (!dragMoved && (Math.abs(newLeft - rect.left) > 2 || Math.abs(newTop - rect.top) > 2)) {
      dragMoved = true;
    }

    applyPosition(newLeft, newTop);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isDragging || pointerId !== event.pointerId) return;

    isDragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (panel.hasPointerCapture && panel.hasPointerCapture(event.pointerId)) {
      panel.releasePointerCapture(event.pointerId);
    } else {
      try {
        panel.releasePointerCapture(event.pointerId);
      } catch {}
    }
    titleBar.style.touchAction = '';
    panel.style.willChange = '';

    if (dragMoved) {
      suppressClick = true;
      const rect = panel.getBoundingClientRect();
      storage.set(PANEL_POSITION_KEY, { left: Math.round(rect.left), top: Math.round(rect.top) });
    }

    pointerId = null;
    dragMoved = false;
  };

  titleBar.addEventListener('pointerdown', (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && target.closest('[data-qpm-collapse-button]')) {
      return;
    }
    if (target && target.closest('.qpm-version-bubble')) {
      return;
    }
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return;
      if ((event.buttons & 1) !== 1) return;
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    isDragging = true;
    dragMoved = false;
    suppressClick = false;
    pointerId = event.pointerId;

    const rect = panel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;

    if (panel.setPointerCapture) {
      panel.setPointerCapture(event.pointerId);
    }
    titleBar.style.touchAction = 'none';
    panel.style.willChange = 'transform';
    event.preventDefault();
  });

  titleBar.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    applyCollapsed(!isCollapsed);
  });

  window.addEventListener('resize', clampPanelPosition);

  // Per-view width: swap between home (compact) and group (full) widths
  const onViewChange = (e: Event) => {
    const viewId = (e as CustomEvent<{ viewId: string }>).detail.viewId;
    const prevViewId = currentViewId;
    currentViewId = viewId;
    const size = storage.get<{ width: number; homeWidth?: number } | null>(PANEL_SIZE_KEY, null) ?? { width: DEFAULT_PANEL_WIDTH };

    if (prevViewId === 'home' && viewId !== 'home') {
      // Leaving home → save current width as homeWidth, expand to group width
      size.homeWidth = panel.offsetWidth;
      storage.set(PANEL_SIZE_KEY, size);
      const targetWidth = Math.max(panel.offsetWidth, MIN_PANEL_WIDTH);
      if (targetWidth !== panel.offsetWidth) {
        panel.style.transition = 'width 0.2s ease';
        applyPanelWidth(targetWidth);
        panel.addEventListener('transitionend', function onEnd(te) {
          if ((te as TransitionEvent).propertyName !== 'width') return;
          panel.removeEventListener('transitionend', onEnd);
          panel.style.transition = '';
          clampPanelPosition();
        });
      }
    } else if (prevViewId !== 'home' && viewId === 'home') {
      // Arriving at home → restore homeWidth if smaller
      if (size.homeWidth && Number.isFinite(size.homeWidth) && size.homeWidth < panel.offsetWidth) {
        panel.style.transition = 'width 0.2s ease';
        applyPanelWidth(size.homeWidth);
        panel.addEventListener('transitionend', function onEnd(te) {
          if ((te as TransitionEvent).propertyName !== 'width') return;
          panel.removeEventListener('transitionend', onEnd);
          panel.style.transition = '';
          clampPanelPosition();
        });
      }
    }
  };
  document.addEventListener('qpm:panel-view-change', onViewChange);

  _panelResizeCleanup = () => {
    window.removeEventListener('resize', clampPanelPosition);
    document.removeEventListener('qpm:panel-view-change', onViewChange);
  };

  document.body.appendChild(panel);
  setPanelHidden(false);
  startPanelHotkey(() => setPanelHidden(!isPanelHidden));

  // Tour: check panel-shell tour after the panel is in the DOM
  import('./tour').then(({ checkTour }) => {
    checkTour('panel-shell', panel);
  });

  uiState.panel = panel;
  uiState.content = content;
  return panel;
}



/**
 * Render function for the reminders modal window
 */
export function renderRemindersContent(root: HTMLElement, opts?: { startExpanded?: boolean }): void {
  renderRemindersWindow(root, opts);
}

function renderRemindersWindow(root: HTMLElement, opts?: { startExpanded?: boolean }): void {
  root.style.cssText = 'display:flex;flex-direction:column;gap:16px;width:100%;min-width:0;box-sizing:border-box;';

  const mutationSection = createMutationSection(uiState, cfg, saveCfg, opts);
  mutationSection.style.margin = '0';
  root.appendChild(mutationSection);
}



// Update functions
export function updateUIStatus(text: string): void {
  if (uiState.status) uiState.status.textContent = text;
}

export function updateWeatherUI(text: string): void {
  if (uiState.weatherStatus) uiState.weatherStatus.textContent = `Current: ${text}`;
}

export function updateShopStatus(text: string): void {
  if (uiState.shopStatus) uiState.shopStatus.textContent = text;
}

export function setCfg(newCfg: PanelCfg): void {
  cfg = newCfg;
}

export function openPublicRoomsWindow(): void {
  const renderFn = (root: HTMLElement) => {
    import('./publicRoomsWindow')
      .then(({ renderPublicRoomsWindow }) => renderPublicRoomsWindow(root))
      .catch(e => log('⚠️ Failed to load Public Rooms', e));
  };
  toggleWindow('public-rooms', '🌐 Public Rooms', renderFn, '950px', '85vh');
}

export function openJournalCheckerWindow(): void {
  toggleWindow('journal-checker-window', '📔 Journal Checker', (windowRoot) => {
    windowRoot.style.padding = '0';
    import('./journalChecker/index').then(({ createJournalCheckerSection }) => {
      windowRoot.appendChild(createJournalCheckerSection());
    }).catch(e => {
      log('⚠️ Failed to load Journal Checker', e);
      windowRoot.textContent = `❌ ${t('panel.windowLoadError')}`;
    });
  }, '900px', '90vh');
}

function saveCfg(): void {
  storage.set('quinoa-pet-manager', cfg);
}
