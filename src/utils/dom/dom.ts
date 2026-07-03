// src/utils/dom.ts
export type Predicate = (el: Element) => boolean;
export type SelectorOrPredicate = string | Predicate;

export interface DisconnectHandle {
  disconnect(): void;
}

export interface OffHandle {
  off(): void;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const ready: Promise<void> = new Promise(res => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => res(), { once: true });
  } else {
    res();
  }
});

export const $ = <T extends Element = Element>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);

export const $$ = <T extends Element = Element>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

export function addStyle(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

// ── Shared coalesced DOM observer ──────────────────────────────────────────
// One MutationObserver on document.body; every helper that watches for
// added/removed descendants routes through it. Coalesces mutation records
// into a single microtask flush. Session-lifetime singleton — never
// disconnected. Reduces "N observers on the same root" pressure that
// compounds badly when a second userscript (e.g. Aries Mod) also observes
// document root with subtree:true.

type SharedPredicate = (records: readonly MutationRecord[]) => void;

const _addedListeners: Set<SharedPredicate> = new Set();
const _removedListeners: Set<SharedPredicate> = new Set();

let _sharedObserver: MutationObserver | null = null;
let _queued: MutationRecord[] = [];
let _flushScheduled = false;

// Stats for diagnostics
let _mutationCount = 0;
let _flushCount = 0;
let _lastFlushMs = 0;
let _lastStatsSample = typeof performance !== 'undefined' ? performance.now() : 0;
let _mutationRateEwma = 0;
let _flushRateEwma = 0;

function _safeCall(cb: SharedPredicate, batch: readonly MutationRecord[]): void {
  try { cb(batch); } catch { /* isolate one predicate's failure from the rest */ }
}

function _flush(): void {
  const batch = _queued;
  _queued = [];
  _flushScheduled = false;
  if (batch.length === 0) return;
  const t0 = performance.now();
  _flushCount++;
  if (_addedListeners.size)   for (const cb of _addedListeners)   _safeCall(cb, batch);
  if (_removedListeners.size) for (const cb of _removedListeners) _safeCall(cb, batch);
  _lastFlushMs = performance.now() - t0;
}

function _ensureSharedObserver(): void {
  if (_sharedObserver) return;
  if (typeof document === 'undefined' || !document.body) return; // caller must retry
  _sharedObserver = new MutationObserver((records) => {
    _mutationCount += records.length;
    for (const r of records) _queued.push(r);
    if (!_flushScheduled) {
      _flushScheduled = true;
      queueMicrotask(_flush);
    }
  });
  _sharedObserver.observe(document.body, { childList: true, subtree: true, attributes: false });
}

function _registerAdded(cb: SharedPredicate): () => void {
  _ensureSharedObserver();
  _addedListeners.add(cb);
  return () => { _addedListeners.delete(cb); };
}

function _registerRemoved(cb: SharedPredicate): () => void {
  _ensureSharedObserver();
  _removedListeners.add(cb);
  return () => { _removedListeners.delete(cb); };
}

/**
 * Fires `cb` exactly once when `el.isConnected` transitions to false after
 * this call. Backed by the shared coalesced observer — cheap to register.
 * Self-unregisters after firing; also unregisters if `disconnect()` is called
 * before the element detaches.
 */
export function watchDetach(el: Element, cb: () => void): DisconnectHandle {
  let fired = false;
  const unregister = _registerRemoved(() => {
    if (fired) return;
    if (el.isConnected) return;
    fired = true;
    try { cb(); } finally { unregister(); }
  });
  return {
    disconnect: (): void => {
      if (fired) return;
      fired = true;
      unregister();
    },
  };
}

/** Diagnostics probe used by the domObserver subsystem. */
export function getSharedDomObserverStats(): {
  predicates: number;
  mutationsRate: number;
  flushRate: number;
  coalesceRatio: number;
  lastFlushMs: number;
} {
  const now = performance.now();
  const dtSec = Math.max(0.001, (now - _lastStatsSample) / 1000);
  const instMutRate = _mutationCount / dtSec;
  const instFlushRate = _flushCount / dtSec;
  // EWMA with alpha ~0.3 for a smoother reading.
  _mutationRateEwma = _mutationRateEwma === 0 ? instMutRate : (0.3 * instMutRate + 0.7 * _mutationRateEwma);
  _flushRateEwma    = _flushRateEwma === 0 ? instFlushRate : (0.3 * instFlushRate + 0.7 * _flushRateEwma);
  _mutationCount = 0;
  _flushCount = 0;
  _lastStatsSample = now;
  const coalesceRatio = _flushRateEwma > 0 ? _mutationRateEwma / _flushRateEwma : 0;
  return {
    predicates: _addedListeners.size + _removedListeners.size,
    mutationsRate: Math.round(_mutationRateEwma),
    flushRate: Math.round(_flushRateEwma),
    coalesceRatio: Math.round(coalesceRatio * 10) / 10,
    lastFlushMs: Math.round(_lastFlushMs * 100) / 100,
  };
}

/** Install the __QPM_DOM_OBSERVER__ debug bridge on window. Explicit call from main.ts. */
export function initDomObserverDebugBridge(): void {
  try {
    (window as unknown as { __QPM_DOM_OBSERVER__?: unknown }).__QPM_DOM_OBSERVER__ = {
      stats: getSharedDomObserverStats,
      listeners: () => ({ added: _addedListeners.size, removed: _removedListeners.size }),
    };
  } catch { /* window not available */ }
}

// ── End shared coalesced DOM observer ──────────────────────────────────────

export interface WaitForOpts {
  root?: ParentNode;
  timeout?: number;
  includeExisting?: boolean;
}

export async function waitFor<T extends Element = Element>(
  selOrFn: SelectorOrPredicate,
  { root = document, timeout = 30_000, includeExisting = true }: WaitForOpts = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    let unregister: (() => void) | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const check = (): T | null => {
      if (typeof selOrFn === 'string') {
        return root.querySelector<T>(selOrFn);
      } else {
        const elements = Array.from(root.querySelectorAll('*'));
        return (elements.find(selOrFn) as T | undefined) ?? null;
      }
    };

    const cleanup = (): void => {
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
      if (unregister) { unregister(); unregister = null; }
    };

    if (includeExisting) {
      const existing = check();
      if (existing) { resolve(existing); return; }
    }

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`waitFor timeout after ${timeout}ms`));
    }, timeout);

    const onFlush: SharedPredicate = () => {
      const el = check();
      if (el) { cleanup(); resolve(el); }
    };

    if (root === document) {
      unregister = _registerAdded(onFlush);
    } else {
      const scoped = new MutationObserver(onFlush);
      scoped.observe(root, { childList: true, subtree: true });
      unregister = () => scoped.disconnect();
    }
  });
}

export interface OnAddedOpts {
  root?: ParentNode;
  callForExisting?: boolean;
}

export function onAdded(
  selOrFn: SelectorOrPredicate,
  cb: (el: Element) => void,
  { root = document, callForExisting = true }: OnAddedOpts = {}
): DisconnectHandle {
  const check = (nodes: NodeList | readonly Node[]): void => {
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const element = node as Element;

      const matches = typeof selOrFn === 'string'
        ? element.matches(selOrFn)
        : selOrFn(element);

      if (matches) {
        cb(element);
      }

      // Check descendants
      if (typeof selOrFn === 'string') {
        const descendants = element.querySelectorAll(selOrFn);
        descendants.forEach(cb);
      } else {
        const allDescendants = Array.from(element.querySelectorAll('*'));
        allDescendants.filter(selOrFn).forEach(cb);
      }
    }
  };

  if (callForExisting) {
    const existing = typeof selOrFn === 'string'
      ? Array.from(root.querySelectorAll(selOrFn))
      : Array.from(root.querySelectorAll('*')).filter(selOrFn);
    existing.forEach(cb);
  }

  const onFlush: SharedPredicate = (records) => {
    for (const r of records) check(r.addedNodes);
  };

  if (root === document) {
    const unregister = _registerAdded(onFlush);
    return { disconnect: unregister };
  }

  const scoped = new MutationObserver((records) => {
    for (const r of records) check(r.addedNodes);
  });
  scoped.observe(root, { childList: true, subtree: true });
  return { disconnect: () => scoped.disconnect() };
}

export function onRemoved(
  selOrFn: SelectorOrPredicate,
  cb: (el: Element) => void,
  { root = document }: { root?: ParentNode } = {}
): DisconnectHandle {
  const check = (records: readonly MutationRecord[]): void => {
    for (const r of records) {
      for (const node of r.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as Element;

        const matches = typeof selOrFn === 'string'
          ? element.matches(selOrFn)
          : selOrFn(element);

        if (matches) {
          cb(element);
        }
      }
    }
  };

  if (root === document) {
    const unregister = _registerRemoved(check);
    return { disconnect: unregister };
  }

  const scoped = new MutationObserver(check);
  scoped.observe(root, { childList: true, subtree: true });
  return { disconnect: () => scoped.disconnect() };
}

export interface DelegateOpts {
  root?: ParentNode;
  capture?: boolean;
}

export function delegate<K extends keyof DocumentEventMap>(
  selector: SelectorOrPredicate,
  type: K,
  handler: (this: Element, ev: DocumentEventMap[K]) => void,
  { root = document, capture = false }: DelegateOpts = {}
): OffHandle {
  const listener = (event: DocumentEventMap[K]) => {
    const target = event.target as Element;
    if (!target) return;
    
    const match = typeof selector === 'string'
      ? target.closest(selector)
      : Array.from(root.querySelectorAll('*')).find(el => 
          el.contains(target) && selector(el)
        );
        
    if (match) {
      handler.call(match, event);
    }
  };

  root.addEventListener(type, listener as EventListener, capture);
  
  return {
    off: () => root.removeEventListener(type, listener as EventListener, capture)
  };
}

export interface WatchOpts {
  attributes?: boolean;
  childList?: boolean;
  subtree?: boolean;
}

export function watch(el: Node, cb: (el: Node) => void, opts: WatchOpts = {}): DisconnectHandle {
  const observer = new MutationObserver(() => cb(el));
  observer.observe(el, {
    attributes: true,
    childList: true,
    subtree: true,
    ...opts
  });
  return { disconnect: () => observer.disconnect() };
}

export function isVisible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && 
         style.display !== 'none' && 
         parseFloat(style.opacity || '1') > 0;
}

const GAME_HUD_SELECTORS: readonly string[] = [
  '#App .QuinoaUI',
  '#App [data-tm-main-interface]',
  '#App [data-tm-hud-root]',
  '#App [data-mc-app-shell]',
  '#App > div.McFlex.css-neeqas',
  '#App > div.McFlex.css-1k630i1',
  '#App > div.McFlex',
];

export function getGameHudRoot(): HTMLElement | null {
  for (const selector of GAME_HUD_SELECTORS) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      return element;
    }
  }

  const appRoot = document.getElementById('App');
  if (!appRoot) {
    return null;
  }

  const flexRoot = appRoot.querySelector('div.McFlex');
  if (flexRoot instanceof HTMLElement) {
    return flexRoot;
  }

  return appRoot instanceof HTMLElement ? appRoot : null;
}