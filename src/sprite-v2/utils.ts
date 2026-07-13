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
        Sprite: anySpr.constructor,
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
