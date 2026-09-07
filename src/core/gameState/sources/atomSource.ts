// Resolves the atom on every availability check (no session cache) so an atom
// the game removes or registers late flips this rung without a reload.
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

  const resolveAtom = (): unknown => {
    const matches = runtime.atoms.findAtoms(spec.label);
    if (matches.length === 0) return undefined;
    let atom = matches[0];
    if (matches.length > 1 && spec.prefer) {
      const preferred = matches.find((a) => spec.prefer!(runtime.atoms.labelOf(a)));
      if (preferred !== undefined) atom = preferred;
    }
    lastLabel = runtime.atoms.labelOf(atom);
    return atom;
  };

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
      return { ok: false, reason: `read threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  const handle: SourceHandle<T> = {
    kind: 'atom',
    index,
    describe: () => `atom:${lastLabel || spec.label.source}`,
    available: () => readSync().ok,
    readSync,
    read: async () => {
      const atom = resolveAtom();
      if (atom === undefined) return { ok: false, reason: `no atom matches ${spec.label.source}` };
      try {
        return project(await runtime.atoms.read(atom));
      } catch (err) {
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
