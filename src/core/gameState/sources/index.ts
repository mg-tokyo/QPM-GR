import type { SourceRuntime } from '../runtime';
import type { KeyDefinition, SourceHandle } from '../types';
import { createAtomHandle } from './atomSource';
import { createCustomHandle } from './customSource';
import { createStateTreeHandle } from './stateTreeSource';

export function createHandles<T>(key: string, def: KeyDefinition<T>, runtime: SourceRuntime): SourceHandle<T>[] {
  return def.sources.map((spec, index) => {
    switch (spec.kind) {
      case 'stateTree': return createStateTreeHandle(key, spec, index, runtime);
      case 'atom': return createAtomHandle(key, spec, index, runtime, def.tier);
      case 'custom': return createCustomHandle(spec, index);
    }
  });
}

export { createStateTreeHandle } from './stateTreeSource';
export { createAtomHandle } from './atomSource';
export { createCustomHandle } from './customSource';
