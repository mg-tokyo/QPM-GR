import { describe, expect, it, vi } from 'vitest';
import { createViewEmitter } from './view';

describe('camera3d view emitter', () => {
  it('starts not ready and emits only on change', () => {
    const e = createViewEmitter();
    expect(e.get()).toEqual({ ready: false, live: false, fp: false, paused: false });
    const cb = vi.fn();
    e.on(cb);
    e.publish({ ready: false, live: false, fp: false, paused: false });
    expect(cb).not.toHaveBeenCalled();
    e.publish({ ready: true, live: false, fp: false, paused: false });
    e.publish({ ready: true, live: false, fp: false, paused: false });
    e.publish({ ready: true, live: true, fp: false, paused: false });
    e.publish({ ready: true, live: true, fp: true, paused: false });
    expect(cb.mock.calls.map((c) => c[0])).toEqual([
      { ready: true, live: false, fp: false, paused: false },
      { ready: true, live: true, fp: false, paused: false },
      { ready: true, live: true, fp: true, paused: false },
    ]);
    expect(e.get()).toEqual({ ready: true, live: true, fp: true, paused: false });
    e.publish({ ready: false, live: false, fp: false, paused: true });
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it('isolates a throwing listener and stops after unsubscribe', () => {
    const e = createViewEmitter();
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    e.on(bad);
    const off = e.on(good);
    e.publish({ ready: true, live: false, fp: false, paused: false });
    expect(good).toHaveBeenCalledTimes(1);
    off();
    e.publish({ ready: true, live: true, fp: false, paused: false });
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(2);
  });
});
