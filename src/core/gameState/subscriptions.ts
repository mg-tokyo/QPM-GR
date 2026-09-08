// Per-key consumer book. ONE upstream subscription per bound handle fans out
// to every consumer; the upstream attaches lazily on the first consumer and
// detaches when the last one leaves, so keys with zero consumers cost nothing
// (before R1 every registered key held a live upstream after bindAll).
import { deepEqual } from '../../utils/deepEqual';
import type { SourceHandle } from './types';

interface Entry<T> { readonly cb: (value: T | null) => void; readonly origin: string | null; ms: number; calls: number }

export interface ConsumerCost { origin: string | null; ms: number; calls: number }

export class SubscriptionBook<T> {
  private readonly entries = new Set<Entry<T>>();
  private bound: SourceHandle<T> | null = null;
  private detachUpstream: (() => void) | null = null;
  private token = 0;
  private hasValue = false;
  private lastValue: T | null = null;
  lastDeliveryAt: number | null = null;

  constructor(
    private readonly defaultValue: T | undefined,
    private readonly now: () => number,
    private readonly onError: (err: unknown) => void,
    private readonly onAttachFailure: (reason: string) => void,
  ) {}

  get size(): number { return this.entries.size; }

  add(cb: (value: T | null) => void, origin: string | null = null): () => void {
    const entry: Entry<T> = { cb, origin, ms: 0, calls: 0 };
    this.entries.add(entry);
    // First consumer attaches the upstream; later ones replay the last value.
    if (this.bound && this.detachUpstream === null) this.attach(this.bound);
    else if (this.hasValue) this.callOne(entry, this.lastValue);
    return () => {
      this.entries.delete(entry);
      if (this.entries.size === 0) {
        this.dropUpstream();
        this.hasValue = false;
        this.lastValue = null;
      }
    };
  }

  /** Called by the resolver on every (re)bind; `null` detaches the upstream. */
  rebind(handle: SourceHandle<T> | null): void {
    this.dropUpstream();
    this.bound = handle;
    if (handle) {
      if (this.entries.size > 0) this.attach(handle);
      return;
    }
    // No rung left: a late consumer must not replay a value nobody can refresh.
    this.hasValue = false;
    this.lastValue = null;
  }

  private attach(handle: SourceHandle<T>): void {
    const token = ++this.token;
    const memoized = handle.memoized === true;
    try {
      this.detachUpstream = handle.subscribe(
        (value) => { if (token === this.token) this.onUpstream(value, memoized); },
        (reason) => { if (token === this.token) this.onAttachFailure(reason); },
      );
    } catch (err) {
      this.detachUpstream = null;
      this.onAttachFailure(err instanceof Error ? err.message : String(err));
    }
  }

  private dropUpstream(): void {
    this.token += 1;
    try { this.detachUpstream?.(); } catch { /* ignore */ }
    this.detachUpstream = null;
  }

  private onUpstream(raw: T | null, memoized: boolean): void {
    const value = raw === null && this.defaultValue !== undefined ? this.defaultValue : raw;
    if (this.hasValue && (memoized ? Object.is(value, this.lastValue) : deepEqual(value, this.lastValue))) return;
    this.hasValue = true;
    this.lastValue = value;
    this.lastDeliveryAt = this.now();
    for (const e of this.entries) this.callOne(e, value);
  }

  /** Per-consumer wall time since boot — the "who is expensive under this key" view. */
  consumerCosts(): ConsumerCost[] {
    return Array.from(this.entries, (e) => ({ origin: e.origin, ms: e.ms, calls: e.calls }));
  }

  private callOne(entry: Entry<T>, value: T | null): void {
    const t0 = performance.now();
    try { entry.cb(value); } catch (err) { this.onError(err); }
    entry.ms += performance.now() - t0;
    entry.calls += 1;
  }
}
