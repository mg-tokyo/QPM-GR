export type JotaiStore = {
  get(atom: unknown): any;
  set(atom: unknown, value: unknown): void | Promise<void>;
  /**
   * Subscribe. The optional third `hint` marks which reactive tier this
   * subscription belongs to (see src/core/reactive/types.ts). Real jotai
   * stores (Aries) ignore it; the QPM polyfill uses it to route through
   * the ReactiveSubscriptionManager instead of the polling fallback.
   * `statePath` is the JSON Pointer prefix used by the reactive manager to
   * gate patch-driven dirty marks. Only meaningful when `hint` is 'state' or
   * 'composite' and reactive routing is engaged.
   */
  sub(
    atom: unknown,
    cb: () => void,
    hint?: import('../reactive/types').SubscriberTier,
    statePath?: import('../reactive/types').PatchPath,
  ): () => void | Promise<() => void>;
  __polyfill?: boolean;
  __source?: string;
};

export interface ReactiveHook {
  readonly isTierEnabled: (t: import('../reactive/types').SubscriberTier) => boolean;
  readonly subscribe: (atom: unknown, opts: import('../reactive/types').ReactiveSubscribeOptions) => () => void;
}

export type CaptureMode = 'aries' | 'shared' | 'fiber' | 'write' | 'cache-read' | 'none';

export type AtomCacheLike = {
  get: (key: unknown) => unknown;
  values: () => IterableIterator<any>;
  entries?: () => IterableIterator<[any, any]>;
  size?: number;
};
