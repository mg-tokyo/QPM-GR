import { notify } from '../../../core/notifications';
import { t } from '../../../i18n';
import { camera3dDiag } from '../diagnostics';
import type { ZoomBridge } from '../engine/zoomBridge';
import type { Runtime } from '../runtime';
import { getCamera3dHints, getCamera3dSettings, markCamera3dHint } from '../settings';

const YAW_PER_PX = 0.3;
const PITCH_PER_PX = 0.2;

// D4: right-drag looks on every surface; pointer lock is opt-in (Shift + right-click in first person) and falls back
// to drag when refused (Discord frames may refuse it).
export function installLook(rt: Runtime, zoom: ZoomBridge): () => void {
  const canvas = rt.caps.scene.renderer.canvas;
  const st = { dragging: false, lx: 0, ly: 0, locked: false, swallowUp: false };
  const live = (): boolean => rt.isLive();
  const sens = (): { yaw: number; pitch: number } => {
    const s = getCamera3dSettings();
    return { yaw: YAW_PER_PX * s.sensitivity, pitch: PITCH_PER_PX * s.sensitivity * (s.invertY ? -1 : 1) };
  };

  const lockError = (): void => {
    camera3dDiag.diag.info('QPM-CAM3D-005', {});
    if (getCamera3dHints().lockError) return;
    markCamera3dHint('lockError');
    notify({ feature: 'camera3d', level: 'info', message: t('feature.camera3d.hint.lockError') });
  };
  const requestLock = (): void => {
    try {
      const p: unknown = canvas.requestPointerLock();
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(lockError);
    } catch { lockError(); }
  };

  const onDown = (e: PointerEvent): void => {
    if (!live() || e.button !== 2 || e.target !== canvas) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.shiftKey && zoom.state().fp) { st.swallowUp = true; requestLock(); return; }
    st.dragging = true;
    st.lx = e.clientX;
    st.ly = e.clientY;
  };
  const onMove = (e: PointerEvent): void => {
    if (st.locked && document.pointerLockElement === canvas) {
      if (!zoom.state().fp) { document.exitPointerLock(); return; }
      const s = sens();
      zoom.look(e.movementX * s.yaw, e.movementY * s.pitch);
      e.stopImmediatePropagation();
      return;
    }
    if (!st.dragging) return;
    if ((e.buttons & 2) === 0) { st.dragging = false; return; } // missed button-2 release (spike input 13)
    e.stopImmediatePropagation();
    const s = sens();
    zoom.look((e.clientX - st.lx) * s.yaw, (e.clientY - st.ly) * s.pitch);
    st.lx = e.clientX;
    st.ly = e.clientY;
  };
  const onUp = (e: PointerEvent): void => {
    if (st.swallowUp && e.button === 2) { st.swallowUp = false; e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (!st.dragging || e.button !== 2) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    st.dragging = false;
  };
  const onCancel = (): void => { st.dragging = false; };
  const onCtx = (e: MouseEvent): void => { if (live() && e.target === canvas) e.preventDefault(); };
  const onLockChange = (): void => { st.locked = document.pointerLockElement === canvas; };

  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('blur', onCancel);
  window.addEventListener('contextmenu', onCtx, true);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', lockError);
  const offExit = rt.onExit(() => { st.dragging = false; if (document.pointerLockElement === canvas) document.exitPointerLock(); });

  return () => {
    offExit();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('blur', onCancel);
    window.removeEventListener('contextmenu', onCtx, true);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('pointerlockerror', lockError);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
}
