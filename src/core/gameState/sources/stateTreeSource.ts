import type { SourceRuntime } from '../runtime';
import type { SourceHandle, SourceRead, StateTreeSourceSpec } from '../types';

export function createStateTreeHandle<T>(
  key: string,
  spec: StateTreeSourceSpec<T>,
  index: number,
  runtime: SourceRuntime,
): SourceHandle<T> {
  const select = (state: Parameters<StateTreeSourceSpec<T>['select']>[0]): T | null | undefined =>
    spec.select(state, runtime.identity());

  const readSync = (): SourceRead<T> => {
    if (!runtime.stateTree.ready()) return { ok: false, reason: 'stateTree not ready' };
    try {
      const v = runtime.stateTree.selectSync<T>(select);
      return v === undefined ? { ok: false, reason: 'path unavailable' } : { ok: true, value: v };
    } catch (err) {
      return { ok: false, reason: `selector threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  return {
    kind: 'stateTree',
    index,
    memoized: true,
    describe: () => `stateTree:${spec.statePath || '/'}`,
    available: () => readSync().ok,
    readSync,
    read: () => Promise.resolve(readSync()),
    subscribe: (cb) => runtime.stateTree.subscribe<T>(
      select,
      (v) => { if (v !== undefined) cb(v); },
      `gameState:${key}`,
      spec.statePath,
      { trustPatches: spec.trustPatches === true },
    ),
  };
}
