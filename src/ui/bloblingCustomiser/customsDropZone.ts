import { t } from '../../i18n';
import { notify } from '../../core/notifications';
import type { SlotType } from '../../features/bloblingCustomiser/types';
import {
  replaceActiveCustomSkin,
  clearActiveCustomSkin,
  getActiveCustomSkin,
  downloadCosmeticTemplate,
} from '../../features/bloblingCustomiser/customSkins';

// Confirmed by sampling every cosmetic URL in the game's resource log on
// 2026-06-26 — Top/Mid/Bottom/Expression all use 640×640 PNGs uniformly.
// Uploading at this size avoids stretching from the game's UV sampling.
const EXPECTED_PX = 640;

/**
 * Mount drop+click+remove handlers on a cosmetic tile so a user can drop or
 * pick a custom PNG that becomes the active skin for that cosmetic.
 * Returns a cleanup that removes every listener. Idempotent across calls
 * because cleanup detaches everything this mount created.
 *
 * UX (spec §3.1, amended):
 *  - Hover a tile → small affordance bottom-left of cell (14×14)
 *  - Click affordance with no custom → OS file picker, image/* only
 *  - Click affordance with custom set → clears it (× becomes the icon)
 *  - Drop file from OS onto tile → consumed, becomes active
 */
export function mountCustomsDropZone(
  cell: HTMLElement,
  _slot: SlotType,
  filename: string,
): () => void {
  // ── Affordance button ──
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '+';
  btn.style.cssText = [
    'position:absolute',
    'bottom:2px',
    'left:2px',
    'width:14px',
    'height:14px',
    'border-radius:50%',
    'border:1px solid rgba(255,255,255,0.3)',
    'background:rgba(0,0,0,0.55)',
    'color:#fff',
    'font-size:10px',
    'line-height:0',
    'cursor:pointer',
    'opacity:0',
    'transition:opacity 0.12s,background 0.12s',
    'padding:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'z-index:2',
    'font-family:inherit',
  ].join(';');
  cell.appendChild(btn);

  const refreshAffordance = (): void => {
    const active = getActiveCustomSkin(filename);
    const has = active !== null;
    btn.style.background = has ? 'rgba(143,130,255,0.85)' : 'rgba(0,0,0,0.55)';
    btn.textContent = has ? '×' : '+';   // × when custom set, + otherwise

    if (!has) {
      btn.title = `${t('feature.bloblingCustomiser.customise')} (${EXPECTED_PX}×${EXPECTED_PX})`;
    } else {
      const dimMatches = active.width === EXPECTED_PX && active.height === EXPECTED_PX;
      const dimSuffix = dimMatches
        ? `${active.width}×${active.height}`
        : `${active.width}×${active.height} ⚠ expected ${EXPECTED_PX}×${EXPECTED_PX}`;
      btn.title = `${t('feature.bloblingCustomiser.removeCustom')} (${dimSuffix})`;
    }
  };
  refreshAffordance();

  // ── Hidden file input (lazy-created on click) ──
  let pendingInput: HTMLInputElement | null = null;
  function openFilePicker(): void {
    if (pendingInput) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (f) await handleFile(f);
      input.remove();
      pendingInput = null;
    });
    document.body.appendChild(input);
    pendingInput = input;
    input.click();
  }

  async function handleFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      notify({
        feature: 'bloblingCustomSkins',
        level: 'error',
        message: t('feature.bloblingCustomiser.dropImageFile'),
      });
      return;
    }
    const result = await replaceActiveCustomSkin(filename, file);
    if (result) refreshAffordance();
  }

  // ── Template-download button (Level 1) ──
  // Positioned top-left: bottom-left is the + customise button, top-right
  // is the ★ active-custom badge, bottom-right has owned-dot / price overlays.
  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.textContent = '↓';
  dlBtn.title = t('feature.bloblingCustomiser.downloadTemplate');
  dlBtn.style.cssText = [
    'position:absolute',
    'top:2px',
    'left:2px',
    'width:14px',
    'height:14px',
    'border-radius:50%',
    'border:1px solid rgba(255,255,255,0.3)',
    'background:rgba(0,0,0,0.55)',
    'color:#fff',
    'font-size:10px',
    'line-height:0',
    'cursor:pointer',
    'opacity:0',
    'transition:opacity 0.12s,background 0.12s',
    'padding:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'z-index:2',
    'font-family:inherit',
  ].join(';');
  cell.appendChild(dlBtn);

  // ── Hover handlers ──
  const onCellEnter = (): void => { btn.style.opacity = '1'; dlBtn.style.opacity = '1'; };
  const onCellLeave = (): void => { btn.style.opacity = '0'; dlBtn.style.opacity = '0'; };
  cell.addEventListener('mouseenter', onCellEnter);
  cell.addEventListener('mouseleave', onCellLeave);

  // ── Click affordance ──
  const onBtnClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (getActiveCustomSkin(filename)) {
      clearActiveCustomSkin(filename);
      refreshAffordance();
    } else {
      openFilePicker();
    }
  };
  btn.addEventListener('click', onBtnClick);

  // ── Download template click ──
  const onDlClick = async (e: MouseEvent): Promise<void> => {
    e.stopPropagation();
    const ok = await downloadCosmeticTemplate(filename);
    if (!ok) {
      notify({
        feature: 'bloblingCustomSkins',
        level: 'error',
        message: t('feature.bloblingCustomiser.templateDownloadFailed'),
      });
    }
  };
  dlBtn.addEventListener('click', onDlClick);

  // ── Drag-drop on the cell itself ──
  const onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    cell.style.outline = '2px dashed var(--qpm-accent-emphasis)';
  };
  const onDragLeave = (): void => { cell.style.outline = ''; };
  const onDrop = (e: DragEvent): void => {
    cell.style.outline = '';
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    void handleFile(f);
  };
  cell.addEventListener('dragover', onDragOver);
  cell.addEventListener('dragleave', onDragLeave);
  cell.addEventListener('drop', onDrop);

  return () => {
    cell.removeEventListener('mouseenter', onCellEnter);
    cell.removeEventListener('mouseleave', onCellLeave);
    btn.removeEventListener('click', onBtnClick);
    dlBtn.removeEventListener('click', onDlClick);
    cell.removeEventListener('dragover', onDragOver);
    cell.removeEventListener('dragleave', onDragLeave);
    cell.removeEventListener('drop', onDrop);
    btn.remove();
    dlBtn.remove();
    if (pendingInput) { pendingInput.remove(); pendingInput = null; }
  };
}
