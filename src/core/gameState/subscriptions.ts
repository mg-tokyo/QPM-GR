// Per-key consumer book. Consumer handles never change; the book re-attaches
// them when the resolver rebinds and only delivers deep-not-equal values so a
// swap is invisible upstream.
import { deepEqual } from '../../utils/deepEqual';
import type { SourceHandle } from './types';

interface Entry<T> {
  readonly cb: (value: T | null) => void;
  detach: (() => void) | null;
  attachToken: number;
  hasDelivered: boolean;
  lastDelivered: T | null;
}

export class SubscriptionBook<T> {
  private readonly entries = new Set<Entry<T>>();
  private bound: SourceHandle<T> | null = null;
  private tokens = 0;
  lastDeliveryAt: number | null = null;

  constructor(
    private readonly defaultValue: T | undefined,
    private readonly now: () => number,
    private readonly onError: (err: unknown) => void,
    private readonly onAttachFailure: (reason: string) => void,
  ) {}

  get size(): number { return this.entries.size; }

  add(cb: (value: T | null) => void): () => void {
    const entry: Entry<T> = { cb, detach: null, attachToken: 0, hasDelivered: false, lastDelivered: null };
    this.entries.add(entry);
    if (this.bound) this.attach(entry, this.bound);
    return () => {
      this.entries.delete(entry);
      this.detach(entry);
    };
  }

  /** Called by the resolver on every (re)bind; `null` detaches everyone. */
  rebind(handle: SourceHandle<T> | null): void {
    this.bound = handle;
    for (const e of this.entries) {
      this.detach(e);
      if (handle) this.attach(e, handle);
    }
  }

  private attach(entry: Entry<T>, handle: SourceHandle<T>): void {
    const token = ++this.tokens;
    entry.attachToken = token;
    try {
      entry.detach = handle.subscribe(
        (value) => {
          if (entry.attachToken !== token) return;
          this.deliver(entry, value);
        },
        (reason) => {
          if (entry.attachToken !== token) return;
          this.onAttachFailure(reason);
        },
      );
    } catch (err) {
      entry.detach = null;
      this.onAttachFailure(err instanceof Error ? err.message : String(err));
    }
  }

  private detach(entry: Entry<T>): void {
    entry.attachToken = ++this.tokens;
    try { entry.detach?.(); } catch { /* ignore */ }
    entry.detach = null;
  }

  private deliver(entry: Entry<T>, raw: T | null): void {
    const value = raw === null && this.defaultValue !== undefined ? this.defaultValue : raw;
    if (entry.hasDelivered && deepEqual(value, entry.lastDelivered)) return;
    entry.hasDelivered = true;
    entry.lastDelivered = value;
    this.lastDeliveryAt = this.now();
    try { entry.cb(value); } catch (err) { this.onError(err); }
  }
}
