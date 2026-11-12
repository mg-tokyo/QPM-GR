export interface PlayerScopedSpec<T> {
  /** Unscoped key; the scoped copy lives at `<baseKey>.<playerId>`. */
  readonly baseKey: string;
  readonly fallback: T;
  /**
   * Combine two copies of the same account's history. Must be idempotent, and must return
   * `a` itself (same reference) when `b` adds nothing, so an unchanged load is not rewritten.
   */
  merge(a: T, b: T): T;
  /** The bound value for `playerId`; the store replaces its in-memory state with it. */
  onReady(value: T, playerId: string): void;
  /** Called on an id change while the old key is still bound, so pending writes land there. */
  flush?(): void;
}

/** One value stored across several keys. Without a layout the value is stored whole at `baseKey`. */
export interface PlayerScopedLayout<T> {
  /** Unscoped key of each stored part; `parts[0]` is the spec's `baseKey`. Each is scoped as `<part>.<playerId>`. */
  readonly parts: readonly string[];
  /** Stored parts in `parts` order (`undefined` = missing) → one value, or `undefined` when they hold no copy. */
  join(raw: readonly unknown[]): T | undefined;
  /** One value → its parts. On a store write a part may be `PLAYER_SCOPED_UNCHANGED` to skip its key; a bind writes every part. */
  split(value: T, reason: 'bind' | 'write'): readonly unknown[];
}

export interface PlayerScopedHandle<T> {
  start(): void;
  stop(): void;
  /** Before the first id: held in memory (last wins) and merged in on bind. False when a part failed to save. */
  write(value: T): boolean;
  /** The bound value, the last write, or the spec fallback before any. */
  read(): T;
  isReady(): boolean;
  scopedKey(): string | null;
}

export interface PlayerScopedDeps {
  storageGet<V>(key: string, fallback: V): V;
  storageSet(key: string, value: unknown): void;
  readDurable<V>(key: string, fallback: V): Promise<V>;
  registerDynamicKey(key: string): void;
  currentPlayerId(): string | null;
  onIdentityChange(cb: (playerId: string | null) => void): () => void;
  /** Per-origin id: magicgarden.gg and the Discord activity each keep their own mirror. */
  siteId(): string;
  onError(phase: 'bind' | 'persist', baseKey: string, cause: unknown): void;
}

/** Which player took each unscoped copy, per site (the origin's own copy) and shared (GM). */
export interface ClaimMarker {
  sites: Record<string, Record<string, string>>;
  shared: Record<string, string>;
}
