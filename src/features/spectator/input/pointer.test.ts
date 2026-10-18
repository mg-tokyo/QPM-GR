// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPointer, type PointerContext } from './pointer';

let canvas: HTMLCanvasElement;
let panel: HTMLDivElement;
let off: () => void;
let ctx: PointerContext & { ui: boolean; on: boolean; hud: boolean };
const log: string[] = [];
let drags: Array<[number, number]>;
let gameSaw: number;

const ev = (type: string, x: number, y: number, over: { button?: number; buttons?: number; pointerId?: number } = {}): PointerEvent =>
  new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: over.button ?? 0, buttons: over.buttons ?? (type === 'pointerup' ? 0 : 1),
    pointerId: over.pointerId ?? 1,
  });

beforeEach(() => {
  document.body.innerHTML = '';
  canvas = document.createElement('canvas');
  panel = document.createElement('div');
  document.body.append(canvas, panel);
  log.length = 0;
  drags = [];
  gameSaw = 0;
  // PIXI listens on the canvas itself.
  canvas.addEventListener('pointerdown', () => { gameSaw++; });
  ctx = {
    ui: false, on: true, hud: false,
    active: () => ctx.on,
    uiOwnsInput: () => ctx.ui,
    isWorldTarget: (t) => t === canvas,
    toGlobal: (x, y) => ({ x: x - 10, y: y - 20 }),
    overUi: () => ctx.hud,
    activity: () => { log.push('activity'); },
  };
  off = installPointer(ctx, {
    dragStart: () => { log.push('dragStart'); },
    drag: (dx, dy) => { drags.push([dx, dy]); },
    click: (x, y) => { log.push(`click ${x},${y}`); },
  });
});

afterEach(() => { off(); });

describe('spectator pointer', () => {
  it('a world press never reaches the game; a release within 6 px is a click at the press point', () => {
    canvas.dispatchEvent(ev('pointerdown', 110, 120));
    expect(gameSaw).toBe(0);
    window.dispatchEvent(ev('pointermove', 113, 123));
    window.dispatchEvent(ev('pointerup', 113, 123));
    expect(log).toEqual(['activity', 'click 100,100']);
    expect(drags).toEqual([]);
  });

  it('past 6 px it is a drag: follow stops once, every move pans, and the release is no click', () => {
    canvas.dispatchEvent(ev('pointerdown', 110, 120, { button: 2 }));
    window.dispatchEvent(ev('pointermove', 114, 120));
    window.dispatchEvent(ev('pointermove', 118, 120));
    window.dispatchEvent(ev('pointermove', 118, 130));
    window.dispatchEvent(ev('pointerup', 118, 130));
    expect(log.filter((l) => l === 'dragStart')).toHaveLength(1);
    expect(log.some((l) => l.startsWith('click'))).toBe(false);
    expect(drags).toEqual([[8, 0], [0, 10]]);
  });

  it('a release outside the window (no pointerup here) never leaves a drag armed for later hovers', () => {
    canvas.dispatchEvent(ev('pointerdown', 110, 120, { button: 2, buttons: 2 }));
    window.dispatchEvent(ev('pointermove', 130, 120, { buttons: 2 }));
    expect(drags).toEqual([[20, 0]]);
    window.dispatchEvent(ev('pointermove', 160, 120, { buttons: 0 }));
    window.dispatchEvent(ev('pointermove', 190, 120, { buttons: 0 }));
    expect(drags).toEqual([[20, 0]]);
    // The next press of the same pointer starts fresh even without a move in between.
    canvas.dispatchEvent(ev('pointerdown', 110, 120, { button: 2, buttons: 2 }));
    canvas.dispatchEvent(ev('pointerdown', 110, 120));
    window.dispatchEvent(ev('pointerup', 110, 120));
    expect(log.filter((l) => l.startsWith('click'))).toEqual(['click 100,100']);
  });

  it('another pointer, a cancel or a blur never finishes the press', () => {
    canvas.dispatchEvent(ev('pointerdown', 110, 120));
    window.dispatchEvent(ev('pointerup', 110, 120, { pointerId: 2 }));
    window.dispatchEvent(ev('pointercancel', 110, 120));
    window.dispatchEvent(ev('pointerup', 110, 120));
    canvas.dispatchEvent(ev('pointerdown', 110, 120));
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(ev('pointerup', 110, 120));
    expect(log.some((l) => l.startsWith('click'))).toBe(false);
  });

  it('leaves the press to the game over the HUD, while a game window owns input, off the canvas, for the middle button or when idle', () => {
    const tries: Array<[string, () => void]> = [
      ['hud', () => { ctx.hud = true; }],
      ['ui', () => { ctx.ui = true; }],
      ['middle', () => {}],
      ['idle', () => { ctx.on = false; }],
    ];
    for (const [name, set] of tries) {
      ctx.hud = false; ctx.ui = false; ctx.on = true;
      set();
      const before = gameSaw;
      canvas.dispatchEvent(ev('pointerdown', 110, 120, { button: name === 'middle' ? 1 : 0 }));
      window.dispatchEvent(ev('pointerup', 110, 120));
      expect(gameSaw, name).toBe(before + 1);
    }
    let panelSaw = 0;
    panel.addEventListener('pointerdown', () => { panelSaw++; });
    ctx.hud = false; ctx.ui = false; ctx.on = true;
    panel.dispatchEvent(ev('pointerdown', 110, 120));
    window.dispatchEvent(ev('pointerup', 110, 120));
    expect(panelSaw).toBe(1);
    expect(log.some((l) => l.startsWith('click'))).toBe(false);
  });

  it('uninstall is idempotent and gives every press back', () => {
    off();
    off();
    canvas.dispatchEvent(ev('pointerdown', 110, 120));
    window.dispatchEvent(ev('pointerup', 110, 120));
    expect(gameSaw).toBe(1);
    expect(log).toEqual([]);
  });
});
