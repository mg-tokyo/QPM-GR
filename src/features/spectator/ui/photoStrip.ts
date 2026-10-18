import { t } from '../../../i18n';
import type { PhotoStrip, PhotoView, StripActions } from '../photo/mode';
import { setEnabled, setLabel, span, toolButton } from './buttons';
import { acquireSpectatorStyles } from './styles';

// PS3 (2026-10-10): Enter and Space capture, fixed like Esc; P (rebindable) leaves.
const CAPTURE_KEY = 'Enter';
const CAPTURE_ALT = 'Space';

/** The slim photo strip, bottom centre (S §9, PS3). It carries qpm-spec-photo-ui, so photo mode's page hide skips it. */
export function mountPhotoStrip(actions: StripActions, keys: { photo(): string }): PhotoStrip {
  const releaseStyles = acquireSpectatorStyles();
  let destroyed = false;
  let shown: Blob | null = null;
  let url: string | null = null;

  const el = document.createElement('div');
  el.className = 'qpm-spec-bar qpm-spec-strip qpm-spec-photo-ui';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', t('feature.spectator.photo.label'));
  const hint = (btn: HTMLButtonElement, text: string): HTMLButtonElement => { btn.title = text; return btn; };

  const capture = hint(
    toolButton('photo', t('feature.spectator.photo.capture', { key: CAPTURE_KEY }), 'secondary', () => { actions.capture(); }),
    t('feature.spectator.photo.captureHint', { key: CAPTURE_KEY, alt: CAPTURE_ALT }),
  );
  const thumb = document.createElement('img');
  thumb.className = 'qpm-spec-strip-thumb';
  thumb.hidden = true;
  thumb.alt = '';
  thumb.title = t('feature.spectator.photo.lastShot');
  const status = span('qpm-spec-strip-status');
  const copy = hint(toolButton('copy', t('feature.spectator.photo.copy'), 'secondary', () => { actions.copy(); }),
    t('feature.spectator.photo.copyHint'));
  const save = hint(toolButton('save', t('feature.spectator.photo.save'), 'secondary', () => { actions.save(); }),
    t('feature.spectator.photo.saveHint'));
  const exit = toolButton('exit', '', 'ghost', () => { actions.exit(); });
  el.append(span('qpm-spec-chip', t('feature.spectator.bar.photo')), span('qpm-spec-sep'), capture, span('qpm-spec-sep'),
    thumb, status, copy, save, span('qpm-spec-sep'), exit);
  document.body.append(el);

  const showShot = (shot: Blob | null): void => {
    if (shot === shown) return;
    shown = shot;
    if (url) URL.revokeObjectURL(url);
    url = shot ? URL.createObjectURL(shot) : null;
    if (url) thumb.src = url;
    else thumb.removeAttribute('src');
    thumb.hidden = url === null;
  };

  return {
    update(v: Readonly<PhotoView>) {
      if (destroyed) return;
      showShot(v.shot);
      status.textContent = t(`feature.spectator.photo.status.${v.status}`);
      const ready = v.shot !== null && v.status !== 'capturing';
      setEnabled(copy, ready);
      setEnabled(save, ready);
      const key = keys.photo();
      setLabel(exit, t('feature.spectator.bar.exit', { key }));
      exit.title = t('feature.spectator.photo.exitHint', { key });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      showShot(null);
      el.remove();
      releaseStyles();
    },
  };
}
