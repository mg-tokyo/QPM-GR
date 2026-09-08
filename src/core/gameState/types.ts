// Contracts for the source-ladder registry.
// Spec: docs/superpowers/specs/2026-09-05-game-state-source-ladder-design.md §4-5.
import type { PatchPath, SubscriberTier } from '../reactive/types';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';

export type Policy = 'authoritative' | 'predicted' | 'client';
export type SourceKind = 'stateTree' | 'atom' | 'custom';
export type AtomSemantics = 'authoritative' | 'predicted' | 'client';

export interface IdentityContext {
  readonly playerId: string | null;
  readonly myIdx: number | null;
}

/** `undefined` = source cannot answer (unavailable); `null` = value is null. */
export type Selected<T> = T | null | undefined;

export interface StateTreeSourceSpec<T> {
  readonly kind: 'stateTree';
  /** RFC 6901 prefix for patch gating; `{myIdx}` substituted at flush time. */
  readonly statePath: PatchPath;
  readonly select: (state: QuinoaStateSnapshot, identity: IdentityContext) => Selected<T>;
  /** When set, a patch under `statePath` counts as a real change; the book
   *  skips the deep walk (the tree is freshly cloned per batch by the game).
   *  Only valid for selectors that return a subtree unchanged. */
  readonly trustPatches?: boolean;
}

export interface AtomSourceSpec<T> {
  readonly kind: 'atom';
  readonly label: RegExp;
  readonly semantics: AtomSemantics;
  /** Structural validator; when set, a label match with the wrong shape is rejected. */
  readonly structure?: (value: unknown) => boolean;
  /** Disambiguator when `label` matches several atoms. */
  readonly prefer?: (label: string) => boolean;
  /** Shape adapter so this rung yields the same T as the state-tree rung. */
  readonly project?: (raw: unknown) => Selected<T>;
  readonly writable?: boolean;
}

export interface CustomSourceSpec<T> {
  readonly kind: 'custom';
  readonly id: string;
  readonly available: () => boolean;
  readonly read: () => Selected<T>;
  readonly subscribe?: (cb: () => void) => () => void;
}

export type SourceSpec<T> = StateTreeSourceSpec<T> | AtomSourceSpec<T> | CustomSourceSpec<T>;

export interface KeyDefinition<T> {
  /** Ordered candidates; the resolver binds the first available. */
  readonly sources: readonly SourceSpec<T>[];
  readonly policy: Policy;
  /** Reactive tier for atom subscriptions (see reactive/types.ts). */
  readonly tier?: SubscriberTier;
  /** Substituted for null deliveries. Absent means null. */
  readonly defaultValue?: T;
  /**
   * Applied to BOTH rung values before the divergence audit's deepEqual.
   * For keys whose atom rung is lossy-stabilized by the game (fields allowed
   * to lag the authoritative value even with an idle prediction queue).
   * Method syntax: bivariant params keep KeyDefinition<T> assignable to
   * KeyDefinition<unknown> (DefsShape) under strictFunctionTypes.
   */
  auditNormalize?(value: T | null): unknown;
  readonly doc: string;
}

export type SourceRead<T> =
  | { readonly ok: true; readonly value: T | null }
  | { readonly ok: false; readonly reason: string };

export interface SourceHandle<T> {
  readonly kind: SourceKind;
  readonly index: number;
  /** True when the source already delivers deep-memoised values (state tree);
   * the book then compares by identity instead of walking the value again. */
  readonly memoized?: boolean;
  describe(): string;
  available(): boolean;
  readSync(): SourceRead<T>;
  read(): Promise<SourceRead<T>>;
  /**
   * Synchronous return; attachment may complete asynchronously. `onFailure`
   * fires once if the attachment cannot be made (store capture failed etc.)
   * so the resolver can suppress this rung and rebind.
   */
  subscribe(cb: (value: T | null) => void, onFailure?: (reason: string) => void): () => void;
  write?(value: T): Promise<void>;
  /** Atom rungs only: the resolved jotai atom object (for read-patch instrumentation). */
  atomObject?(): unknown;
  /** Drop any topology-dependent cache. Called by the resolver on every
   * topology change; the atom rung uses this to invalidate its resolved-atom
   * cache so a late-registered atom is picked up on the next read. */
  invalidate?(): void;
}

export type TopologyReason =
  | 'init'
  | 'stateTree:ready'
  | 'stateTree:welcome'
  | 'jotai:capture'
  | 'atoms:cacheGrowth'
  | 'identity:changed'
  | 'source:failure'
  | 'debug:simulate';

export interface SourceExplain {
  readonly kind: SourceKind;
  readonly index: number;
  readonly description: string;
  readonly available: boolean;
  readonly bound: boolean;
  readonly suppressedUntil: number | null;
}

export interface KeyExplain {
  readonly key: string;
  readonly policy: Policy;
  readonly doc: string;
  readonly boundVia: SourceKind | null;
  readonly boundIndex: number | null;
  readonly boundDescription: string | null;
  readonly boundAt: number | null;
  /** True when the bound rung is the ladder's first rung. */
  readonly preferred: boolean;
  readonly rebinds: number;
  readonly subscribers: number;
  readonly lastDeliveryAt: number | null;
  readonly sources: readonly SourceExplain[];
}
