// Adapter seam over stateTree + jotaiBridge.
// Tests pass a fake SourceRuntime; production uses createProductionRuntime().
import type { PatchPath, SubscriberTier } from '../reactive/types';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';
import type { IdentityContext, Selected } from './types';
import {
  findAtomsByLabel, getAtomCacheSize, getCachedStore, readAtomValue, subscribeAtom, writeAtomValue,
} from '../jotaiBridge';
import { selectSync as stateTreeSelectSync, stateTreeReady, subscribe as stateTreeSubscribe } from '../stateTree';

export interface StateTreeRuntime {
  ready(): boolean;
  selectSync<T>(selector: (state: QuinoaStateSnapshot) => Selected<T>): Selected<T>;
  subscribe<T>(
    selector: (state: QuinoaStateSnapshot) => Selected<T>,
    cb: (value: Selected<T>) => void,
    label: string,
    statePath?: PatchPath,
    opts?: { trustPatches?: boolean; ignorePatchSuffixes?: readonly string[] },
  ): () => void;
}

export interface AtomRuntime {
  findAtoms(label: RegExp): readonly unknown[];
  labelOf(atom: unknown): string;
  /** Throws when the store cannot read the atom. */
  readSync(atom: unknown): unknown;
  read(atom: unknown): Promise<unknown>;
  subscribe(atom: unknown, cb: (value: unknown) => void, tier?: SubscriberTier, statePath?: PatchPath): Promise<() => void>;
  write(atom: unknown, value: unknown): Promise<void>;
  cacheSize(): number;
}

export interface SourceRuntime {
  readonly stateTree: StateTreeRuntime;
  readonly atoms: AtomRuntime;
  identity(): IdentityContext;
  now(): number;
}

export function atomLabelOf(atom: unknown): string {
  if (!atom || typeof atom !== 'object') return '';
  const rec = atom as Record<string, unknown>;
  const label = rec.debugLabel ?? rec.label;
  return typeof label === 'string' ? label : '';
}

export function createProductionRuntime(identity: () => IdentityContext): SourceRuntime {
  return {
    stateTree: {
      ready: () => stateTreeReady(),
      // stateTree.selectSync returns null for "no snapshot" — map that to undefined
      // so the handle reports unavailable rather than a null value.
      selectSync: <T>(selector: (state: QuinoaStateSnapshot) => Selected<T>): Selected<T> => {
        if (!stateTreeReady()) return undefined;
        let sawSnapshot = false;
        const out = stateTreeSelectSync<Selected<T>>((s) => { sawSnapshot = true; return selector(s); });
        return sawSnapshot ? out : undefined;
      },
      subscribe: <T>(
        selector: (state: QuinoaStateSnapshot) => Selected<T>,
        cb: (value: Selected<T>) => void,
        label: string,
        statePath?: PatchPath,
        opts?: { trustPatches?: boolean; ignorePatchSuffixes?: readonly string[] },
      ): (() => void) => stateTreeSubscribe<Selected<T>>(selector, (v) => cb(v as Selected<T>), label, statePath, opts),
    },
    atoms: {
      findAtoms: (label) => findAtomsByLabel(label),
      labelOf: atomLabelOf,
      readSync: (atom) => {
        const store = getCachedStore();
        if (!store) throw new Error('jotai store not captured');
        return store.get(atom);
      },
      read: (atom) => readAtomValue(atom),
      subscribe: (atom, cb, tier, statePath) => subscribeAtom(atom, cb, tier, statePath),
      write: (atom, value) => writeAtomValue(atom, value),
      cacheSize: () => getAtomCacheSize(),
    },
    identity,
    now: () => Date.now(),
  };
}
