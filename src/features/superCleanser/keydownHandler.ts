// Capture-phase Space handler that fans out CropCleanser to every matching
// slot on the current tile. Independent of instaAction — register the
// capture listener before instaAction's so this runs first; if we don't
// intercept (early returns below), instaAction still fires as normal.

import { pageWindow } from '../../core/pageContext';
import { readAtomValueSync } from '../../core/atomRegistry';
import { sendRoomAction } from '../../websocket/api';
import { notify } from '../../core/notifications';
import { t } from '../../i18n';
import { getSuperCleanseSettings } from './storage';
import { getSuperCleanseSnapshot } from './selector';
import { matchSlots } from './matching';
import { CROP_CLEANSER_TOOL_ID } from './constants';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { Subsystem } from '../../diagnostics/types';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:superCleanser';
const FEATURE_NAME = 'superCleanser';
const log = createNamedLogger(FEATURE_SUBSYSTEM);

function warnFeature(code: Parameters<typeof buildError>[0], ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  log.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function onKeyDownCapture(event: KeyboardEvent): void {
  if (event.code !== 'Space') return;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (isTextInputFocused()) return;

  const settings = getSuperCleanseSettings();
  if (!settings.enabled) return;

  if (readAtomValueSync('selectedItemId') !== CROP_CLEANSER_TOOL_ID) return;

  const snap = getSuperCleanseSnapshot();
  if (snap.currentTileIdx == null) return;
  if (snap.hoveredWeatherSet.length === 0) return;

  const matches = matchSlots(
    snap.hoveredWeatherSet,
    settings.filterMutations,
    settings.filterMode,
    snap.slotsOnTile,
  );
  if (matches.length === 0) return;
  if (matches.length === 1 && matches[0]?.slotId === snap.hoveredSlotId) return;

  let sent = 0;
  let failed = 0;
  for (const slot of matches) {
    const result = sendRoomAction(
      'CropCleanser',
      { tileObjectIdx: snap.currentTileIdx, growSlotIdx: slot.slotId },
      { skipThrottle: true },
    );
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      warnFeature('QPM-FEATURE-001', {
        type: 'CropCleanser',
        reason: result.reason ?? 'unknown',
        slotId: slot.slotId,
      });
    }
  }

  event.stopImmediatePropagation();
  event.preventDefault();

  if (failed === 0) {
    notify({
      feature: FEATURE_NAME,
      level: 'info',
      message: t('feature.superCleanser.cleansed', { count: sent }),
    });
  } else {
    notify({
      feature: FEATURE_NAME,
      level: 'warn',
      message: t('feature.superCleanser.partial', { sent, total: sent + failed }),
    });
  }
}

let listening = false;

export function startSuperCleanseKeydown(): void {
  if (listening) return;
  listening = true;
  (pageWindow as unknown as Window).addEventListener(
    'keydown', onKeyDownCapture as EventListener, true,
  );
}

export function stopSuperCleanseKeydown(): void {
  if (!listening) return;
  listening = false;
  (pageWindow as unknown as Window).removeEventListener(
    'keydown', onKeyDownCapture as EventListener, true,
  );
}
