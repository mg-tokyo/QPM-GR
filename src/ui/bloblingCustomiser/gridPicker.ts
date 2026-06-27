import { SLOT_CONFIG, type SlotType, type SessionState } from '../../features/bloblingCustomiser/types';
import { getCosmeticCdnUrl } from '../../features/bloblingCustomiser/cosmeticApi';
import { t } from '../../i18n';
import { mountCustomsDropZone } from './customsDropZone';
import { mountCustomsBadge } from './customsBadge';
import { getTrimToShape, setTrimToShape, onStateChange as onCustomSkinsChange } from '../../features/bloblingCustomiser/customSkins';

export interface GridPickerHandle {
  refresh(): void;
  reposition(): void;
  destroy(): void;
}

interface CellRef {
  el: HTMLElement;
  filename: string;
}

const PANEL_WIDTH = 248;
const TAB_WIDTH = 32;
const TAB_HEIGHT = 38;     // ~header height (42px) minus 4px so the tab sits inside the header band
const TAB_TOP_OFFSET = 2;  // 2px from window top → vertically centered in the 42px header band
const CELL_SIZE = 64;
const MIME_TYPE = 'application/x-qpm-cosmetic';

export function createGridPicker(
  windowEl: HTMLElement,
  onSelect: (slot: SlotType, filename: string) => void,
  getSessionFn: () => SessionState | null,
): GridPickerHandle {
  let isOpen = false;
  const cellMap = new Map<SlotType, CellRef[]>();
  const badgeMap = new Map<SlotType, HTMLElement>();
  const cleanups: Array<() => void> = [];

  // ── Scrollbar style ──────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.id = 'qpm-grid-picker-scrollbar';
  styleEl.textContent = [
    '.qpm-grid-picker-scroll::-webkit-scrollbar{width:6px}',
    '.qpm-grid-picker-scroll::-webkit-scrollbar-track{background:rgba(0,0,0,0.2);border-radius:3px}',
    '.qpm-grid-picker-scroll::-webkit-scrollbar-thumb{background:var(--qpm-accent-focus);border-radius:3px}',
    '.qpm-grid-picker-scroll::-webkit-scrollbar-thumb:hover{background:var(--qpm-accent-emphasis)}',
  ].join('\n');
  document.head.appendChild(styleEl);

  // ── Tab button ────────────────────────────────────────────────────────
  const tabBtn = document.createElement('button');
  tabBtn.type = 'button';
  tabBtn.title = t('feature.bloblingCustomiser.gridPicker');
  tabBtn.textContent = '+';
  tabBtn.style.cssText = `position:fixed;width:${TAB_WIDTH}px;height:${TAB_HEIGHT}px;border:1px solid var(--qpm-accent-hover);border-left:none;border-radius:0 var(--qpm-radius-md) var(--qpm-radius-md) 0;background:var(--qpm-accent);color:#fff;font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-bold);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s,box-shadow 0.15s;padding:0;font-family:inherit;box-shadow:2px 0 10px rgba(143,130,255,0.5);`;
  tabBtn.addEventListener('mouseenter', () => { tabBtn.style.background = 'var(--qpm-accent-hover)'; });
  tabBtn.addEventListener('mouseleave', () => { tabBtn.style.background = isOpen ? 'var(--qpm-accent-hover)' : 'var(--qpm-accent)'; });
  document.body.appendChild(tabBtn);

  // ── Grid panel ────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.style.cssText = `position:fixed;width:${PANEL_WIDTH}px;display:none;flex-direction:column;background:var(--qpm-surface-window);border:1px solid var(--qpm-accent-emphasis);border-left:none;border-radius:0 var(--qpm-radius-lg) var(--qpm-radius-lg) 0;backdrop-filter:blur(12px);box-shadow:4px 0 20px rgba(0,0,0,0.4);font-family:inherit;font-size:var(--qpm-font-body);color:var(--qpm-text);transition:opacity 0.15s,transform 0.15s;`;
  document.body.appendChild(panel);

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:var(--qpm-space-4) var(--qpm-space-5);flex-shrink:0;border-bottom:1px solid var(--qpm-divider);';
  const headerTitle = document.createElement('span');
  headerTitle.style.cssText = 'font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);color:var(--qpm-text);';
  headerTitle.textContent = t('feature.bloblingCustomiser.gridPicker');
  header.appendChild(headerTitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'width:22px;height:22px;border-radius:var(--qpm-radius-md);border:none;background:rgba(255,255,255,0.05);color:var(--qpm-text-muted);font-size:var(--qpm-font-subtitle);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;transition:background 0.15s;';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(255,255,255,0.12)'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'rgba(255,255,255,0.05)'; });
  closeBtn.addEventListener('click', () => togglePanel(false));
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Scroll container
  const scroll = document.createElement('div');
  scroll.className = 'qpm-grid-picker-scroll';
  scroll.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--qpm-space-4) var(--qpm-space-4) var(--qpm-space-5);';
  panel.appendChild(scroll);

  // ── Footer: trim-to-shape toggle ──────────────────────────────────────
  // Sticky at the bottom of the picker — gates the Level 2 alpha mask when
  // users upload customs. When on (default), uploads are clipped to the
  // cosmetic's natural silhouette. When off, uploads render as-is.
  const footer = document.createElement('div');
  footer.style.cssText = 'flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:var(--qpm-space-3) var(--qpm-space-5);border-top:1px solid var(--qpm-divider);font-size:var(--qpm-font-xs);color:var(--qpm-text-muted);';

  const trimLabel = document.createElement('span');
  trimLabel.textContent = t('feature.bloblingCustomiser.trimToShape');
  trimLabel.title = t('feature.bloblingCustomiser.trimToShapeHelp');
  footer.appendChild(trimLabel);

  const trimSwitch = document.createElement('button');
  trimSwitch.type = 'button';
  function refreshTrimSwitch(): void {
    const on = getTrimToShape();
    trimSwitch.style.cssText = `width:28px;height:14px;border-radius:9999px;border:1px solid ${on ? 'var(--qpm-accent-emphasis)' : 'var(--qpm-border)'};background:${on ? 'var(--qpm-accent)' : 'rgba(255,255,255,0.05)'};position:relative;cursor:pointer;transition:background 0.12s,border-color 0.12s;padding:0;`;
    trimSwitch.innerHTML = `<span style="position:absolute;top:1px;left:${on ? '15' : '1'}px;width:10px;height:10px;border-radius:50%;background:#fff;transition:left 0.12s;"></span>`;
  }
  refreshTrimSwitch();
  trimSwitch.addEventListener('click', () => {
    setTrimToShape(!getTrimToShape());
    refreshTrimSwitch();
  });
  footer.appendChild(trimSwitch);

  const unsubCustomSkins = onCustomSkinsChange(refreshTrimSwitch);

  panel.appendChild(footer);

  // ── Build sections ────────────────────────────────────────────────────
  function buildSections(): void {
    scroll.innerHTML = '';
    cellMap.clear();
    badgeMap.clear();

    const session = getSessionFn();
    if (!session) return;

    for (const cfg of SLOT_CONFIG) {
      const items = session.carousel[cfg.type].items;
      const cells: CellRef[] = [];

      // Section header (no left-edge accent strip — colored label text + dot instead)
      const sectionHead = document.createElement('div');
      sectionHead.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:var(--qpm-space-2) 0 var(--qpm-space-3) 0;margin-top:${cfg === SLOT_CONFIG[0] ? '0' : 'var(--qpm-space-4)'};`;

      const labelWrap = document.createElement('span');
      labelWrap.style.cssText = 'display:inline-flex;align-items:center;gap:var(--qpm-space-3);';

      const dot = document.createElement('span');
      dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${cfg.arrowColor};display:inline-block;flex-shrink:0;`;
      labelWrap.appendChild(dot);

      const label = document.createElement('span');
      label.style.cssText = 'font-size:var(--qpm-font-xs);font-weight:var(--qpm-weight-bold);color:var(--qpm-text-muted);letter-spacing:1px;';
      label.textContent = t(`feature.bloblingCustomiser.slot${cfg.type}`).toUpperCase();
      labelWrap.appendChild(label);
      sectionHead.appendChild(labelWrap);

      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:var(--qpm-font-xs);color:rgba(151,160,192,0.5);';
      const ownedCount = items.filter(i => session.ownershipSet.has(i.filename)).length;
      badge.textContent = `${ownedCount}/${items.length}`;
      sectionHead.appendChild(badge);
      badgeMap.set(cfg.type, badge);

      scroll.appendChild(sectionHead);

      // Grid
      const grid = document.createElement('div');
      grid.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(${CELL_SIZE}px,1fr));gap:4px;`;

      // Slot-color glow background gives Expression face-overlays a body-like
      // silhouette to render against, and brands each slot section by color.
      // Hex with alpha (33 = ~20%, 14 = ~8%) keeps the tint soft.
      const cellGlow = `radial-gradient(circle at center, ${cfg.arrowColor}33 0%, ${cfg.arrowColor}14 55%, rgba(255,255,255,0.04) 100%)`;
      // Expression PNGs are tiny face overlays — boost their visible content
      // more aggressively than full-body cosmetics.
      const imgScale = cfg.type === 'Expression' ? 1.45 : 1.18;

      for (const entry of items) {
        const cell = document.createElement('div');
        const isSelected = entry.filename === session.selectedSlots[cfg.type];
        const isOwned = session.ownershipSet.has(entry.filename);

        cell.style.cssText = `position:relative;width:${CELL_SIZE}px;height:${CELL_SIZE}px;border-radius:var(--qpm-radius-sm);background:${cellGlow};border:1.5px solid ${isSelected ? cfg.arrowColor : 'var(--qpm-border)'};cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:all 0.12s;`;
        if (isSelected) cell.style.boxShadow = `0 0 6px ${cfg.arrowColor}44`;

        cell.draggable = true;
        cell.title = entry.displayName;

        const img = document.createElement('img');
        img.src = getCosmeticCdnUrl(entry.filename);
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = `width:100%;height:100%;object-fit:contain;image-rendering:pixelated;pointer-events:none;transform:scale(${imgScale});`;
        img.addEventListener('error', () => { img.style.display = 'none'; });
        cell.appendChild(img);

        // Owned / price indicator
        if (isOwned) {
          const ownedDot = document.createElement('div');
          ownedDot.style.cssText = 'position:absolute;bottom:2px;right:2px;width:6px;height:6px;border-radius:50%;background:var(--qpm-positive);box-shadow:0 0 3px rgba(79,209,139,0.55);';
          cell.appendChild(ownedDot);
        } else if (entry.price > 0) {
          const price = document.createElement('div');
          price.style.cssText = 'position:absolute;bottom:2px;right:3px;font-size:var(--qpm-font-caption);color:var(--qpm-gold);font-weight:var(--qpm-weight-semibold);text-shadow:0 1px 2px rgba(0,0,0,0.8);display:inline-flex;align-items:center;gap:2px;';
          const priceTxt = entry.price >= 1000 ? `${Math.round(entry.price / 1000)}k` : String(entry.price);
          price.textContent = `\u{1F35E} ${priceTxt}`;
          cell.appendChild(price);
        }

        // Hover — strengthen the slot glow on hover, restore on leave
        const hoverGlow = `radial-gradient(circle at center, ${cfg.arrowColor}55 0%, ${cfg.arrowColor}22 55%, rgba(143,130,255,0.10) 100%)`;
        cell.addEventListener('mouseenter', () => {
          if (entry.filename !== (getSessionFn()?.selectedSlots[cfg.type] ?? null)) {
            cell.style.background = hoverGlow;
            cell.style.borderColor = 'var(--qpm-accent-focus)';
          }
        });
        cell.addEventListener('mouseleave', () => {
          const sel = getSessionFn()?.selectedSlots[cfg.type] ?? null;
          if (entry.filename !== sel) {
            cell.style.background = cellGlow;
            cell.style.borderColor = 'var(--qpm-border)';
            cell.style.boxShadow = 'none';
          }
        });

        // Click
        cell.addEventListener('click', () => { onSelect(cfg.type, entry.filename); });

        // Drag
        cell.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(MIME_TYPE, JSON.stringify({ slot: cfg.type, filename: entry.filename }));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        });

        // Custom skins — per-tile drop/click affordance + ★ badge when an
        // active custom exists. Cleanups go on the per-build cleanups array
        // so a refresh / window close tears them down.
        const detachDropZone = mountCustomsDropZone(cell, cfg.type, entry.filename);
        const detachBadge = mountCustomsBadge(cell, entry.filename);
        cleanups.push(detachDropZone, detachBadge);

        grid.appendChild(cell);
        cells.push({ el: cell, filename: entry.filename });
      }

      scroll.appendChild(grid);
      cellMap.set(cfg.type, cells);
    }
  }

  // ── Toggle ────────────────────────────────────────────────────────────
  function togglePanel(open: boolean): void {
    isOpen = open;
    tabBtn.textContent = isOpen ? '×' : '+';
    // Match the CSS vars the mouse handlers use — falling back to the dim
    // translucent rgba on close made the tab nearly invisible after first use.
    tabBtn.style.background = isOpen ? 'var(--qpm-accent-hover)' : 'var(--qpm-accent)';

    if (isOpen) {
      buildSections();
      panel.style.display = 'flex';
      panel.style.opacity = '0';
      panel.style.transform = 'translateX(-8px)';
      reposition();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panel.style.opacity = '1';
          panel.style.transform = 'translateX(0)';
        });
      });
    } else {
      panel.style.opacity = '0';
      panel.style.transform = 'translateX(-8px)';
      setTimeout(() => { if (!isOpen) panel.style.display = 'none'; }, 150);
    }
  }

  tabBtn.addEventListener('click', () => togglePanel(!isOpen));

  // Escape key
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && isOpen) {
      togglePanel(false);
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // ── Positioning ───────────────────────────────────────────────────────
  function reposition(): void {
    const rect = windowEl.getBoundingClientRect();
    const z = windowEl.style.zIndex || '1000';

    // Check if panel fits on the right
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

    // Anchor to the window's top edge — sits in line with the close/minimise
    // buttons instead of centered on the side. Stays outside the window so it
    // doesn't overlap header controls.
    tabBtn.style.top = `${rect.top + TAB_TOP_OFFSET}px`;
    tabBtn.style.zIndex = z;

    panel.style.top = `${rect.top}px`;
    panel.style.maxHeight = `${rect.height}px`;
    panel.style.zIndex = z;

    // Hide only when the window is explicitly hidden via display:none.
    // The previous `rect.width === 0` check also fired during transient
    // layout states on open/resize, leaving the tab permanently hidden until
    // something else triggered a reposition — which often never happened.
    const hidden = windowEl.style.display === 'none';
    tabBtn.style.display = hidden ? 'none' : 'flex';
    if (hidden && isOpen) {
      panel.style.display = 'none';
    }
  }

  // Track window movement/resize
  const mutObs = new MutationObserver(() => reposition());
  mutObs.observe(windowEl, { attributes: true, attributeFilter: ['style'] });

  const resObs = new ResizeObserver(() => reposition());
  resObs.observe(windowEl);

  const onResize = () => reposition();
  window.addEventListener('resize', onResize);

  // Initial position — defer past the next paint so the modal wrapper has
  // committed its layout. A synchronous reposition() here can read rect from
  // a still-zeroed element when the customiser opens, which used to leave
  // the tab off-screen until something else triggered a reposition.
  reposition();
  requestAnimationFrame(() => reposition());

  // ── Refresh ───────────────────────────────────────────────────────────
  function refresh(): void {
    if (!isOpen) return;
    const session = getSessionFn();
    if (!session) return;

    for (const cfg of SLOT_CONFIG) {
      const selected = session.selectedSlots[cfg.type];
      const cells = cellMap.get(cfg.type);
      if (!cells) continue;

      const cellGlowRefresh = `radial-gradient(circle at center, ${cfg.arrowColor}33 0%, ${cfg.arrowColor}14 55%, rgba(255,255,255,0.04) 100%)`;
      const selectedGlow = `radial-gradient(circle at center, ${cfg.arrowColor}66 0%, ${cfg.arrowColor}33 55%, ${cfg.arrowColor}14 100%)`;
      for (const { el, filename } of cells) {
        const isSel = filename === selected;
        el.style.borderColor = isSel ? cfg.arrowColor : 'var(--qpm-border)';
        el.style.boxShadow = isSel ? `0 0 6px ${cfg.arrowColor}44` : 'none';
        el.style.background = isSel ? selectedGlow : cellGlowRefresh;
      }

      const badge = badgeMap.get(cfg.type);
      if (badge) {
        const items = session.carousel[cfg.type].items;
        const owned = items.filter(i => session.ownershipSet.has(i.filename)).length;
        badge.textContent = `${owned}/${items.length}`;
      }
    }
  }

  // ── Destroy ───────────────────────────────────────────────────────────
  function destroy(): void {
    mutObs.disconnect();
    resObs.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKeyDown);
    tabBtn.remove();
    panel.remove();
    styleEl.remove();
    cellMap.clear();
    badgeMap.clear();
    unsubCustomSkins();
    for (const fn of cleanups) { try { fn(); } catch { /* */ } }
  }

  return { refresh, reposition, destroy };
}
