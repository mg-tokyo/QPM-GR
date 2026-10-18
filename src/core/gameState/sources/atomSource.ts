// Resolves the atom lazily and caches the result for the current topology
// epoch. The resolver invalidates every handle in bindAll (cache growth,
// capture, welcome, source failure), which restores the pre-3.3.41 per-read
// cost. A cached MISS is additionally tied to the atom-cache size: the growth
// signal is a 30 s poll, and a lazily loaded atom must be readable before it.
import type { SubscriberTier } from '../../reactive/types';
import type { SourceRuntime } from '../runtime';
import type { AtomSourceSpec, SourceHandle, SourceRead } from '../types';

const asAtom = (v: unknown): unknown =>
  (v !== null && typeof v === 'object' && typeof (v as { read?: unknown }).read === 'function' ? v : undefined);

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

  // The scope can be swapped at any time, so the inner atom is never cached.
  const innerOf = (scope: unknown): unknown =>
    (scope !== null && typeof scope === 'object' ? asAtom((scope as Record<string, unknown>)[spec.via!]) : undefined);
  const resolveTarget = (): unknown => {
    const atom = resolveAtom();
    if (atom === undefined || !spec.via) return atom;
    return innerOf(runtime.atoms.readSync(atom));
  };
  const missReason = (): string => (resolveAtom() === undefined
    ? `no atom matches ${spec.label.source}`
    : `${lastLabel} has no atom at .${spec.via ?? ''}`);
  const name = (): string => `${lastLabel || spec.label.source}${spec.via ? `.${spec.via}` : ''}`;

  const project = (raw: unknown): SourceRead<T> => {
    if (spec.structure && !spec.structure(raw)) return { ok: false, reason: `structure mismatch on ${name()}` };
    const v = spec.project ? spec.project(raw) : (raw as T | null);
    return v === undefined ? { ok: false, reason: `projection unavailable on ${name()}` } : { ok: true, value: v };
  };

  const readSync = (): SourceRead<T> => {
    if (spec.requiresSeat && runtime.identity().myIdx === null) return { ok: false, reason: 'no seat' };
    try {
      const atom = resolveTarget();
      if (atom === undefined) return { ok: false, reason: missReason() };
      return project(runtime.atoms.readSync(atom));
    } catch (err) {
      invalidate();
      return { ok: false, reason: `read threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  const subscribeRaw = (atom: unknown, onRaw: (raw: unknown) => void, onFailure?: (reason: string) => void): (() => void) => {
    let disposed = false;
    let detach: (() => void) | null = null;
    void runtime.atoms.subscribe(atom, (raw) => { if (!disposed) onRaw(raw); }, tier, undefined).then((off) => {
      if (disposed) { try { off(); } catch { /* ignore */ } return; }
      detach = off;
    }).catch((err: unknown) => {
      if (!disposed) onFailure?.(`subscribe threw: ${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      disposed = true;
      try { detach?.(); } catch { /* ignore */ }
      detach = null;
    };
  };

  const handle: SourceHandle<T> = {
    kind: 'atom',
    index,
    describe: () => `atom:${name()}`,
    available: () => readSync().ok,
    invalidate,
    readSync,
    read: async () => {
      if (spec.requiresSeat && runtime.identity().myIdx === null) return { ok: false, reason: 'no seat' };
      try {
        const atom = resolveTarget();
        if (atom === undefined) return { ok: false, reason: missReason() };
        return project(await runtime.atoms.read(atom));
      } catch (err) {
        invalidate();
        return { ok: false, reason: `read threw: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    subscribe: (cb, onFailure) => {
      const atom = resolveAtom();
      if (atom === undefined) {
        onFailure?.(`no atom matches ${spec.label.source}`);
        return () => {};
      }
      const deliver = (raw: unknown): void => {
        if (spec.requiresSeat && runtime.identity().myIdx === null) return;
        const r = project(raw);
        if (r.ok) cb(r.value);
      };
      if (!spec.via) return subscribeRaw(atom, deliver, onFailure);
      let inner: unknown = undefined;
      let offInner: (() => void) | null = null;
      const offScope = subscribeRaw(atom, (scope) => {
        const next = innerOf(scope);
        if (next === inner) return;
        offInner?.();
        offInner = null;
        inner = next;
        if (next !== undefined) offInner = subscribeRaw(next, deliver, onFailure);
      }, onFailure);
      return () => {
        offScope();
        offInner?.();
        offInner = null;
      };
    },
  };
  handle.atomObject = () => {
    try { return resolveTarget(); } catch { return undefined; }
  };
  if (spec.writable) {
    handle.write = async (value: T) => {
      const atom = resolveTarget();
      if (atom === undefined) throw new Error(`gameState: cannot write '${key}' — ${missReason()}`);
      await runtime.atoms.write(atom, value);
    };
    handle.writeSync = (value: T) => {
      try {
        const atom = resolveTarget();
        return atom === undefined ? false : runtime.atoms.writeSync(atom, value);
      } catch { return false; }
    };
  }
  return handle;
}
