export interface Camera3dView { ready: boolean; live: boolean; fp: boolean }

export interface ViewEmitter {
  get(): Camera3dView;
  publish(next: Camera3dView): void;
  on(cb: (v: Camera3dView) => void): () => void;
}

export function createViewEmitter(): ViewEmitter {
  let view: Camera3dView = { ready: false, live: false, fp: false };
  const listeners = new Set<(v: Camera3dView) => void>();
  return {
    get: () => view,
    publish(next) {
      if (next.ready === view.ready && next.live === view.live && next.fp === view.fp) return;
      view = next;
      for (const cb of listeners) {
        try { cb(next); } catch { /* isolate listeners */ }
      }
    },
    on(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
