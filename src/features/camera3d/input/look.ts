import { t } from '../../../i18n';
import { camera3dDiag } from '../diagnostics';
import type { ZoomBridge } from '../engine/zoomBridge';
import { showCamera3dHint } from '../hints';
import type { Runtime } from '../runtime';
import { getCamera3dSettings } from '../settings';
import { createCrosshair } from './crosshair';
import { LookGesture } from './lookGesture';

const YAW_PER_PX = 0.3;
const PITCH_PER_PX = 0.2;

type Lockable = { requestPointerLock(opts?: { unadjustedMovement?: boolean }): unknown };

// D4: right-drag looks on every surface; pointer lock is opt-in (Shift + right-click in first person) and falls back
// to drag when refused (Discord frames may refuse it). While locked, clicks and hover act at the crosshair (P6 a).
export function installLook(rt: Runtime, zoom: ZoomBridge): () => void {
  const canvas = rt.caps.scene.renderer.canvas;
  const g = new LookGesture();
  const cross = createCrosshair(canvas);
  let owned = false;
  let disposed = false;
  const live = (): boolean => rt.isLive();
  const locked = (): boolean => document.pointerLockElement === canvas;
  // The game's camera-navigation block (a modal, the inventory, a confirmation dialog): 3D stays and holds still, as 2D
  // does, and the cursor is freed for the dialog.
  const sys = rt.caps.systems.zoomSys;
  const navBlocked = (): boolean => sys.shouldBlockZoom();
  const look = (dx: number, dy: number): void => {
    const s = getCamera3dSettings();
    zoom.look(dx * YAW_PER_PX * s.sensitivity, dy * PITCH_PER_PX * s.sensitivity * (s.invertY ? -1 : 1));
  };

  const refused = (source: 'promise' | 'event'): void => {
    if (!g.lockFailed(source)) return;
    camera3dDiag.diag.info('QPM-CAM3D-005', {});
    showCamera3dHint('lockError', () => t('feature.camera3d.hint.lockError'));
  };
  // Raw mouse movement first (no OS acceleration); a platform without it (macOS) rejects with NotSupportedError.
  const requestLock = (raw: boolean): void => {
    let p: unknown;
    try {
      p = (canvas as unknown as Lockable).requestPointerLock(raw ? { unadjustedMovement: true } : undefined);
    } catch {
      if (raw) { requestLock(false); return; }
      g.lockRequested(true);
      refused('promise');
      return;
    }
    const viaPromise = !!p && typeof (p as Promise<void>).then === 'function';
    g.lockRequested(viaPromise);
    if (!viaPromise) return;
    (p as Promise<void>).then(undefined, (err: unknown) => {
      if (raw && !disposed && live() && (err as { name?: unknown } | null)?.name === 'NotSupportedError') { requestLock(false); return; }
      refused('promise');
    });
  };

  const onDown = (e: PointerEvent): void => {
    const on = e.button === 2 && live() && !navBlocked();
    const fp = on ? zoom.state().fp : false;
    const act = g.down({ button: e.button, onCanvas: e.target === canvas, shift: e.shiftKey }, on, fp, e.clientX, e.clientY);
    if (act === 'none') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (act === 'lock' && !locked()) requestLock(true);
  };
  const onMove = (e: PointerEvent): void => {
    if (owned && locked()) {
      if (!live() || !zoom.state().fp || navBlocked()) { document.exitPointerLock(); return; }
      look(e.movementX, e.movementY);
      // Not swallowed: PIXI maps the frozen pointer to the screen centre (remap.ts), so the game's hover follows the aim.
      return;
    }
    if (!g.move(e.buttons, e.clientX, e.clientY)) return;
    if (navBlocked()) { g.cancel(); return; }
    e.stopImmediatePropagation();
    look(g.dx, g.dy);
  };
  const onUp = (e: PointerEvent): void => {
    if (!g.up(e.button)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  const onCancel = (): void => { g.cancel(); };
  const onCtx = (e: MouseEvent): void => { if (g.contextMenu(e.target === canvas, live())) e.preventDefault(); };
  const onLockChange = (): void => {
    const now = locked();
    owned = now && (g.lockChanged(true) || owned);
    if (owned) cross.show(); else cross.hide();
  };
  const onLockError = (): void => { refused('event'); };

  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('blur', onCancel);
  window.addEventListener('contextmenu', onCtx, true);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  const offExit = rt.onExit(() => {
    g.cancel();
    cross.hide();
    if (locked()) document.exitPointerLock();
  });

  return () => {
    disposed = true;
    offExit();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('blur', onCancel);
    window.removeEventListener('contextmenu', onCtx, true);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('pointerlockerror', onLockError);
    cross.hide();
    if (locked()) document.exitPointerLock();
  };
}
