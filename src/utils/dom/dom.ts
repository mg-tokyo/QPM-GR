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
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`waitFor timeout after ${timeout}ms`));
    }, timeout);

    const check = (): T | null => {
      if (typeof selOrFn === 'string') {
        return root.querySelector<T>(selOrFn);
      } else {
        const elements = Array.from(root.querySelectorAll('*'));
        return elements.find(selOrFn) as T || null;
      }
    };

    if (includeExisting) {
      const existing = check();
      if (existing) {
        clearTimeout(timeoutId);
        resolve(existing);
        return;
      }
    }

    const observer = new MutationObserver(() => {
      const element = check();
      if (element) {
        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true
    });
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
  const check = (nodes: NodeList) => {
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

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      check(mutation.addedNodes);
    }
  });

  observer.observe(root, {
    childList: true,
    subtree: true
  });

  return { disconnect: () => observer.disconnect() };
}

export function onRemoved(
  selOrFn: SelectorOrPredicate,
  cb: (el: Element) => void,
  { root = document }: { root?: ParentNode } = {}
): DisconnectHandle {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
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
  });

  observer.observe(root, {
    childList: true,
    subtree: true
  });

  return { disconnect: () => observer.disconnect() };
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