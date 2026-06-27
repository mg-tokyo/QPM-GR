// Per-tile swap affordances ported from the Blobling customiser pattern
// (src/ui/bloblingCustomiser/customsDropZone.ts).
//
// Each asset-grid tile gets:
//   - `+` (bottom-left) → file picker. Upload PNG becomes a swap rule
//                         (source.type = 'upload') on this sprite. When a
//                         swap exists, button becomes `×` and clicking
//                         clears the rule.
//   - `↓` (top-left)    → download the ORIGINAL sprite as a PNG so the
//                         user can edit it offline and re-upload.
//   - `★` (top-right)   → badge shown while any swap rule is active on
//                         this sprite (library OR upload).
//   - Drag-drop on the cell → uploads dropped image as a swap.
//   - Buttons hover-fade on cell enter / leave.
//
// Catalog-driven by design: the sprite key is the only input, and rule
// creation goes through the existing textureSwapper API (addRule, addUploadedAsset).

import { t } from '../../../../i18n';
import { notify } from '../../../../core/notifications';
import {
  addRule,
  updateRule,
  deleteRule,
  parseAtlasKey,
  getTextureSwapperState,
  addUploadedAsset,
  getOriginalSpriteCanvas,
  type TextureOverrideRule,
} from '../../../../features/standalone/textureSwapper';

function findSwapRule(spriteKey: string): TextureOverrideRule | undefined {
  return getTextureSwapperState().rules.find(r =>
    r.targetSpriteKey === spriteKey &&
    (r.source.librarySpriteKey != null || r.source.uploadAssetId != null),
  );
}

async function downloadOriginalSprite(spriteKey: string): Promise<boolean> {
  try {
    const canvas = await getOriginalSpriteCanvas(spriteKey);
    if (!canvas) return false;
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const { category, id } = parseAtlasKey(spriteKey);
    a.href = url;
    a.download = `${category}_${id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

async function uploadCustomForSprite(spriteKey: string, file: File): Promise<boolean> {
  if (!file.type.startsWith('image/')) {
    notify({ feature: 'gardenPainter', level: 'error', message: 'Upload must be an image file' });
    return false;
  }
  const assetId = await addUploadedAsset(file);
  if (!assetId) return false;
  const { category, id } = parseAtlasKey(spriteKey);
  const existing = findSwapRule(spriteKey);
  if (existing) {
    updateRule({ ...existing, source: { type: 'upload', uploadAssetId: assetId } });
  } else {
    addRule({
      enabled: true,
      targetSpriteKey: spriteKey,
      targetCategory: category,
      displayLabel: id,
      source: { type: 'upload', uploadAssetId: assetId },
      params: {},
    });
  }
  return true;
}

function clearSwapForSprite(spriteKey: string): boolean {
  const existing = findSwapRule(spriteKey);
  if (!existing) return false;
  deleteRule(existing.id);
  return true;
}

export function mountTileSwapButtons(
  cell: HTMLElement,
  spriteKey: string,
  onChange?: () => void,
): () => void {
  // Affordance: + / × button (bottom-left)
  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.style.cssText = [
    'position:absolute', 'bottom:3px', 'left:3px',
    'width:16px', 'height:16px',
    'border-radius:50%', 'border:1px solid rgba(255,255,255,0.3)',
    'background:rgba(0,0,0,0.55)', 'color:#fff',
    'font-size:11px', 'line-height:0', 'cursor:pointer',
    'opacity:0', 'transition:opacity 0.12s,background 0.12s',
    'padding:0', 'display:flex', 'align-items:center', 'justify-content:center',
    'z-index:2', 'font-family:inherit',
  ].join(';');
  cell.appendChild(plusBtn);

  // Download button (top-left)
  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.textContent = '↓';
  dlBtn.title = t('feature.gardenPainter.downloadOriginal');
  dlBtn.style.cssText = [
    'position:absolute', 'top:3px', 'left:3px',
    'width:16px', 'height:16px',
    'border-radius:50%', 'border:1px solid rgba(255,255,255,0.3)',
    'background:rgba(0,0,0,0.55)', 'color:#fff',
    'font-size:11px', 'line-height:0', 'cursor:pointer',
    'opacity:0', 'transition:opacity 0.12s,background 0.12s',
    'padding:0', 'display:flex', 'align-items:center', 'justify-content:center',
    'z-index:2', 'font-family:inherit',
  ].join(';');
  cell.appendChild(dlBtn);

  // Active-swap star badge (top-right). Hidden when no swap.
  const star = document.createElement('span');
  star.textContent = '★';
  star.style.cssText = [
    'position:absolute', 'top:3px', 'right:3px',
    'font-size:11px', 'color:#ffe66b',
    'text-shadow:0 1px 2px rgba(0,0,0,0.85)',
    'pointer-events:none', 'z-index:2',
    'display:none',
  ].join(';');
  cell.appendChild(star);

  function refreshAffordance(): void {
    const has = !!findSwapRule(spriteKey);
    plusBtn.textContent = has ? '×' : '+';
    plusBtn.style.background = has ? 'rgba(143,130,255,0.85)' : 'rgba(0,0,0,0.55)';
    plusBtn.title = has
      ? t('feature.gardenPainter.removeSwap')
      : t('feature.gardenPainter.uploadCustom');
    star.style.display = has ? 'block' : 'none';
  }
  refreshAffordance();

  // ── File picker (lazy) ──
  let pendingInput: HTMLInputElement | null = null;
  function openFilePicker(): void {
    if (pendingInput) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (f) {
        const ok = await uploadCustomForSprite(spriteKey, f);
        if (ok) {
          refreshAffordance();
          onChange?.();
        }
      }
      input.remove();
      pendingInput = null;
    });
    document.body.appendChild(input);
    pendingInput = input;
    input.click();
  }

  // ── Hover reveal ──
  const onCellEnter = (): void => { plusBtn.style.opacity = '1'; dlBtn.style.opacity = '1'; };
  const onCellLeave = (): void => { plusBtn.style.opacity = '0'; dlBtn.style.opacity = '0'; };
  cell.addEventListener('mouseenter', onCellEnter);
  cell.addEventListener('mouseleave', onCellLeave);

  // ── Button clicks ──
  const onPlusClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (findSwapRule(spriteKey)) {
      const cleared = clearSwapForSprite(spriteKey);
      if (cleared) {
        refreshAffordance();
        onChange?.();
      }
    } else {
      openFilePicker();
    }
  };
  plusBtn.addEventListener('click', onPlusClick);

  const onDlClick = async (e: MouseEvent): Promise<void> => {
    e.stopPropagation();
    const ok = await downloadOriginalSprite(spriteKey);
    if (!ok) {
      notify({ feature: 'gardenPainter', level: 'error', message: t('feature.gardenPainter.downloadOriginalFailed') });
    }
  };
  dlBtn.addEventListener('click', onDlClick);

  // ── Drag-drop ──
  const onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    cell.style.outline = '2px dashed var(--qpm-accent-emphasis)';
  };
  const onDragLeave = (): void => { cell.style.outline = ''; };
  const onDrop = async (e: DragEvent): Promise<void> => {
    cell.style.outline = '';
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await uploadCustomForSprite(spriteKey, f);
    if (ok) {
      refreshAffordance();
      onChange?.();
    }
  };
  cell.addEventListener('dragover', onDragOver);
  cell.addEventListener('dragleave', onDragLeave);
  cell.addEventListener('drop', onDrop);

  // External listener so the badge updates when rules change elsewhere
  // (e.g. via the Swap tab's "Remove this rule" footer).
  const onExternalUpdate = (): void => refreshAffordance();
  window.addEventListener('qpm:texture-manipulator-updated', onExternalUpdate);

  return () => {
    window.removeEventListener('qpm:texture-manipulator-updated', onExternalUpdate);
    cell.removeEventListener('mouseenter', onCellEnter);
    cell.removeEventListener('mouseleave', onCellLeave);
    plusBtn.removeEventListener('click', onPlusClick);
    dlBtn.removeEventListener('click', onDlClick);
    cell.removeEventListener('dragover', onDragOver);
    cell.removeEventListener('dragleave', onDragLeave);
    cell.removeEventListener('drop', onDrop);
    plusBtn.remove();
    dlBtn.remove();
    star.remove();
    if (pendingInput) { pendingInput.remove(); pendingInput = null; }
  };
}
