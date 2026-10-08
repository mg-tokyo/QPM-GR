import { ensurePanelStyles } from '../../../ui/core/panelStyles';

const ARM = 14;
const BAR = 2;
const EDGE = 1;

export interface Crosshair { show(): void; hide(): void }

// A plain plus at the canvas centre while pointer lock is on (P6 a, user-approved mockup 2026-10-04): clicks and hover
// act there. It exists only while shown, so it costs nothing otherwise.
export function createCrosshair(canvas: HTMLCanvasElement): Crosshair {
  let el: HTMLDivElement | null = null;
  let watch: ResizeObserver | null = null;
  const place = (): void => {
    if (!el) return;
    const r = canvas.getBoundingClientRect();
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${r.top + r.height / 2}px`;
  };
  const bar = (w: number, h: number, colour: string): HTMLDivElement => {
    const b = document.createElement('div');
    b.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform:translate(-50%,-50%);background:${colour};`;
    return b;
  };
  return {
    show() {
      if (el) { place(); return; }
      ensurePanelStyles();
      el = document.createElement('div');
      el.dataset.qpm = 'camera3d-crosshair';
      el.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;z-index:2147483000;';
      // Dark outline bars under the light ones, so the outline never cuts into the centre.
      const outline = 'var(--qpm-surface-1)', fill = 'var(--qpm-text)';
      el.append(bar(ARM + 2 * EDGE, BAR + 2 * EDGE, outline), bar(BAR + 2 * EDGE, ARM + 2 * EDGE, outline), bar(ARM, BAR, fill), bar(BAR, ARM, fill));
      document.body.appendChild(el);
      place();
      // The canvas itself, not window resize: locking changed the viewport by 4 px and the game resized its canvas after
      // the window event (live 2026-10-04), so the plus sat 2 px off the aim point.
      watch = new ResizeObserver(place);
      watch.observe(canvas);
    },
    hide() {
      if (!el) return;
      watch?.disconnect();
      watch = null;
      el.remove();
      el = null;
    },
  };
}
