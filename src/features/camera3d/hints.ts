import { notify, type NotificationAction } from '../../core/notifications';
import { t } from '../../i18n';
import { showToast } from '../../ui/components';
import {
  applyGraphicsPreset, getCamera3dHints, getCamera3dSettings, graphicsPresetOf, markCamera3dHint, type Camera3dHints, type GraphicsPreset,
} from './settings';

const HINT_MS = 6000;
// An offer needs time to read and reach the button (PC14).
const OFFER_MS = 15000;
// Clear of the game's hotbar at the bottom-right on a 16:9 window (user-approved mockup 2026-10-04).
const HINT_MAX_W = 240;

/** One-time hint, on screen as well as in the panel's notification list: the list alone is never seen in play (A T3). */
export function showCamera3dHint(key: keyof Camera3dHints, message: () => string): void {
  if (getCamera3dHints()[key]) return;
  markCamera3dHint(key);
  const text = message();
  notify({ feature: 'camera3d', level: 'info', message: text });
  showToast(text, { variant: 'info', duration: HINT_MS, maxWidth: HINT_MAX_W });
}

/** A state change the player must notice (A R3): on screen and in the notification list, every time. */
export function showCamera3dWarning(text: string): void {
  notify({ feature: 'camera3d', level: 'warn', message: text });
  showToast(text, { variant: 'error', duration: HINT_MS, maxWidth: HINT_MAX_W });
}

// The one-time "3D is slow" offer (S §4.4, PC14), marked before it shows so nothing can repeat it. The notification
// list keeps the action: once the player has changed graphics themselves, a late Apply leaves their choice alone.
export function showCamera3dSlowOffer(p: GraphicsPreset): void {
  markCamera3dHint('slowSuggested');
  const from = graphicsPresetOf(getCamera3dSettings());
  const preset = t(`feature.camera3d.graphics.${p}`);
  const text = t('feature.camera3d.slow.offer', { preset });
  const action: NotificationAction = {
    label: t('feature.camera3d.slow.apply'),
    onClick: () => {
      if (graphicsPresetOf(getCamera3dSettings()) !== from) return;
      applyGraphicsPreset(p);
      showToast(t('feature.camera3d.slow.applied', { preset }), { variant: 'info', duration: HINT_MS, maxWidth: HINT_MAX_W });
    },
  };
  notify({ feature: 'camera3d', level: 'info', message: text, actions: [action] });
  showToast(text, { variant: 'info', duration: OFFER_MS, maxWidth: HINT_MAX_W, action });
}
