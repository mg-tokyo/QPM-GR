// Binds each key to the first available rung, re-walks every ladder on
// topology events, and hot-swaps live subscriptions.
import { createNamedLogger } from '../../diagnostics/logger';
import { createHandles } from './sources';
import type { SourceRuntime } from './runtime';
import { SubscriptionBook } from './subscriptions';
import { onTopologyChange, signalTopology } from './topology';
import type { KeyDefinition, KeyExplain, SourceExplain, SourceHandle, SourceKind, TopologyReason } from './types';

const log = createNamedLogger('gameState');
const DEFAULT_SUPPRESS_MS = 10_000;

export type DefsShape = Record<string, KeyDefinition<unknown>>;
export type ValueOf<Defs extends DefsShape, K extends keyof Defs> =
  Defs[K] extends KeyDefinition<infer T> ? T : never;

export interface RegistryOptions {
  onRebind?: (key: string, from: string | null, to: string | null) => void;
  suppressMs?: number;
}

interface KeyState<T> {
  readonly key: string;
  readonly def: KeyDefinition<T>;
  readonly handles: SourceHandle<T>[];
  readonly book: SubscriptionBook<T>;
  boundIndex: number | null;
  boundAt: number | null;
  rebinds: number;
  readonly suppressedUntil: Map<number, number>;
  readonly simulatedLoss: Set<SourceKind>;
}

export class Registry<Defs extends DefsShape> {
  private readonly states = new Map<string, KeyState<unknown>>();
  private topologyOff: (() => void) | null = null;
  private started = false;
  private lastReasons: readonly TopologyReason[] = [];

  constructor(
    private readonly defs: Defs,
    private readonly runtime: SourceRuntime,
    private readonly opts: RegistryOptions = {},
  ) {
    for (const key of Object.keys(defs)) {
      const def = defs[key]!;
      const book = new SubscriptionBook<unknown>(
        def.defaultValue,
        () => runtime.now(),
        (err) => log.warn('QPM-ATOM-002', { key, phase: 'deliver' }, err),
        (reason) => {
          const s = this.states.get(key);
          if (s && s.boundIndex !== null) this.suppress(s, s.boundIndex, reason);
        },
      );
      this.states.set(key, {
        key,
        def,
        handles: createHandles(key, def, runtime),
        book,
        boundIndex: null,
        boundAt: null,
        rebinds: 0,
        suppressedUntil: new Map(),
        simulatedLoss: new Set(),
      });
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.topologyOff = onTopologyChange((reasons) => this.bindAll([...reasons]));
    this.bindAll(['init']);
  }

  stop(): void {
    this.topologyOff?.();
    this.topologyOff = null;
    for (const s of this.states.values()) {
      s.book.rebind(null);
      s.boundIndex = null;
      s.boundAt = null;
    }
    this.started = false;
  }

  keys(): Array<keyof Defs & string> {
    return Object.keys(this.defs) as Array<keyof Defs & string>;
  }

  auditNormalizerFor(key: keyof Defs & string): ((value: unknown) => unknown) | undefined {
    return this.defs[key]?.auditNormalize as ((value: unknown) => unknown) | undefined;
  }

  // Private helpers are generic in T because `KeyState<T>` is invariant in T
  // (contains contravariant subscriber callbacks). A concrete `KeyState<X>`
  // is neither assignable to nor from `KeyState<unknown>`, so we let TS bind
  // T at the call site instead of casting.
  private isUsable<T>(s: KeyState<T>, h: SourceHandle<T>): boolean {
    if (s.simulatedLoss.has(h.kind)) return false;
    const until = s.suppressedUntil.get(h.index);
    if (until !== undefined) {
      if (until > this.runtime.now()) return false;
      s.suppressedUntil.delete(h.index);
    }
    return h.available();
  }

  private firstUsable<T>(s: KeyState<T>): SourceHandle<T> | null {
    for (const h of s.handles) if (this.isUsable(s, h)) return h;
    return null;
  }

  bindAll(reasons: readonly TopologyReason[] = []): void {
    this.lastReasons = reasons;
    for (const s of this.states.values()) for (const h of s.handles) h.invalidate?.();
    for (const s of this.states.values()) this.bind(s);
  }

  private bind<T>(s: KeyState<T>): void {
    const next = this.firstUsable(s);
    const nextIndex = next ? next.index : null;
    if (nextIndex === s.boundIndex) return;
    const from = s.boundIndex === null ? null : s.handles[s.boundIndex]!.describe();
    const to = next ? next.describe() : null;
    s.boundIndex = nextIndex;
    s.boundAt = this.runtime.now();
    s.rebinds++;
    s.book.rebind(next);
    this.opts.onRebind?.(s.key, from, to);
  }

  private suppress<T>(s: KeyState<T>, index: number, why: string, err?: unknown): void {
    s.suppressedUntil.set(index, this.runtime.now() + (this.opts.suppressMs ?? DEFAULT_SUPPRESS_MS));
    log.warn('QPM-ATOM-002', { key: s.key, rung: s.handles[index]?.describe(), why }, err);
    signalTopology('source:failure');
  }

  private state<K extends keyof Defs & string>(key: K): KeyState<ValueOf<Defs, K>> {
    const s = this.states.get(key);
    if (!s) throw new Error(`gameState: unknown key '${key}'`);
    return s as KeyState<ValueOf<Defs, K>>;
  }

  /** Bound rung first, then the rest of the ladder for this call only. */
  readSync<K extends keyof Defs & string>(key: K): ValueOf<Defs, K> | null {
    const s = this.state(key);
    const order = s.boundIndex === null ? s.handles : [s.handles[s.boundIndex]!, ...s.handles.filter((h) => h.index !== s.boundIndex)];
    for (const h of order) {
      if (!this.isUsable(s, h) && h.index !== s.boundIndex) continue;
      const r = h.readSync();
      if (r.ok) return r.value === null && s.def.defaultValue !== undefined ? s.def.defaultValue : r.value;
      if (h.index === s.boundIndex) this.suppress(s, h.index, r.reason);
    }
    return s.def.defaultValue ?? null;
  }

  async read<K extends keyof Defs & string>(key: K): Promise<ValueOf<Defs, K> | null> {
    const s = this.state(key);
    const order = s.boundIndex === null ? s.handles : [s.handles[s.boundIndex]!, ...s.handles.filter((h) => h.index !== s.boundIndex)];
    for (const h of order) {
      if (!this.isUsable(s, h) && h.index !== s.boundIndex) continue;
      const r = await h.read();
      if (r.ok) return r.value === null && s.def.defaultValue !== undefined ? s.def.defaultValue : r.value;
      if (h.index === s.boundIndex) this.suppress(s, h.index, r.reason);
    }
    return s.def.defaultValue ?? null;
  }

  subscribe<K extends keyof Defs & string>(key: K, cb: (value: ValueOf<Defs, K> | null) => void, origin: string | null = null): () => void {
    const s = this.state(key);
    if (s.boundIndex === null) this.bind(s);
    return s.book.add(cb, origin);
  }

  /** Consumer wall time per key, costliest first — pairs with the Perf line's `top <key>` note. */
  consumerCosts(): Array<{ key: string; ms: number; consumers: Array<{ origin: string | null; ms: number; calls: number }> }> {
    const out: Array<{ key: string; ms: number; consumers: Array<{ origin: string | null; ms: number; calls: number }> }> = [];
    for (const [key, s] of this.states) {
      const consumers = s.book.consumerCosts().sort((a, b) => b.ms - a.ms);
      if (consumers.length === 0) continue;
      out.push({ key, ms: consumers.reduce((acc, c) => acc + c.ms, 0), consumers });
    }
    return out.sort((a, b) => b.ms - a.ms);
  }

  async write<K extends keyof Defs & string>(key: K, value: ValueOf<Defs, K>): Promise<void> {
    const s = this.state(key);
    const writable = s.handles.find((h) => typeof h.write === 'function' && this.isUsable(s, h));
    if (!writable?.write) throw new Error(`gameState: '${key}' is not writable (no available writable atom rung)`);
    await writable.write(value);
  }

  /** Resolved atom object of the bound atom rung (or the first atom rung), for read-patch instrumentation. */
  atomObjectFor<K extends keyof Defs & string>(key: K): unknown {
    const s = this.state(key);
    const bound = s.boundIndex === null ? undefined : s.handles[s.boundIndex];
    const h = bound && bound.kind === 'atom' ? bound : s.handles.find((x) => x.kind === 'atom');
    return h?.atomObject ? h.atomObject() ?? null : null;
  }

  handlesFor<K extends keyof Defs & string>(key: K): readonly SourceHandle<unknown>[] {
    return this.state(key).handles as readonly SourceHandle<unknown>[];
  }

  /** Test/diagnostic hook: treat every rung of `kind` on `key` as unavailable. */
  setSimulatedLoss(key: keyof Defs & string, kind: SourceKind, lost: boolean): void {
    const s = this.state(key);
    if (lost) s.simulatedLoss.add(kind); else s.simulatedLoss.delete(kind);
    signalTopology('debug:simulate');
  }

  explain<K extends keyof Defs & string>(key: K): KeyExplain {
    const s = this.state(key);
    const sources: SourceExplain[] = s.handles.map((h) => ({
      kind: h.kind,
      index: h.index,
      description: h.describe(),
      available: this.isUsable(s, h),
      bound: h.index === s.boundIndex,
      suppressedUntil: s.suppressedUntil.get(h.index) ?? null,
    }));
    const bound = s.boundIndex === null ? null : s.handles[s.boundIndex]!;
    return {
      key: s.key,
      policy: s.def.policy,
      doc: s.def.doc,
      boundVia: bound ? bound.kind : null,
      boundIndex: s.boundIndex,
      boundDescription: bound ? bound.describe() : null,
      boundAt: s.boundAt,
      preferred: s.boundIndex === 0,
      rebinds: s.rebinds,
      subscribers: s.book.size,
      lastDeliveryAt: s.book.lastDeliveryAt,
      sources,
    };
  }

  explainAll(): KeyExplain[] {
    return this.keys().map((k) => this.explain(k));
  }

  stats(): { keys: number; bound: number; preferred: number; unbound: string[]; fallback: string[]; lastReasons: readonly TopologyReason[] } {
    const unbound: string[] = [];
    const fallback: string[] = [];
    let preferred = 0;
    for (const s of this.states.values()) {
      if (s.boundIndex === null) unbound.push(s.key);
      else if (s.boundIndex === 0) preferred++;
      else fallback.push(s.key);
    }
    return { keys: this.states.size, bound: this.states.size - unbound.length, preferred, unbound, fallback, lastReasons: this.lastReasons };
  }
}
