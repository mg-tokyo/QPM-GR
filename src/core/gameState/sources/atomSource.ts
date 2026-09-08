// Resolves the atom lazily and caches the result for the current topology
// epoch. The resolver invalidates every handle in bindAll (cache growth,
// capture, welcome, source failure), which restores the pre-3.3.41 per-read
// cost. A cached MISS is additionally tied to the atom-cache size: the growth
// signal is a 30 s poll, and a lazily loaded atom must be readable before it.
import type { SubscriberTier } from '../../reactive/types';
import type { SourceRuntime } from '../runtime';
import type { AtomSourceSpec, SourceHandle, SourceRead } from '../types';

export function createAtomHandle<T>(
  key: string,
  spec: AtomSourceSpec<T>,
  index: number,
  runtime: SourceRuntime,
  tier: SubscriberTier | undefined,
): SourceHandle<T> {
  let lastLabel = '';
  let cached: unknown = undefined;
  let cacheValid = false;
  let missAtSize = -1;

  const resolveAtom = (): unknown => {
    if (cacheValid && (cached !== undefined || runtime.atoms.cacheSize() === missAtSize)) return cached;
    const matches = runtime.atoms.findAtoms(spec.label);
    let atom: unknown = undefined;
    if (matches.length > 0) {
      atom = matches[0];
      if (matches.length > 1 && spec.prefer) {
        const preferred = matches.find((a) => spec.prefer!(runtime.atoms.labelOf(a)));
        if (preferred !== undefined) atom = preferred;
      }
      lastLabel = runtime.atoms.labelOf(atom);
    }
    cached = atom;
    cacheValid = true;
    missAtSize = atom === undefined ? runtime.atoms.cacheSize() : -1;
    return atom;
  };
  const invalidate = (): void => { cacheValid = false; cached = undefined; missAtSize = -1; };

  const project = (raw: unknown): SourceRead<T> => {
    if (spec.structure && !spec.structure(raw)) return { ok: false, reason: `structure mismatch on ${lastLabel}` };
    const v = spec.project ? spec.project(raw) : (raw as T | null);
    return v === undefined ? { ok: false, reason: `projection unavailable on ${lastLabel}` } : { ok: true, value: v };
  };

  const readSync = (): SourceRead<T> => {
    const atom = resolveAtom();
    if (atom === undefined) return { ok: false, reason: `no atom matches ${spec.label.source}` };
    try {
      return project(runtime.atoms.readSync(atom));
    } catch (err) {
      invalidate();
      return { ok: false, reason: `read threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  const handle: SourceHandle<T> = {
    kind: 'atom',
    index,
    describe: () => `atom:${lastLabel || spec.label.source}`,
    available: () => readSync().ok,
    invalidate,
    readSync,
    read: async () => {
      const atom = resolveAtom();
      if (atom === undefined) return { ok: false, reason: `no atom matches ${spec.label.source}` };
      try {
        return project(await runtime.atoms.read(atom));
      } catch (err) {
        invalidate();
        return { ok: false, reason: `read threw: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    subscribe: (cb, onFailure) => {
      let disposed = false;
      let detach: (() => void) | null = null;
      const atom = resolveAtom();
      if (atom === undefined) {
        onFailure?.(`no atom matches ${spec.label.source}`);
      } else {
        void runtime.atoms.subscribe(atom, (raw) => {
          if (disposed) return;
          const r = project(raw);
          if (r.ok) cb(r.value);
        }, tier, undefined).then((off) => {
          if (disposed) { try { off(); } catch { /* ignore */ } return; }
          detach = off;
        }).catch((err: unknown) => {
          if (!disposed) onFailure?.(`subscribe threw: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      return () => {
        disposed = true;
        try { detach?.(); } catch { /* ignore */ }
        detach = null;
      };
    },
  };
  handle.atomObject = () => resolveAtom();
  if (spec.writable) {
    handle.write = async (value: T) => {
      const atom = resolveAtom();
      if (atom === undefined) throw new Error(`gameState: cannot write '${key}' — atom ${spec.label.source} not found`);
      await runtime.atoms.write(atom, value);
    };
  }
  return handle;
}
