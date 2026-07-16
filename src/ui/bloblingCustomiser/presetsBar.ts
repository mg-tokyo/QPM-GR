import { t } from '../../i18n';
import { applyPresetToSession, getSession } from '../../features/bloblingCustomiser';
import {
  getPresets, onPresetsChange, isAtCap, savePreset, deletePreset,
} from '../../features/bloblingCustomiser/presets/store';
import { PRESETS_SOFT_CAP, type BloblingPreset } from '../../features/bloblingCustomiser/presets/types';
import { captureNextPreviewFrame } from '../../features/bloblingCustomiser/avatarPreview';
import { notify } from '../../core/notifications';

const TILE_SIZE = 60;
const THUMB_W = 104;
const THUMB_H = 112;
const PANEL_HEIGHT = 200;
const TAB_WIDTH = 72;
const TAB_HEIGHT = 22;

async function captureThumbnailDataUrl(): Promise<string | null> {
  const frame = await captureNextPreviewFrame();
  if (!frame) return null;

  const src = document.createElement('canvas');
  src.width = frame.width;
  src.height = frame.height;
  const srcCtx = src.getContext('2d');
  if (!srcCtx) return null;
  srcCtx.putImageData(frame, 0, 0);

  const dst = document.createElement('canvas');
  dst.width = THUMB_W;
  dst.height = THUMB_H;
  const dstCtx = dst.getContext('2d');
  if (!dstCtx) return null;
  dstCtx.imageSmoothingQuality = 'high';
  dstCtx.drawImage(src, 0, 0, THUMB_W, THUMB_H);

  const webp = dst.toDataURL('image/webp', 0.7);
  if (webp.startsWith('data:image/webp')) return webp;
  return dst.toDataURL('image/png');
}

export interface PresetsBarHandle {
  refresh(): void;
  setPreviewReady(ready: boolean): void;
  destroy(): void;
}

export function renderPresetsBar(
  windowEl: HTMLElement,
  _getCanvas: () => HTMLCanvasElement | null,
): PresetsBarHandle {
  const cleanups: Array<() => void> = [];
  let previewReady = false;
  let isOpen = false;

  let pendingDeleteId: string | null = null;
  let pendingDeleteTimer: number | null = null;

  function cancelPendingDelete(): void {
    pendingDeleteId = null;
    if (pendingDeleteTimer !== null) {
      window.clearTimeout(pendingDeleteTimer);
      pendingDeleteTimer = null;
    }
    refresh();
  }

  function armPendingDelete(id: string): void {
    pendingDeleteId = id;
    if (pendingDeleteTimer !== null) window.clearTimeout(pendingDeleteTimer);
    pendingDeleteTimer = window.setTimeout(() => { cancelPendingDelete(); }, 3000);
    refresh();
  }

  const tabBtn = document.createElement('button');
  tabBtn.type = 'button';
  tabBtn.title = t('feature.bloblingCustomiser.presets.title');
  tabBtn.textContent = '+';
  tabBtn.style.cssText = `position:fixed;width:${TAB_WIDTH}px;height:${TAB_HEIGHT}px;border:1px solid var(--qpm-accent-hover);border-top:none;border-radius:0 0 var(--qpm-radius-md) var(--qpm-radius-md);background:var(--qpm-accent);color:#fff;font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-bold);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s,box-shadow 0.15s;padding:0;font-family:inherit;box-shadow:0 2px 10px rgba(143,130,255,0.5);`;
  tabBtn.addEventListener('mouseenter', () => { tabBtn.style.background = 'var(--qpm-accent-hover)'; });
  tabBtn.addEventListener('mouseleave', () => { tabBtn.style.background = isOpen ? 'var(--qpm-accent-hover)' : 'var(--qpm-accent)'; });
  document.body.appendChild(tabBtn);

  // Drops down below the window, or rises above if no room below.
  const panel = document.createElement('div');
  panel.style.cssText = `position:fixed;display:none;flex-direction:column;background:var(--qpm-surface-window);border:1px solid var(--qpm-accent-emphasis);border-top:none;border-radius:0 0 var(--qpm-radius-lg) var(--qpm-radius-lg);box-shadow:0 4px 20px rgba(0,0,0,0.4);font-family:inherit;font-size:var(--qpm-font-body);color:var(--qpm-text);transition:opacity 0.15s,transform 0.15s;overflow:hidden;`;
  document.body.appendChild(panel);

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:var(--qpm-space-4) var(--qpm-space-5);flex-shrink:0;border-bottom:1px solid var(--qpm-divider);';
  const headerTitle = document.createElement('span');
  headerTitle.style.cssText = 'font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);color:var(--qpm-text);';
  headerTitle.textContent = t('feature.bloblingCustomiser.presets.title');
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

  const scroll = document.createElement('div');
  scroll.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--qpm-space-4);';
  panel.appendChild(scroll);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--qpm-space-3);justify-content:flex-start;';
  scroll.appendChild(grid);

  function onDocumentClick(e: MouseEvent): void {
    if (pendingDeleteId === null) return;
    if (!panel.contains(e.target as Node)) cancelPendingDelete();
  }
  document.addEventListener('click', onDocumentClick, true);
  cleanups.push(() => document.removeEventListener('click', onDocumentClick, true));

  function makeSavedTile(preset: BloblingPreset): HTMLElement {
    const tile = document.createElement('div');
    const isConfirming = pendingDeleteId === preset.id;
    tile.style.cssText = `position:relative;width:${TILE_SIZE}px;height:${TILE_SIZE}px;border-radius:var(--qpm-radius-sm);border:1px solid var(--qpm-border);background:radial-gradient(circle at center, rgba(143,130,255,0.18) 0%, rgba(143,130,255,0.06) 60%, rgba(255,255,255,0.02) 100%);overflow:hidden;cursor:pointer;transition:border-color 0.12s, box-shadow 0.12s;`;

    const img = document.createElement('img');
    img.src = preset.thumbnail;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated;pointer-events:none;';
    img.alt = '';
    img.addEventListener('error', () => { img.style.display = 'none'; });
    tile.appendChild(img);

    if (isConfirming) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;background:rgba(239,68,68,0.55);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:var(--qpm-weight-bold);color:#fff;text-align:center;padding:2px;pointer-events:none;line-height:1.1;';
      overlay.textContent = t('feature.bloblingCustomiser.presets.deleteConfirm');
      tile.appendChild(overlay);
    }

    const xBadge = document.createElement('div');
    xBadge.style.cssText = `position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:9999px;background:var(--qpm-danger);color:#fff;font-size:10px;line-height:14px;text-align:center;cursor:pointer;opacity:${isConfirming ? '1' : '0'};transition:opacity 0.1s;z-index:2;`;
    xBadge.textContent = '×';
    xBadge.title = t('feature.bloblingCustomiser.presets.delete');
    tile.appendChild(xBadge);

    tile.addEventListener('mouseenter', () => {
      tile.style.borderColor = 'var(--qpm-accent-emphasis)';
      tile.style.boxShadow = '0 0 8px rgba(143,130,255,0.35)';
      if (!isConfirming) xBadge.style.opacity = '1';
    });
    tile.addEventListener('mouseleave', () => {
      tile.style.borderColor = 'var(--qpm-border)';
      tile.style.boxShadow = 'none';
      if (!isConfirming) xBadge.style.opacity = '0';
    });

    xBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pendingDeleteId === preset.id) {
        deletePreset(preset.id);
        pendingDeleteId = null;
        if (pendingDeleteTimer !== null) {
          window.clearTimeout(pendingDeleteTimer);
          pendingDeleteTimer = null;
        }
      } else {
        armPendingDelete(preset.id);
      }
    });

    tile.addEventListener('click', () => {
      if (pendingDeleteId !== null) {
        cancelPendingDelete();
        return;
      }
      applyPresetToSession(preset.slots, preset.color);
    });

    return tile;
  }

  function makeAddTile(): HTMLElement {
    const tile = document.createElement('div');
    const enabled = previewReady && !isAtCap();
    tile.style.cssText = `width:${TILE_SIZE}px;height:${TILE_SIZE}px;border-radius:var(--qpm-radius-sm);border:2px dashed var(--qpm-accent-border);background:transparent;display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--qpm-accent);cursor:${enabled ? 'pointer' : 'not-allowed'};opacity:${enabled ? '1' : '0.4'};transition:border-color 0.12s, color 0.12s;`;
    tile.textContent = '+';
    tile.title = t('feature.bloblingCustomiser.presets.save');

    if (enabled) {
      tile.addEventListener('mouseenter', () => { tile.style.borderColor = 'var(--qpm-accent-emphasis)'; });
      tile.addEventListener('mouseleave', () => { tile.style.borderColor = 'var(--qpm-accent-border)'; });

      let saving = false;
      tile.addEventListener('click', () => {
        if (saving) return;
        saving = true;
        setTimeout(() => { saving = false; }, 200);

        const session = getSession();
        if (!session) { saving = false; return; }

        void (async () => {
          const thumbnail = await captureThumbnailDataUrl();
          if (!thumbnail) {
            notify({
              feature: 'bloblingCustomiser',
              level: 'warn',
              message: 'Preview not ready — try again in a moment',
            });
            return;
          }

          const slotsSnapshot = {
            Bottom: session.selectedSlots.Bottom,
            Mid: session.selectedSlots.Mid,
            Top: session.selectedSlots.Top,
            Expression: session.selectedSlots.Expression,
          };

          const saved = savePreset({
            slots: slotsSnapshot,
            color: session.selectedColor,
            thumbnail,
          });

          if (!saved) {
            notify({
              feature: 'bloblingCustomiser',
              level: 'warn',
              message: `Preset limit reached (${PRESETS_SOFT_CAP})`,
            });
          }
        })();
      });
    }

    return tile;
  }

  function makeCapTile(): HTMLElement {
    const tile = document.createElement('div');
    tile.style.cssText = `width:${TILE_SIZE}px;height:${TILE_SIZE}px;border-radius:var(--qpm-radius-sm);border:1px dashed var(--qpm-border);background:transparent;display:flex;align-items:center;justify-content:center;font-size:var(--qpm-font-xs);color:var(--qpm-text-muted);text-align:center;`;
    tile.textContent = `${PRESETS_SOFT_CAP}/${PRESETS_SOFT_CAP}`;
    return tile;
  }

  function refresh(): void {
    grid.innerHTML = '';
    for (const preset of getPresets()) {
      grid.appendChild(makeSavedTile(preset));
    }
    grid.appendChild(isAtCap() ? makeCapTile() : makeAddTile());
  }

  function togglePanel(open: boolean): void {
    isOpen = open;
    tabBtn.textContent = isOpen ? '×' : '+';
    tabBtn.style.background = isOpen ? 'var(--qpm-accent-hover)' : 'var(--qpm-accent)';

    if (isOpen) {
      refresh();
      panel.style.display = 'flex';
      panel.style.opacity = '0';
      panel.style.transform = 'translateY(-8px)';
      reposition();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panel.style.opacity = '1';
          panel.style.transform = 'translateY(0)';
        });
      });
    } else {
      panel.style.opacity = '0';
      panel.style.transform = 'translateY(-8px)';
      setTimeout(() => { if (!isOpen) panel.style.display = 'none'; }, 150);
    }
  }

  tabBtn.addEventListener('click', () => togglePanel(!isOpen));

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && isOpen) {
      togglePanel(false);
    }
  }
  document.addEventListener('keydown', onKeyDown);
  cleanups.push(() => document.removeEventListener('keydown', onKeyDown));

  function reposition(): void {
    const rect = windowEl.getBoundingClientRect();
    const z = windowEl.style.zIndex || '1000';

    const fitsBelow = rect.bottom + PANEL_HEIGHT + TAB_HEIGHT < window.innerHeight - 8;

    if (fitsBelow) {
      tabBtn.style.top = `${rect.bottom}px`;
      tabBtn.style.borderRadius = '0 0 var(--qpm-radius-md) var(--qpm-radius-md)';
      tabBtn.style.borderTop = 'none';
      tabBtn.style.borderBottom = '1px solid var(--qpm-accent-emphasis)';
      tabBtn.style.boxShadow = '0 2px 10px rgba(143,130,255,0.5)';
      panel.style.top = `${rect.bottom}px`;
      panel.style.borderRadius = '0 0 var(--qpm-radius-lg) var(--qpm-radius-lg)';
      panel.style.borderTop = 'none';
      panel.style.borderBottom = '1px solid var(--qpm-accent-emphasis)';
    } else {
      tabBtn.style.top = `${rect.top - TAB_HEIGHT}px`;
      tabBtn.style.borderRadius = 'var(--qpm-radius-md) var(--qpm-radius-md) 0 0';
      tabBtn.style.borderBottom = 'none';
      tabBtn.style.borderTop = '1px solid var(--qpm-accent-emphasis)';
      tabBtn.style.boxShadow = '0 -2px 10px rgba(143,130,255,0.5)';
      panel.style.top = `${rect.top - PANEL_HEIGHT}px`;
      panel.style.borderRadius = 'var(--qpm-radius-lg) var(--qpm-radius-lg) 0 0';
      panel.style.borderBottom = 'none';
      panel.style.borderTop = '1px solid var(--qpm-accent-emphasis)';
    }

    tabBtn.style.left = `${Math.round(rect.left + (rect.width - TAB_WIDTH) / 2)}px`;
    tabBtn.style.zIndex = z;

    panel.style.left = `${rect.left}px`;
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${PANEL_HEIGHT}px`;
    panel.style.zIndex = z;

    const hidden = windowEl.style.display === 'none';
    tabBtn.style.display = hidden ? 'none' : 'flex';
    if (hidden && isOpen) {
      panel.style.display = 'none';
    }
  }

  const mutObs = new MutationObserver(() => reposition());
  mutObs.observe(windowEl, { attributes: true, attributeFilter: ['style'] });

  const resObs = new ResizeObserver(() => reposition());
  resObs.observe(windowEl);

  const onResize = (): void => reposition();
  window.addEventListener('resize', onResize);

  reposition();
  requestAnimationFrame(() => reposition());

  const unsubscribe = onPresetsChange(() => {
    if (isOpen) refresh();
  });
  cleanups.push(unsubscribe);

  return {
    refresh,
    setPreviewReady(ready: boolean): void {
      if (previewReady === ready) return;
      previewReady = ready;
      if (isOpen) refresh();
    },
    destroy(): void {
      mutObs.disconnect();
      resObs.disconnect();
      window.removeEventListener('resize', onResize);
      tabBtn.remove();
      panel.remove();
      for (const fn of cleanups) { try { fn(); } catch { /* */ } }
      cleanups.length = 0;
    },
  };
}
