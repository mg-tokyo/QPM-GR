import { toggleWindow } from '../core/modalWindow';
import { t } from '../../i18n';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';
import { watchDetach } from '../../utils/dom/dom';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:bloblingCustomiser';
const FEATURE_NAME = 'bloblingCustomiser';
const windowLog = createNamedLogger(FEATURE_SUBSYSTEM);

function warnBlobling(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  windowLog.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}
import {
  initSession, destroySession, onSessionChange,
  selectColor, cycleSlot, selectSlotByFilename, getSession,
  SLOT_TYPES,
} from '../../features/bloblingCustomiser';
import { createPreviewAvatar, type PreviewHandle } from '../../features/bloblingCustomiser/avatarPreview';
import { renderPreviewBox } from './previewBox';
import { renderCarouselArrows } from './carouselArrows';
import { renderOutfitPanel } from './outfitPanel';
import { createGridPicker } from './gridPicker';
import { renderPresetsBar } from './presetsBar';
import { createSpriteCustomiserPromo } from '../components/spriteCustomiserPromo';

const WINDOW_ID = 'blobling-customiser';

export function openBloblingCustomiserWindow(): void {
  toggleWindow(
    WINDOW_ID,
    `✨ ${t('feature.bloblingCustomiser.title')}`,
    (root) => {
      root.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-4);padding:var(--qpm-space-6);font-family:var(--qpm-font);font-size:var(--qpm-font-body);color:var(--qpm-text);min-height:0;flex:1;';

      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;gap:var(--qpm-space-6);min-height:0;';

      const session = initSession();
      const cleanups: Array<() => void> = [];
      let previewHandle: PreviewHandle | null = null;

      const leftCol = document.createElement('div');
      leftCol.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:0;';

      const previewBox = renderPreviewBox(leftCol, session.selectedColor, (color) => {
        selectColor(color);
        previewBox.updateColor(color);
      });

      const carouselHandle = renderCarouselArrows(
        previewBox.previewArea,
        (slot, direction) => cycleSlot(slot, direction),
      );

      topRow.appendChild(leftCol);

      const rightCol = document.createElement('div');
      rightCol.style.cssText = 'width:210px;flex-shrink:0;display:flex;flex-direction:column;gap:var(--qpm-space-4);';

      const outfitPanel = renderOutfitPanel(rightCol);
      topRow.appendChild(rightCol);

      root.appendChild(topRow);

      root.appendChild(createSpriteCustomiserPromo());

      // Presets bar (attached to window edge — same pattern as grid picker)
      const windowEl = root.parentElement!;
      const presetsBar = renderPresetsBar(windowEl, () => previewBox.canvas);
      cleanups.push(() => presetsBar.destroy());

      // Grid picker (attached to window edge)
      const gridPicker = createGridPicker(
        windowEl,
        (slot, filename) => { selectSlotByFilename(slot, filename); },
        getSession,
      );
      cleanups.push(() => gridPicker.destroy());

      // Drop zone on preview area
      previewBox.setDropHandler((slot, filename) => {
        selectSlotByFilename(slot, filename);
      });

      createPreviewAvatar(previewBox.canvas).then((handle) => {
        if (!handle) {
          windowLog.debug('Rive preview unavailable — canvas will remain empty');
          return;
        }
        // Inject session getter so the customSkins preview bridge can revert
        // a cleared custom to whatever cosmetic the user has currently
        // selected. Resolved lazily at push time so live carousel changes
        // are honoured.
        handle.__getCurrentSlot = (slot) => getSession()?.selectedSlots[slot] ?? null;
        previewHandle = handle;
        previewBox.setPreviewHandle(handle);
        presetsBar.setPreviewReady(true);
        cleanups.push(() => handle.dispose());

        if (session.selectedColor) handle.applyColor(session.selectedColor);
        for (const slot of SLOT_TYPES) {
          const filename = session.selectedSlots[slot];
          if (filename) handle.applySlot(slot, filename);
        }
      }).catch((e) => {
        warnBlobling('QPM-BLOBLING-003', { what: 'preview:init_outer' }, e);
      });

      const unsub = onSessionChange(() => {
        outfitPanel.refresh();
        gridPicker.refresh();
        const s = getSession();
        if (!s) return;
        previewBox.updateColor(s.selectedColor);
        if (!previewHandle) return;
        for (const slot of SLOT_TYPES) {
          previewHandle.applySlot(slot, s.selectedSlots[slot]);
        }
        previewHandle.applyColor(s.selectedColor);
      });
      cleanups.push(unsub);

      cleanups.push(() => {
        previewBox.destroy();
        carouselHandle.destroy();
        outfitPanel.destroy();
        destroySession();
      });

      const detachHandle = watchDetach(root, () => {
        for (const fn of cleanups) { try { fn(); } catch { /* */ } }
      });
      cleanups.push(() => detachHandle.disconnect());
    },
    '560px',
    'min(680px, calc(100vh - 32px))',
  );
}
