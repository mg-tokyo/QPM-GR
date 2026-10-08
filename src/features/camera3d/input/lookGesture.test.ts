import { describe, expect, it } from 'vitest';
import { LookGesture } from './lookGesture';

const right = { button: 2, onCanvas: true, shift: false };

describe('LookGesture', () => {
  it('a right-press on the canvas while live drags; moves give deltas; its release is swallowed once', () => {
    const g = new LookGesture();
    expect(g.down(right, true, false, 100, 100)).toBe('drag');
    expect(g.move(2, 110, 95)).toBe(true);
    expect([g.dx, g.dy]).toEqual([10, -5]);
    expect(g.up(2)).toBe(true);
    expect(g.up(2)).toBe(false);
    expect(g.move(2, 120, 95)).toBe(false);
  });

  it('ignores presses that are not ours', () => {
    const g = new LookGesture();
    expect(g.down(right, false, false, 0, 0)).toBe('none');
    expect(g.down({ ...right, onCanvas: false }, true, false, 0, 0)).toBe('none');
    expect(g.down({ ...right, button: 0 }, true, false, 0, 0)).toBe('none');
    expect(g.dragging).toBe(false);
    expect(g.up(2)).toBe(false);
  });

  it('Shift+right in first person asks for the lock and still drags, so a refused lock keeps looking (A I7)', () => {
    const g = new LookGesture();
    expect(g.down({ ...right, shift: true }, true, true, 50, 50)).toBe('lock');
    expect(g.move(2, 60, 50)).toBe(true);
    expect(g.dx).toBe(10);
    expect(g.down({ ...right, shift: true }, true, false, 50, 50)).toBe('drag');
  });

  it('a missed button-2 release ends the drag on the next move', () => {
    const g = new LookGesture();
    g.down(right, true, false, 0, 0);
    expect(g.move(0, 5, 5)).toBe(false);
    expect(g.dragging).toBe(false);
  });

  it('blur, cancel or exit clears the drag, so a later right release reaches the game', () => {
    const g = new LookGesture();
    g.down(right, true, false, 0, 0);
    g.cancel();
    expect(g.up(2)).toBe(false);
  });

  it('suppresses the context menu of a right-drag that began on the canvas wherever it is released', () => {
    const g = new LookGesture();
    g.down(right, true, false, 0, 0);
    g.up(2);
    expect(g.contextMenu(false, true)).toBe(true);
    // Consumed: a later right-click on a QPM window opens its menu.
    expect(g.contextMenu(false, true)).toBe(false);
    expect(g.contextMenu(true, true)).toBe(true);
    expect(g.contextMenu(true, false)).toBe(false);
  });

  it('a press elsewhere disarms a menu that never came', () => {
    const g = new LookGesture();
    g.down(right, true, false, 0, 0);
    g.up(2);
    g.down({ ...right, onCanvas: false }, true, false, 0, 0);
    expect(g.contextMenu(false, true)).toBe(false);
  });

  it('reports a refused lock once, and only for our own request', () => {
    const g = new LookGesture();
    expect(g.lockFailed('event')).toBe(false);
    g.lockRequested(true);
    expect(g.lockFailed('event')).toBe(false);
    expect(g.lockFailed('promise')).toBe(true);
    expect(g.lockFailed('promise')).toBe(false);
    g.lockRequested(false);
    expect(g.lockFailed('event')).toBe(true);
    expect(g.lockFailed('event')).toBe(false);
  });

  it('a granted lock settles the request: a later error is not ours', () => {
    const g = new LookGesture();
    g.lockRequested(false);
    expect(g.lockChanged(true)).toBe(true);
    expect(g.lockFailed('event')).toBe(false);
  });

  it('a lock nobody here asked for is not ours, and an unlock is never ours', () => {
    const g = new LookGesture();
    expect(g.lockChanged(true)).toBe(false);
    g.lockRequested(true);
    expect(g.lockChanged(false)).toBe(false);
    expect(g.lockChanged(true)).toBe(true);
  });
});
