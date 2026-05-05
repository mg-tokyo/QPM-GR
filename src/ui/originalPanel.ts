// src/ui/originalPanel.ts - Main panel orchestrator
import { log } from '../utils/logger';
import { storage } from '../utils/storage';
import { getWeatherSnapshot } from '../store/weatherHub';

import { startVersionChecker, onVersionChange, getCurrentVersion, type VersionInfo, type VersionStatus } from '../utils/versionChecker';
import { yieldToBrowser } from '../utils/scheduling';
import { ensurePanelStyles } from './panelStyles';
import { showToast, formatWeatherLabel } from './panelHelpers';
import { toggleWindow, isWindowOpen } from './modalWindow';
import { UIState, createInitialUIState } from './panelState';
import { createNotificationSection } from './notificationSection';
import { createMutationSection } from './sections/mutationValueSection';
import { createStatsHeader } from './sections/statsHeaderSection';
import { onActivePetInfos, type ActivePetInfo } from '../store/pets';
import { getRestockDataSync } from '../utils/restockDataService';
import { getCropSpriteCanvas, getPetSpriteCanvas, getAnySpriteDataUrl, onSpritesReady } from '../sprite-v2/compat';
import { canvasToDataUrl } from '../utils/canvasHelpers';
import { visibleInterval } from '../utils/timerManager';
import { calculateMaxStrength } from '../store/xpTracker';
import { listRooms } from '../services/ariesRooms';
import { getMutationValueSnapshot } from '../features/mutationValueTracking';

let uiState = createInitialUIState();

const PANEL_POSITION_KEY = 'quinoa-ui-panel-position';
const PANEL_COLLAPSED_KEY = 'quinoa-ui-panel-collapsed';
const PANEL_SIZE_KEY = 'quinoa-ui-panel-size';
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 620;

let _panelResizeCleanup: (() => void) | null = null;

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
  titleBar.title = 'Drag to move • Click to collapse';

  const titleText = document.createElement('span');
  titleText.textContent = '🍖 Quinoa Pet Manager';

  // Create version bubble
  const versionBubble = document.createElement('a');
  versionBubble.className = 'qpm-version-bubble';
  versionBubble.dataset.status = 'checking';
  versionBubble.textContent = `v${getCurrentVersion()}`;
  versionBubble.title = 'Checking for updates...';
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
      versionBubble.title = `Update available! Current: v${info.current}\nLatest: v${info.latest}\nClick to open the latest userscript.`;
    } else if (info.status === 'error') {
      versionBubble.textContent = `v${info.current}`;
      versionBubble.title = 'Version check failed. Click to open the repo.';
    } else if (info.status === 'checking') {
      versionBubble.textContent = `v${info.current}`;
      versionBubble.title = 'Checking for updates...';
    } else {
      versionBubble.textContent = `v${info.current}`;
      versionBubble.title = `QPM v${info.current}\nUp to date.`;
    }
  };

  const VERSION_SCRIPT_URL = 'https://raw.githubusercontent.com/ryandt2305-cpu/QPM-GR/master/dist/QPM.user.js';
  versionBubble.href = VERSION_SCRIPT_URL;

  const openVersionLink = (): void => {
    // Append cache-busting param so GitHub CDN is bypassed and Tampermonkey
    // sees the fresh @version (not the stale cached file).
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
  collapseButton.setAttribute('aria-label', 'Collapse panel');

  const collapseIcon = document.createElement('span');
  collapseIcon.textContent = '▼';
  collapseButton.appendChild(collapseIcon);

  titleBar.append(titleText, versionBubble, collapseButton);

  const content = document.createElement('div');
  content.className = 'qpm-content';

  const navSections = document.createElement('div');
  navSections.className = 'qpm-nav-sections';

  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'qpm-tabs';

  // ── Section collapse divider (collapses just the tab content, not the nav tiles) ──
  const SECTION_COLLAPSED_KEY = 'qpm.sectionCollapsed';
  const sectionDivider = document.createElement('div');
  sectionDivider.style.cssText = [
    'display:flex',
    'align-items:center',
    'padding:3px 14px',
    'cursor:pointer',
    'user-select:none',
    'flex-shrink:0',
    'transition:background 0.15s',
  ].join(';');
  sectionDivider.addEventListener('mouseenter', () => { sectionDivider.style.background = 'rgba(143,130,255,0.04)'; });
  sectionDivider.addEventListener('mouseleave', () => { sectionDivider.style.background = ''; });

  const dividerLineL = document.createElement('div');
  dividerLineL.style.cssText = 'flex:1;height:1px;background:rgba(143,130,255,0.1);';
  const dividerIcon = document.createElement('span');
  dividerIcon.style.cssText = 'font-size:9px;color:rgba(200,192,255,0.3);padding:0 6px;line-height:1;transition:color 0.15s;';
  dividerIcon.textContent = '▼';
  const dividerLineR = document.createElement('div');
  dividerLineR.style.cssText = 'flex:1;height:1px;background:rgba(143,130,255,0.1);';
  sectionDivider.append(dividerLineL, dividerIcon, dividerLineR);

  let isSectionCollapsed = storage.get<boolean>(SECTION_COLLAPSED_KEY, false);
  const applySectionCollapsed = (collapsed: boolean, save = true) => {
    isSectionCollapsed = collapsed;
    tabsContainer.style.display = collapsed ? 'none' : '';
    dividerIcon.textContent = collapsed ? '▶' : '▼';
    if (save) storage.set(SECTION_COLLAPSED_KEY, collapsed);
  };
  sectionDivider.addEventListener('click', () => applySectionCollapsed(!isSectionCollapsed));

  content.append(navSections, sectionDivider, tabsContainer);
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'qpm-panel__resize-handle';
  panel.append(titleBar, content, resizeHandle);

  // Create UI sections
  const statsHeader = createStatsHeader(uiState, cfg, saveCfg);
  await yieldToBrowser();

  const notificationsSection = createNotificationSection(uiState);
  await yieldToBrowser();

  const tabs = new Map<string, HTMLElement>();
  const tabButtons = new Map<string, HTMLButtonElement>();
  let activeTab: string | null = null;

  const activateTab = (key: string) => {
    if (activeTab === key) return;
    activeTab = key;
    // Auto-expand section when switching to an inline tab with content
    if (isSectionCollapsed) applySectionCollapsed(false);
    for (const [tabKey, tabContent] of tabs) {
      tabContent.classList.toggle('qpm-tab--active', tabKey === key);
    }
    for (const [tabKey, button] of tabButtons) {
      const isActive = tabKey === key;
      button.classList.toggle('qpm-tile--active', isActive);
      
      // Apply color coding with glow - each button has unique color
      if (button.dataset.tabColor) {
        const baseColor = button.dataset.tabColor;
        // Extract RGB values for glow effect
        const rgbMatch = baseColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const glowColor = rgbMatch ? `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.4)` : baseColor;
        
        // Check if this tab has an associated window that's open
        const windowId = button.dataset.windowId;
        const isWindowActive = windowId && isWindowOpen(windowId);
        
        if (isActive || isWindowActive) {
          button.style.background = baseColor;
          button.style.boxShadow = `0 4px 14px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.1)`;
          button.style.borderColor = baseColor.replace('0.28', '0.6');
        } else {
          // All buttons show their color dimly with subtle glow
          button.style.background = baseColor.replace('0.28', '0.12');
          button.style.boxShadow = `0 2px 8px ${glowColor.replace('0.4', '0.15')}`;
          button.style.borderColor = baseColor.replace('0.28', '0.3');
        }
      }
    }
  };

  const tabColors: Record<string, string> = {
    'dashboard':       'rgba(76, 175, 80, 0.28)',   // Green
    'hub':             'rgba(143, 130, 255, 0.28)', // Accent purple
    'shop-restock':    'rgba(0, 188, 212, 0.28)',   // Cyan
    'pet-teams':       'rgba(255, 152, 0, 0.28)',   // Orange
    'public-rooms':    'rgba(233, 30, 99, 0.28)',   // Pink
    'journal-checker': 'rgba(121, 85, 72, 0.28)',   // Brown
  };

  const buildSection = (header: string) => {
    const section = document.createElement('div');
    section.className = 'qpm-nav-section';
    const head = document.createElement('div');
    head.className = 'qpm-nav-section__header';
    head.textContent = header;
    section.appendChild(head);
    const addRow = (tiles: HTMLElement[]) => {
      const row = document.createElement('div');
      row.className = 'qpm-nav-section__row';
      tiles.forEach(t => row.appendChild(t));
      section.appendChild(row);
    };
    return { section, addRow };
  };

  const buildTile = (key: string, icon: string, label: string) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'qpm-tile';
    const labelEl = document.createElement('div');
    labelEl.className = 'qpm-tile__label';
    labelEl.innerHTML = `${icon}<span>${label}</span>`;
    const statusEl = document.createElement('div');
    statusEl.className = 'qpm-tile__status';
    tile.append(labelEl, statusEl);
    const tabColor = tabColors[key];
    if (tabColor) {
      tile.dataset.tabColor = tabColor;
      const rgbMatch = tabColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      const glowColor = rgbMatch
        ? `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, 0.15)`
        : tabColor;
      tile.style.background = tabColor.replace('0.28', '0.12');
      tile.style.boxShadow = `0 2px 8px ${glowColor}`;
      tile.style.borderColor = tabColor.replace('0.28', '0.3');
    }
    const setStatus = (text: string, variant: 'alert' | 'positive' | '' = '') => {
      statusEl.innerHTML = '';
      statusEl.textContent = text;
      statusEl.className = 'qpm-tile__status' + (variant ? ` qpm-tile__status--${variant}` : '');
    };
    const setStatusDom = (render: (el: HTMLElement) => void): void => {
      statusEl.innerHTML = '';
      statusEl.className = 'qpm-tile__status';
      render(statusEl);
    };
    return { tile, setStatus, setStatusDom };
  };

  const registerTabPanel = (key: string, elements: HTMLElement[]) => {
    const tab = document.createElement('div');
    tab.className = 'qpm-tab';
    for (const el of elements) tab.appendChild(el);
    tabsContainer.appendChild(tab);
    tabs.set(key, tab);
  };

  // ── PETS ──
  const { section: petsSection, addRow: petsRow } = buildSection('PETS');
  const { tile: tPetTeams, setStatus: setPetTeamsStatus } = buildTile('pet-teams', '👥', 'Pet Teams');
  tPetTeams.dataset.windowId = 'qpm-pets-window';
  tPetTeams.addEventListener('click', async () => {
    try {
      const { togglePetsWindow } = await import('./petsWindow');
      togglePetsWindow();
    } catch (e) {
      log('⚠️ Failed to toggle Pets window', e);
    }
  });
  petsRow([tPetTeams]);
  navSections.appendChild(petsSection);
  tabButtons.set('pet-teams', tPetTeams);

  // ── GAME ──
  const { section: gameSection, addRow: gameRow } = buildSection('GAME');
  const { tile: tHub, setStatus: setHubStatus } = buildTile('hub', '🔮', 'Hub');
  tHub.dataset.windowId = 'qpm-hub';
  // Upgrade Hub tile icon to sprite when available
  const hubLabelEl = tHub.querySelector('.qpm-tile__label');
  if (hubLabelEl) {
    const upgradeHubIcon = () => {
      const url = getAnySpriteDataUrl('sprite/pet/Peacock');
      if (url && hubLabelEl.firstChild?.nodeType === Node.TEXT_NODE) {
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'width:16px;height:16px;image-rendering:pixelated;vertical-align:middle;margin-right:2px;';
        hubLabelEl.replaceChild(img, hubLabelEl.firstChild);
      }
    };
    upgradeHubIcon();
    if (!getAnySpriteDataUrl('sprite/pet/Peacock')) onSpritesReady(upgradeHubIcon);
  }
  tHub.addEventListener('click', async () => {
    try {
      const { toggleHub } = await import('./hubWindow');
      toggleHub();
    } catch (e) {
      log('⚠️ Failed to open QPM Hub', e);
    }
  });
  const { tile: tShop, setStatus: setShopStatus, setStatusDom: setShopStatusDom } = buildTile('shop-restock', '🏪', 'Shop Restock');
  const applyShopTileCoinIcon = (): void => {
    const labelEl = tShop.querySelector('.qpm-tile__label') as HTMLElement | null;
    if (!labelEl) return;

    const coinUrl = getAnySpriteDataUrl('sprite/ui/Coin');
    labelEl.innerHTML = '';

    if (coinUrl) {
      const coinImg = document.createElement('img');
      coinImg.src = coinUrl;
      coinImg.alt = 'Coin';
      coinImg.style.cssText = 'width:15px;height:15px;image-rendering:pixelated;flex-shrink:0;';
      labelEl.appendChild(coinImg);
    } else {
      const fallbackIcon = document.createElement('span');
      fallbackIcon.textContent = '🏪';
      fallbackIcon.setAttribute('aria-hidden', 'true');
      labelEl.appendChild(fallbackIcon);
    }

    const labelText = document.createElement('span');
    labelText.textContent = 'Shop Restock';
    labelEl.appendChild(labelText);
  };
  applyShopTileCoinIcon();
  onSpritesReady(() => {
    applyShopTileCoinIcon();
  });
  tShop.dataset.windowId = 'shop-restock';
  tShop.addEventListener('click', async () => {
    try {
      const { openShopRestockWindow } = await import('./shopRestockWindow');
      openShopRestockWindow();
    } catch (e) {
      log('⚠️ Failed to open Shop Restock window', e);
    }
  });
  gameRow([tHub, tShop]);
  const { tile: tRooms, setStatus: setRoomsStatus } = buildTile('public-rooms', '🌐', 'Public Rooms');
  tRooms.dataset.windowId = 'public-rooms';
  tRooms.addEventListener('click', () => {
    const renderFn = (root: HTMLElement) => {
      import('./publicRoomsWindow')
        .then(({ renderPublicRoomsWindow }) => renderPublicRoomsWindow(root))
        .catch(e => log('⚠️ Failed to load Public Rooms', e));
    };
    toggleWindow('public-rooms', '🌐 Public Rooms', renderFn, '950px', '85vh');
  });
  gameRow([tRooms]);
  navSections.appendChild(gameSection);
  tabButtons.set('hub', tHub);
  tabButtons.set('shop-restock', tShop);
  tabButtons.set('public-rooms', tRooms);

  // ── TOOLS ──
  const { section: toolsSection, addRow: toolsRow } = buildSection('TOOLS');
  const { tile: tDash, setStatus: setDashStatus } = buildTile('dashboard', '📊', 'Dashboard');
  tDash.addEventListener('click', () => activateTab('dashboard'));
  const { tile: tJournal, setStatus: setJournalStatus } = buildTile('journal-checker', '📔', 'Journal');
  tJournal.dataset.windowId = 'journal-checker-window';
  tJournal.addEventListener('click', () => {
    toggleWindow('journal-checker-window', '📔 Journal Checker', (windowRoot) => {
      windowRoot.style.padding = '0';
      import('./journalCheckerSection').then(({ createJournalCheckerSection }) => {
        windowRoot.appendChild(createJournalCheckerSection());
      }).catch(e => {
        log('⚠️ Failed to load Journal Checker', e);
        windowRoot.textContent = '❌ Failed to load. Reload the page and try again.';
      });
    }, '900px', '90vh');
  });
  toolsRow([tDash, tJournal]);
  navSections.appendChild(toolsSection);
  tabButtons.set('dashboard', tDash);
  tabButtons.set('journal-checker', tJournal);

  // ── Tab panels (inline content for dashboard only; empty for window-openers) ──
  registerTabPanel('pet-teams', []);
  registerTabPanel('hub', []);
  registerTabPanel('shop-restock', []);
  registerTabPanel('public-rooms', []);
  registerTabPanel('dashboard', [statsHeader]);

  activateTab('dashboard');
  // Apply persisted section collapse state (after activateTab so auto-expand logic doesn't fight it)
  applySectionCollapsed(isSectionCollapsed, false);

  // ── Live status subscriptions ──

  // Pet Teams tile — hunger + XP booster + avg % to each pet's own max strength
  onActivePetInfos((pets: ActivePetInfo[]) => {
    if (!pets.length) { setPetTeamsStatus('No active pets'); return; }
    const hungry = pets.filter(p => p.hungerPct !== null && p.hungerPct < 30);
    const hasXpBooster = pets.some(p =>
      p.abilities.some(a => a.toLowerCase().includes('xp'))
    );
    // Per-pet: strength / maxStrength * 100 (each pet relative to its own max)
    const pctToMax = pets.reduce<number[]>((acc, p) => {
      if (p.strength === null || p.targetScale === null || p.species === null) return acc;
      const maxStr = calculateMaxStrength(p.targetScale, p.species);
      if (maxStr === null || maxStr <= 0) return acc;
      acc.push(Math.round((p.strength / maxStr) * 100));
      return acc;
    }, []);
    const avgPct = pctToMax.length
      ? Math.round(pctToMax.reduce((a, b) => a + b, 0) / pctToMax.length)
      : null;
    // TODO: add XP/hr when rate tracking available; TODO: add gold/hr when field exists
    const strText = avgPct !== null ? `avg ${avgPct}% max` : '';
    if (hungry.length > 0) {
      const lowestHunger = Math.min(...hungry.map(p => p.hungerPct as number));
      setPetTeamsStatus(
        `${hungry.length} hungry (${Math.round(lowestHunger)}%)${strText ? ` · ${strText}` : ''}`,
        'alert',
      );
    } else if (hasXpBooster) {
      setPetTeamsStatus(
        `XP boost active · ${strText || 'all fed ✓'}`,
        'positive',
      );
    } else {
      // No XP booster — show $/hr from mutation + ability value tracking
      // sessionValue = goldTotalValue + rainbowTotalValue + cropBoostTotalValue (actual coin values)
      // Divide by session hours to get real $/hr (goldPerHour etc. are proc counts, not coin values)
      const mvs = getMutationValueSnapshot();
      const mvsStats = mvs?.stats;
      const sessionHours = mvsStats
        ? Math.max(1 / 60, (Date.now() - mvsStats.sessionStart) / 3_600_000)
        : 0;
      const totalPerHour = mvsStats && sessionHours > 0
        ? mvsStats.sessionValue / sessionHours
        : 0;
      const earningsText = totalPerHour >= 1
        ? `$${Math.round(totalPerHour).toLocaleString()}/hr`
        : '';
      const parts = ['All fed ✓', strText, earningsText].filter(Boolean).join(' · ');
      setPetTeamsStatus(parts, 'positive');
    }
  });

  // Hub tile — static status
  setHubStatus('All features');

  // Shop Restock tile — sprite row for all tracked items (future items bright, overdue dimmed)
  const shopSpriteCache = new Map<string, string | null>();
  const getShopSpriteUrl = (id: string): string | null => {
    if (shopSpriteCache.has(id)) return shopSpriteCache.get(id)!;
    let url: string | null = null;
    try { url = canvasToDataUrl(getCropSpriteCanvas(id)) || null; } catch { /* not ready */ }
    if (!url) { try { url = canvasToDataUrl(getPetSpriteCanvas(id)) || null; } catch { /* not ready */ } }
    shopSpriteCache.set(id, url);
    return url;
  };
  let lastShopFingerprint = '';
  const updateShopTile = () => {
    const tracked = storage.get<string[] | null>('qpm.restock.tracked', null);
    if (!tracked?.length) { setShopStatus(''); return; }
    const data = getRestockDataSync();
    if (!data?.length) { setShopStatus(`${tracked.length} tracked`); return; }
    const trackedSet = new Set(tracked);
    const now = Date.now();
    const items = data
      .filter(item => trackedSet.has(`${item.shop_type}:${item.item_id}`))
      .sort((a, b) => {
        // Future items first (soonest first), overdue/missing last
        const aTs = (a.estimated_next_timestamp ?? 0) > now ? a.estimated_next_timestamp! : Infinity;
        const bTs = (b.estimated_next_timestamp ?? 0) > now ? b.estimated_next_timestamp! : Infinity;
        return aTs - bTs;
      });
    if (!items.length) { setShopStatus(''); return; }
    const shopFingerprint = items.slice(0, 10).map(item => {
      const overdue = !item.estimated_next_timestamp || item.estimated_next_timestamp <= now;
      return `${item.item_id}:${overdue ? 1 : 0}`;
    }).join(',');
    if (shopFingerprint === lastShopFingerprint) return;
    lastShopFingerprint = shopFingerprint;
    setShopStatusDom(el => {
      el.style.cssText += ';display:flex;align-items:center;gap:2px;flex-wrap:nowrap;overflow:hidden;';
      for (const item of items.slice(0, 10)) {
        const isOverdue = !item.estimated_next_timestamp || item.estimated_next_timestamp <= now;
        const spriteUrl = getShopSpriteUrl(item.item_id);
        const img = document.createElement('img');
        img.style.cssText = `height:14px;width:auto;image-rendering:pixelated;flex-shrink:0;opacity:${isOverdue ? '0.3' : '1'};`;
        if (spriteUrl) {
          img.src = spriteUrl;
        } else {
          // Fallback dot when sprite not yet loaded
          img.style.cssText += 'display:none;';
        }
        el.appendChild(img);
      }
      if (items.length > 10) {
        const more = document.createElement('span');
        more.style.cssText = 'font-size:9px;color:rgba(140,150,190,0.5);flex-shrink:0;';
        more.textContent = `+${items.length - 10}`;
        el.appendChild(more);
      }
    });
  };
  visibleInterval('qpm-nav-shop', updateShopTile, 10_000);
  updateShopTile();

  // Static tile statuses
  setRoomsStatus('View active rooms');
  setDashStatus('Stats & overview');
  setJournalStatus('Loading tips...');

  // Journal tile — async smart tips: inline sprites only, mutation dot overlay
  (async () => {
    try {
      const { generateJournalStrategy } = await import('../features/journalRecommendations');
      const strategy = await generateJournalStrategy();
      if (!strategy?.recommendedFocus?.length) {
        setJournalStatus('Produce · Pets · Smart Tips');
        return;
      }
      const top3 = strategy.recommendedFocus.slice(0, 3);
      const {
        getCropSpriteWithMutations,
        getCropSpriteCanvas,
        getPetSpriteCanvas,
        getPetSpriteDataUrlWithMutations,
      } = await import('../sprite-v2/compat');
      const { canvasToDataUrl } = await import('../utils/canvasHelpers');

      const statusEl = tJournal.querySelector('.qpm-tile__status') as HTMLElement | null;
      if (!statusEl) return;


      // Switch statusEl to flex row for inline sprites
      statusEl.textContent = '';
      statusEl.style.display = 'flex';
      statusEl.style.alignItems = 'center';
      statusEl.style.gap = '3px';
      statusEl.style.overflow = 'hidden';
      statusEl.style.whiteSpace = 'nowrap';
      statusEl.style.flexWrap = 'nowrap';

      let hasAny = false;
      for (const rec of top3) {
        const mutation = rec.missingVariants[0] ?? null;
        const mutations = mutation ? [mutation] : [];
        const name = rec.species;
        const nameNoSpace = name.replace(/\s+/g, '');
        let spriteUrl: string | null = null;
        if (rec.type === 'produce') {
          spriteUrl = (mutations.length
            ? canvasToDataUrl(getCropSpriteWithMutations(name, mutations)) ||
              canvasToDataUrl(getCropSpriteWithMutations(nameNoSpace, mutations))
            : null) ||
            canvasToDataUrl(getCropSpriteCanvas(name)) ||
            canvasToDataUrl(getCropSpriteCanvas(nameNoSpace));
        } else {
          const hasRainbow = rec.missingVariants.some((variant) => variant.toLowerCase() === 'rainbow');
          const hasGold = rec.missingVariants.some((variant) => variant.toLowerCase() === 'gold');
          const mutation = hasRainbow ? 'Rainbow' : hasGold ? 'Gold' : null;
          spriteUrl = (mutation
            ? getPetSpriteDataUrlWithMutations(name, [mutation]) ||
              getPetSpriteDataUrlWithMutations(nameNoSpace, [mutation])
            : '') ||
            canvasToDataUrl(getPetSpriteCanvas(name)) ||
            canvasToDataUrl(getPetSpriteCanvas(nameNoSpace));
        }
        if (!spriteUrl) continue;
        hasAny = true;

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width:19px;height:19px;flex-shrink:0;display:inline-flex;';
        wrapper.title = mutation ? `${name} (${mutation})` : name;

        const img = document.createElement('img');
        img.src = spriteUrl;
        img.alt = name;
        img.style.cssText = 'width:19px;height:19px;image-rendering:pixelated;display:block;';
        wrapper.appendChild(img);

        statusEl.appendChild(wrapper);
      }

      if (!hasAny) {
        statusEl.style.display = '';
        setJournalStatus('Produce · Pets · Smart Tips');
      }
    } catch {
      setJournalStatus('Produce · Pets · Smart Tips');
    }
  })();

  // Public Rooms tile — one-shot fetch for room count + full count (300 matches publicRooms feature)
  listRooms(300).then(response => {
    const rooms = response.data;
    if (!Array.isArray(rooms) || rooms.length === 0) return;
    const fullCount = rooms.filter(r => r.playersCount >= 3).length;
    setRoomsStatus(
      fullCount > 0
        ? `${rooms.length} rooms · ${fullCount} full`
        : `${rooms.length} active rooms`,
    );
  }).catch(() => { /* keep fallback */ });

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

  // Track collapsed state explicitly to avoid reading DOM display values
  let isCollapsed = false;

  const applyCollapsed = (collapsed: boolean) => {
    isCollapsed = collapsed;
    // Hide entire content area for ultra-compact titlebar-only profile
    content.style.display = collapsed ? 'none' : '';
    collapseIcon.textContent = collapsed ? '▲' : '▼';
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    storage.set(PANEL_COLLAPSED_KEY, collapsed);
    // After expanding, reposition panel to stay within viewport
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

  // Apply saved panel width (user may have resized in a previous session)
  const savedSize = storage.get<{ width: number } | null>(PANEL_SIZE_KEY, null);
  if (savedSize?.width && Number.isFinite(savedSize.width)) {
    panel.style.width = `${clamp(savedSize.width, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH)}px`;
  }

  // Resize handle — drag bottom-right corner to adjust panel width
  let isResizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;
  let resizePointerId: number | null = null;

  resizeHandle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    // If the panel is CSS right-anchored (no explicit left set), convert to
    // left-anchored so the resize handle tracks the cursor correctly.
    // Without this, increasing width expands leftward while the handle stays
    // pinned to the right viewport edge, making direction feel inverted.
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
    const newWidth = clamp(resizeStartWidth + (e.clientX - resizeStartX), MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
    panel.style.width = `${newWidth}px`;
  });

  resizeHandle.addEventListener('pointerup', (e: PointerEvent) => {
    if (resizePointerId !== e.pointerId) return;
    isResizing = false;
    resizePointerId = null;
    panel.style.willChange = '';
    storage.set(PANEL_SIZE_KEY, { width: panel.offsetWidth });
    clampPanelPosition();
  });

  resizeHandle.addEventListener('pointercancel', (e: PointerEvent) => {
    if (resizePointerId !== e.pointerId) return;
    isResizing = false;
    resizePointerId = null;
    panel.style.willChange = '';
  });

  // Clamp panel position to keep it visible within viewport
  const clampPanelPosition = () => {
    const rect = panel.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - panelHeight - 8);

    const newLeft = clamp(rect.left, 8, maxLeft);
    const newTop = clamp(rect.top, 8, maxTop);

    // Only update if position changed
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
      return; // let version bubble handle its own click/navigation
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

  // Add resize listener to keep panel visible when viewport changes
  window.addEventListener('resize', clampPanelPosition);
  _panelResizeCleanup = () => window.removeEventListener('resize', clampPanelPosition);

  document.body.appendChild(panel);

  uiState.panel = panel;
  uiState.content = content;
  return panel;
}




function refreshHeaderStats(): void {
  if (!uiState.headerWeather) {
    return;
  }

  // Weather segment
  let weatherLabel = 'Unknown';
  const weatherParts: string[] = [];

  try {
    const snapshot = getWeatherSnapshot();
    weatherLabel = formatWeatherLabel(snapshot.kind);
    weatherParts.push(weatherLabel);
  } catch {
    weatherParts.push(weatherLabel);
  }

  if (weatherParts.length === 0) {
    weatherParts.push(weatherLabel);
  }

  uiState.headerWeather.textContent = weatherParts.join(' • ');
}



/**
 * Render function for the reminders modal window
 */
export function renderRemindersContent(root: HTMLElement): void {
  renderRemindersWindow(root);
}

function renderRemindersWindow(root: HTMLElement): void{
  root.style.cssText = 'display: flex; flex-direction: column; gap: 16px; min-width: 600px;';

  const mutationSection = createMutationSection(uiState, cfg, saveCfg);
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
    import('./journalCheckerSection').then(({ createJournalCheckerSection }) => {
      windowRoot.appendChild(createJournalCheckerSection());
    }).catch(e => {
      log('⚠️ Failed to load Journal Checker', e);
      windowRoot.textContent = '❌ Failed to load. Reload the page and try again.';
    });
  }, '900px', '90vh');
}

function saveCfg(): void {
  storage.set('quinoa-pet-manager', cfg);
}
