// Simplified to match Aries Mod's approach for Chrome/Firefox compatibility

import type { PixiConstructors } from './types';
import { pageWindow } from '../core/pageContext';

export function findAny(root: any, pred: (node: any) => boolean, lim = 25000): any {
  const stack = [root];
  const seen = new Set();
  let n = 0;

  while (stack.length && n++ < lim) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);

    if (pred(node)) return node;

    const children = node.children;
    if (Array.isArray(children)) {
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push(children[i]);
      }
    }
  }

  return null;
}

// Delegates to pageContext for Firefox wrappedJSObject support.
function getRoot(): any {
  return pageWindow;
}

/** True when `ctor.prototype` itself defines `texture` (PIXI Sprite does; its Container base and game subclasses do not). */
export function hasOwnTextureAccessor(ctor: unknown): boolean {
  if (typeof ctor !== 'function') return false;
  const proto = (ctor as { prototype?: object }).prototype;
  return !!proto && Object.prototype.hasOwnProperty.call(proto, 'texture');
}

// Walks a captured sprite's constructor chain to PIXI's own Sprite class.
// The stage's first textured node may be a game subclass whose constructor
// expects an options object (game 1152 leads with a Rive-backed sprite that
// throws on a bare Texture). PIXI Sprite is the highest class in the chain
// that still defines `texture` on its own prototype.
export function resolveBaseSpriteCtor(ctor: unknown): unknown {
  let best = ctor;
  let cur: unknown = ctor;
  for (let depth = 0; depth < 16 && typeof cur === 'function'; depth++) {
    if (hasOwnTextureAccessor(cur)) best = cur;
    const parent: unknown = Object.getPrototypeOf(cur);
    if (!parent || parent === Function.prototype) break;
    cur = parent;
  }
  return best;
}

// Uses unsafeWindow consistently for Chrome/Firefox compatibility.
export function getCtors(app: any, renderer?: any): PixiConstructors {
  const root = getRoot();
  const P = root.PIXI || root.__PIXI__;

  if (P?.Texture && P?.Sprite && P?.Container && P?.Rectangle) {
    return {
      Container: P.Container,
      Sprite: P.Sprite,
      Texture: P.Texture,
      Rectangle: P.Rectangle,
      Text: P.Text || null,
    };
  }

  if (app?.stage) {
    const stage = app.stage;
    const anySpr = findAny(stage, (x) => {
      return x?.texture?.frame && x?.constructor && x?.texture?.constructor && x?.texture?.frame?.constructor;
    });

    if (anySpr) {
      const anyTxt = findAny(
        stage,
        (x) => (typeof x?.text === 'string' || typeof x?.text === 'number') && x?.style
      );

      return {
        Container: stage.constructor,
        Sprite: resolveBaseSpriteCtor(anySpr.constructor),
        Texture: anySpr.texture.constructor,
        Rectangle: anySpr.texture.frame.constructor,
        Text: anyTxt?.constructor || null,
      };
    }
  }

  throw new Error('No PIXI constructors found - cannot extract from app or globals');
}

export function baseTexOf(tex: any): any {
  return (
    tex?.source ??
    tex?._source ??
    tex?._baseTexture ??
    null
  );
}

/**
 * Remembers base textures to prevent garbage collection
 */
export function rememberBaseTex(tex: any, atlasBases: Set<any>): void {
  const base = baseTexOf(tex);
  if (base) atlasBases.add(base);
}

export function normalizeKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function baseNameOf(key: string): string {
  const parts = String(key || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export function isTallKey(k: string): boolean {
  return /tallplant/i.test(k);
}
