import { storage } from '../../../utils/storage';
import { t } from '../../../i18n';

const PANEL_WIDTH = 640;
const TAB_WIDTH = 32;
const TAB_HEIGHT = 38;
const TAB_TOP_OFFSET = 2;
const HEADER_BAND_HEIGHT = 42;
const SLIDE_TAB_KEY = 'qpm.gardenPainter.slideOutTab.v1';

export type SlideTabId = 'assets' | 'pickATile';

export interface SlideoutHandle {
  panel: HTMLElement;
  tabBtn: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  setBanner(banner: HTMLElement | null): void;
  setAssetBody(body: HTMLElement): void;
  setPickATileBody(body: HTMLElement): void;
  setActiveTab(tab: SlideTabId): void;
  getActiveTab(): SlideTabId;
  destroy(): void;
}

export function createSlideoutPanel(opts: {
  anchorWindowEl: HTMLElement;
  storageKey: string;
  onOpenChange?: (open: boolean) => void;
}): SlideoutHandle {
  const { anchorWindowEl, storageKey, onOpenChange } = opts;

  let openState = storage.get<boolean>(storageKey, true) ?? true;
  let bannerEl: HTMLElement | null = null;
  let assetBodyEl: HTMLElement | null = null;
  let pickATileBodyEl: HTMLElement | null = null;
  let slideTab: SlideTabId = storage.get<SlideTabId>(SLIDE_TAB_KEY, 'assets') ?? 'assets';
  let tabRowEl: HTMLElement | null = null;

  // Track whether the modal frame has gained dimensions yet. Until then, both
  // the tab button and the panel stay hidden so they don't flash at (0,0)
  // before the modal's layout commits.
  let measuredOnce = false;

  const tabBtn = document.createElement('button');
  tabBtn.type = 'button';
  tabBtn.style.cssText = `position:fixed;width:${TAB_WIDTH}px;height:${TAB_HEIGHT}px;border:1px solid var(--qpm-accent-hover);background:var(--qpm-accent);color:#fff;font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-bold);cursor:pointer;display:none;align-items:center;justify-content:center;transition:background 0.15s,box-shadow 0.15s;padding:0;font-family:inherit;box-shadow:2px 0 10px rgba(143,130,255,0.5);z-index:10001;`;
  tabBtn.addEventListener('mouseenter', () => { tabBtn.style.background = 'var(--qpm-accent-hover)'; });
  tabBtn.addEventListener('mouseleave', () => { tabBtn.style.background = openState ? 'var(--qpm-accent-hover)' : 'var(--qpm-accent)'; });
  document.body.appendChild(tabBtn);

  const panel = document.createElement('div');
  panel.style.cssText = `position:fixed;width:${PANEL_WIDTH}px;display:none;flex-direction:column;background:var(--qpm-surface-window);border:1px solid var(--qpm-accent-emphasis);box-shadow:4px 0 20px rgba(0,0,0,0.4);font-family:inherit;font-size:var(--qpm-font-body);color:var(--qpm-text);transition:opacity 0.15s,transform 0.15s;z-index:10000;overflow:hidden;`;
  document.body.appendChild(panel);

  const reposition = (): void => {
    // First: handle the modal being hidden (closeWindow sets display:none).
    // We need to do this BEFORE the rect-zero early-return because a hidden
    // element returns 0×0 from getBoundingClientRect.
    const hidden = anchorWindowEl.style.display === 'none';
    if (hidden) {
      tabBtn.style.display = 'none';
      panel.style.display = 'none';
      return;
    }

    const rect = anchorWindowEl.getBoundingClientRect();
    const z = anchorWindowEl.style.zIndex || '10000';

    // If the windowEl hasn't laid out yet (rect 0×0), skip — the ResizeObserver
    // will re-fire once it gains dimensions.
    if (rect.width === 0 && rect.height === 0) return;
    measuredOnce = true;

    // Decide which side to anchor on: prefer right, fall back to left if no room.
    const fitsRight = rect.right + PANEL_WIDTH + TAB_WIDTH < window.innerWidth - 8;

    if (fitsRight) {
      tabBtn.style.left = `${rect.right}px`;
      tabBtn.style.borderRadius = '0 var(--qpm-radius-md) var(--qpm-radius-md) 0';
      tabBtn.style.borderLeft = 'none';
      tabBtn.style.borderRight = '1px solid var(--qpm-accent-emphasis)';
      panel.style.left = `${rect.right}px`;
      panel.style.borderRadius = '0 var(--qpm-radius-lg) var(--qpm-radius-lg) 0';
      panel.style.borderLeft = 'none';
      panel.style.borderRight = '1px solid var(--qpm-accent-emphasis)';
    } else {
      tabBtn.style.left = `${rect.left - TAB_WIDTH}px`;
      tabBtn.style.borderRadius = 'var(--qpm-radius-md) 0 0 var(--qpm-radius-md)';
      tabBtn.style.borderRight = 'none';
      tabBtn.style.borderLeft = '1px solid var(--qpm-accent-emphasis)';
      panel.style.left = `${rect.left - PANEL_WIDTH}px`;
      panel.style.borderRadius = 'var(--qpm-radius-lg) 0 0 var(--qpm-radius-lg)';
      panel.style.borderRight = 'none';
      panel.style.borderLeft = '1px solid var(--qpm-accent-emphasis)';
    }

    tabBtn.style.top = `${rect.top + TAB_TOP_OFFSET}px`;
    tabBtn.style.zIndex = String(Number(z) + 1);

    panel.style.top = `${rect.top + HEADER_BAND_HEIGHT}px`;
    panel.style.height = `${Math.max(rect.height - HEADER_BAND_HEIGHT, 0)}px`;
    panel.style.zIndex = z;

    tabBtn.style.display = 'flex';
    panel.style.display = openState ? 'flex' : 'none';
  };

  function buildTabRow(): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

    const makeTab = (id: SlideTabId, label: string): HTMLElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      const active = slideTab === id;
      btn.style.cssText = `padding:6px 12px;border-radius:var(--qpm-radius-md);background:${active ? 'rgba(143,130,255,0.25)' : 'rgba(255,255,255,0.05)'};color:${active ? '#fff' : 'rgba(255,255,255,0.7)'};cursor:pointer;border:none;font-family:var(--qpm-font);font-size:12px;`;
      btn.addEventListener('click', () => {
        slideTab = id;
        storage.set(SLIDE_TAB_KEY, id);
        render();
      });
      return btn;
    };

    row.appendChild(makeTab('assets', t('feature.gardenPainter.tabAssets')));
    row.appendChild(makeTab('pickATile', t('feature.gardenPainter.tabPickATile')));
    return row;
  }

  const render = (): void => {
    tabBtn.textContent = openState ? '‹' : '+';
    tabBtn.title = t(openState ? 'feature.gardenPainter.gridClose' : 'feature.gardenPainter.gridOpen');
    if (openState) {
      panel.innerHTML = '';
      if (bannerEl) panel.appendChild(bannerEl);
      tabRowEl = buildTabRow();
      panel.appendChild(tabRowEl);
      const activeBody = slideTab === 'assets' ? assetBodyEl : pickATileBodyEl;
      if (activeBody) panel.appendChild(activeBody);
    }
    reposition();
    if (measuredOnce) {
      tabBtn.style.display = 'flex';
      panel.style.display = openState ? 'flex' : 'none';
    }
  };

  const setOpen = (next: boolean): void => {
    if (openState === next) return;
    openState = next;
    storage.set(storageKey, next);
    render();
    onOpenChange?.(next);
  };

  tabBtn.addEventListener('click', () => setOpen(!openState));

  // Track window movement/resize via the modal frame itself. The Blobling
  // gridPicker (src/ui/bloblingCustomiser/gridPicker.ts:328-339) uses the same
  // dual observer pattern. Without these, the slide-out lands at (0,0) when
  // the modal hasn't committed layout yet and never recovers.
  const mutObs = new MutationObserver(() => reposition());
  mutObs.observe(anchorWindowEl, { attributes: true, attributeFilter: ['style'] });

  const resObs = new ResizeObserver(() => reposition());
  resObs.observe(anchorWindowEl);

  const onResize = (): void => reposition();
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);

  // Initial render. The first reposition() inside render() may read a still-
  // zeroed rect; the ResizeObserver above re-fires the moment the modal gains
  // dimensions. We also schedule a deferred reposition for environments where
  // ResizeObserver doesn't fire on first attach.
  render();
  // After two paints the modal's layout has committed — re-run render so the
  // measured display:flex actually fires.
  requestAnimationFrame(() => requestAnimationFrame(() => render()));

  return {
    panel,
    tabBtn,
    isOpen: () => openState,
    open: () => setOpen(true),
    close: () => setOpen(false),
    setBanner(banner) {
      bannerEl = banner;
      if (openState) render();
    },
    setAssetBody(body) {
      assetBodyEl = body;
      if (openState) render();
    },
    setPickATileBody(body) {
      pickATileBodyEl = body;
      if (openState) render();
    },
    setActiveTab(tab) {
      slideTab = tab;
      storage.set(SLIDE_TAB_KEY, tab);
      if (openState) render();
    },
    getActiveTab: () => slideTab,
    destroy() {
      mutObs.disconnect();
      resObs.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      panel.remove();
      tabBtn.remove();
    },
  };
}
