import type { CustomSourceSpec, SourceHandle, SourceRead } from '../types';

export function createCustomHandle<T>(spec: CustomSourceSpec<T>, index: number): SourceHandle<T> {
  const readSync = (): SourceRead<T> => {
    try {
      if (!spec.available()) return { ok: false, reason: `custom:${spec.id} unavailable` };
      const v = spec.read();
      return v === undefined ? { ok: false, reason: `custom:${spec.id} returned undefined` } : { ok: true, value: v };
    } catch (err) {
      return { ok: false, reason: `custom:${spec.id} threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
  return {
    kind: 'custom',
    index,
    describe: () => `custom:${spec.id}`,
    available: () => readSync().ok,
    readSync,
    read: () => Promise.resolve(readSync()),
    subscribe: (cb) => {
      const push = (): void => { const r = readSync(); if (r.ok) cb(r.value); };
      push();
      return spec.subscribe ? spec.subscribe(push) : () => {};
    },
  };
}
