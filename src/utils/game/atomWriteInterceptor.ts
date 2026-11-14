import { isRecord } from '../typeGuards';

/** Returns the update the game's write receives; `readPrev` reads the atom's current value (null if it throws). */
export type WriteTransform = (update: unknown, readPrev: () => unknown) => unknown;
export type InterceptorState = 'absent' | 'installed' | 'displaced' | 'passthrough';

export interface AtomWriteInterceptor {
  install(atom: unknown, transform: WriteTransform): boolean;
  /** Another mod's uninstall can restore a stale `write`, silently dropping ours; re-wrap whatever is there now. */
  ensure(): boolean;
  uninstall(): void;
  state(): InterceptorState;
  isTarget(atom: unknown): boolean;
}

type WriteFn = (this: unknown, ...args: unknown[]) => unknown;
interface WritableAtom { write: WriteFn }
type Wrapper = WriteFn & { __qpmWrapped?: true; __qpmLabel?: string };

const isAtom = (a: unknown): a is WritableAtom => isRecord(a) && typeof a.write === 'function';

function readPrevOf(get: unknown, self: unknown): unknown {
  if (typeof get !== 'function') return null;
  try {
    return (get as (a: unknown) => unknown)(self);
  } catch { return null; }
}

export function createAtomWriteInterceptor(label: string): AtomWriteInterceptor {
  let target: WritableAtom | null = null;
  let original: WriteFn | null = null;
  let wrapper: Wrapper | null = null;
  let transform: WriteTransform | null = null;
  let passthrough = false;

  function makeWrapper(inner: WriteFn): Wrapper {
    // Classic function: jotai's default write reads `this`.
    const w: Wrapper = function (this: unknown, get: unknown, set: unknown, update: unknown, ...rest: unknown[]) {
      const next = passthrough || !transform ? update : transform(update, () => readPrevOf(get, this));
      return inner.call(this, get, set, next, ...rest);
    };
    w.__qpmWrapped = true;
    w.__qpmLabel = label;
    return w;
  }

  return {
    install(atom, fn) {
      if (!isAtom(atom)) return false;
      transform = fn;
      passthrough = false;
      if (target === atom && wrapper && atom.write === wrapper) return true;
      // The atom was swapped (e.g. a new room scope): hand the old atom its own write back.
      if (target && target !== atom && wrapper && original && target.write === wrapper) target.write = original;
      target = atom;
      original = atom.write;
      wrapper = makeWrapper(original);
      atom.write = wrapper;
      return true;
    },
    ensure() {
      if (!target || !transform || passthrough) return false;
      if (target.write === wrapper) return true;
      original = target.write;
      wrapper = makeWrapper(original);
      target.write = wrapper;
      return true;
    },
    uninstall() {
      if (target && wrapper && original) {
        if (target.write === wrapper) target.write = original;
        else passthrough = true;
      }
      if (!passthrough) { target = null; original = null; wrapper = null; }
      transform = null;
    },
    state() {
      if (!target || !wrapper) return 'absent';
      if (passthrough) return 'passthrough';
      return target.write === wrapper ? 'installed' : 'displaced';
    },
    isTarget: (atom) => target !== null && target === atom,
  };
}
