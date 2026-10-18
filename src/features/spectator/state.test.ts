import { describe, expect, it } from 'vitest';
import { createSpectatorStore, initialSpectatorState } from './state';

describe('spectator state store', () => {
  it('starts inactive in free 2D with nothing followed', () => {
    expect(createSpectatorStore().get()).toEqual(initialSpectatorState());
    expect(initialSpectatorState()).toMatchObject({ active: false, mode: 'free', view: '2d', targetId: null, paused: null, director: false, uiHidden: false });
  });

  it('patch merges, notifies, and never mutates an earlier snapshot', () => {
    const store = createSpectatorStore();
    const before = store.get();
    const seen: boolean[] = [];
    store.on((s) => seen.push(s.active));
    store.patch({ active: true, pose: { x: 3, y: 4, alt: 64, yaw: 0, pitch: 0 } });
    expect(seen).toEqual([true]);
    expect(store.get()).toMatchObject({ active: true, pose: { x: 3, y: 4 } });
    expect(before.active).toBe(false);
  });

  it('a patch that changes nothing does not notify', () => {
    const store = createSpectatorStore();
    let n = 0;
    store.on(() => { n++; });
    store.patch({ active: false, mode: 'free' });
    store.patch({});
    expect(n).toBe(0);
  });

  it('off detaches the listener and a throwing listener does not stop the others', () => {
    const store = createSpectatorStore();
    let a = 0, b = 0;
    const offA = store.on(() => { a++; });
    store.on(() => { throw new Error('boom'); });
    store.on(() => { b++; });
    store.patch({ director: true });
    offA();
    offA();
    store.patch({ director: false });
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});
