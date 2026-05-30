/**
 * Virtual cursor — a small overlay element driven by the right analog stick.
 * Velocity-based movement: stick deflection → pixels/second.
 *
 * Mounted on <html> (not <body>) so it is a sibling of <body> in the DOM.
 * Within the root stacking context, elements later in DOM order paint on top
 * for the same z-index — this places us above all <body>-appended mod overlays
 * (QPM-GR, AriesMod sprite overlay, etc.).
 *
 * A MutationObserver keeps the cursor as the last child of <html>, beating
 * any mod that also appends to <html> (e.g. AriesMod auto-reconnect overlay).
 */

import { clickAt } from './synthesis';

const CURSOR_SIZE_PX = 32;
const HIDE_AFTER_STICK_MS = 400;  // hide after right-stick goes idle
const HIDE_AFTER_SNAP_MS  = 2500; // hide after D-pad snap (longer)

const CURSOR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE_PX}" height="${CURSOR_SIZE_PX}" viewBox="0 0 20 20">
  <polygon points="2,2 2,16 6,12 9,18 11,17 8,11 14,11"
    fill="white" stroke="#222" stroke-width="1.0"/>
</svg>`.trim();

export class Cursor {
  private el: HTMLElement;
  private x = window.innerWidth / 2;
  private y = window.innerHeight / 2;
  private visible = false;
  private forceVisible = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private speedPxPerSec: number;
  private observer: MutationObserver;

  constructor(speedPxPerSec: number) {
    this.speedPxPerSec = speedPxPerSec;
    this.el = this.createElement();

    // Append to <html> — sibling of <body>, paints after all body content
    document.documentElement.appendChild(this.el);

    // Stay last child so we beat any mod that also appends to <html>
    this.observer = new MutationObserver(() => {
      if (document.documentElement.lastChild !== this.el) {
        document.documentElement.appendChild(this.el);
      }
    });
    this.observer.observe(document.documentElement, { childList: true });
  }

  private createElement(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'mg-controller-cursor';
    el.innerHTML = CURSOR_SVG;
    Object.assign(el.style, {
      position:      'fixed',
      left:          '0px',
      top:           '0px',
      width:         `${CURSOR_SIZE_PX}px`,
      height:        `${CURSOR_SIZE_PX}px`,
      pointerEvents: 'none',
      zIndex:        '2147483647',
      transform:     'translate(-2px, -2px)',
      display:       'none',
    });
    return el;
  }

  /** Update cursor position from right-stick axes. `dt` is seconds since last frame. */
  update(axisX: number, axisY: number, dt: number): void {
    const DEAD_ZONE = 0.12;
    const moving = Math.abs(axisX) > DEAD_ZONE || Math.abs(axisY) > DEAD_ZONE;

    if (moving) {
      this.x = Math.max(0, Math.min(window.innerWidth  - 1, this.x + axisX * this.speedPxPerSec * dt));
      this.y = Math.max(0, Math.min(window.innerHeight - 1, this.y + axisY * this.speedPxPerSec * dt));
      this.el.style.left = `${this.x}px`;
      this.el.style.top  = `${this.y}px`;
      this.show();
      this.resetHideTimer(HIDE_AFTER_STICK_MS);
    }
  }

  /** Call every frame to keep the forced-visible state in sync with modal state. */
  setModalOpen(open: boolean): void {
    this.forceVisible = open;
    if (open) {
      this.show();
      if (this.hideTimer !== null) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    } else if (!open && this.visible && this.hideTimer === null) {
      this.resetHideTimer(HIDE_AFTER_STICK_MS);
    }
  }

  /**
   * Warp cursor to a viewport position (D-pad snap).
   * Uses the longer hide delay so the cursor stays visible after snapping.
   */
  warpTo(x: number, y: number): void {
    this.x = Math.max(0, Math.min(window.innerWidth  - 1, x));
    this.y = Math.max(0, Math.min(window.innerHeight - 1, y));
    this.el.style.left = `${this.x}px`;
    this.el.style.top  = `${this.y}px`;
    this.show();
    this.resetHideTimer(HIDE_AFTER_SNAP_MS);
  }

  /** Dispatch a click at the cursor's current position. */
  click(): void {
    clickAt(this.x, this.y);
  }

  getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  setSpeed(speedPxPerSec: number): void {
    this.speedPxPerSec = speedPxPerSec;
  }

  isVisible(): boolean {
    return this.visible;
  }

  private show(): void {
    if (this.visible) return;
    this.visible = true;
    this.el.style.display = 'block';
  }

  private hide(): void {
    if (this.forceVisible) return;
    this.visible = false;
    this.el.style.display = 'none';
  }

  private resetHideTimer(delayMs: number): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.hide();
    }, delayMs);
  }

  destroy(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.observer.disconnect();
    this.el.remove();
  }
}
