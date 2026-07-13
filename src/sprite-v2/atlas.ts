import type { AtlasData, PixiConstructors, SpriteState, SpriteItem } from './types';
import { rememberBaseTex } from './utils';
import { animParse, categoryOf } from './manifest';

function mkRect(Rectangle: any, x: number, y: number, w: number, h: number): any {
  return new Rectangle(x, y, w, h);
}

function mkSubTex(Texture: any, baseTex: any, frame: any, orig: any, trim: any, rotate: number, anchor: { x: number; y: number } | null): any {
  let t: any;
  const sourceRef = baseTex?.source ?? baseTex?._source ?? baseTex;

  try {
    t = new Texture({ source: sourceRef, frame, orig, trim: trim || undefined, rotate: rotate || 0 });
  } catch (e) {
    const fallbackSource = sourceRef ?? baseTex?._baseTexture ?? baseTex;
    t = new Texture(fallbackSource, frame, orig, trim || undefined, rotate || 0);
  }

  try {
    if (t && !t.label) {
      t.label = frame?.width && frame?.height ? `sub:${frame.width}x${frame.height}` : 'subtex';
    }
  } catch (e) {
  }

  if (anchor) {
    const target = t;
    if (target.defaultAnchor?.set) {
      try {
        target.defaultAnchor.set(anchor.x, anchor.y);
      } catch (e) {
        // Ignore
      }
    }

    if (target.defaultAnchor && !target.defaultAnchor.set) {
      target.defaultAnchor.x = anchor.x;
      target.defaultAnchor.y = anchor.y;
    }

    if (!target.defaultAnchor) {
      target.defaultAnchor = { x: anchor.x, y: anchor.y };
    }
  }

  try {
    t?.updateUvs?.();
  } catch (e) {
  }

  return t;
}

export function buildAtlasTextures(data: AtlasData, baseTex: any, texMap: Map<string, any>, atlasBases: Set<any>, ctors: PixiConstructors): void {
  const { Texture, Rectangle } = ctors;

  try {
    if (baseTex && !baseTex.label) {
      baseTex.label = data?.meta?.image || 'atlasBase';
    }
  } catch (e) {
  }

  rememberBaseTex(baseTex, atlasBases);

  for (const [k, fd] of Object.entries(data.frames)) {
    const fr = fd.frame;
    const rot = fd.rotated ? 2 : 0;
    const w = fd.rotated ? fr.h : fr.w;
    const h = fd.rotated ? fr.w : fr.h;

    const frame = mkRect(Rectangle, fr.x, fr.y, w, h);
    const ss = fd.sourceSize || { w: fr.w, h: fr.h };
    const orig = mkRect(Rectangle, 0, 0, ss.w, ss.h);

    let trim = null;
    if (fd.trimmed && fd.spriteSourceSize) {
      const s = fd.spriteSourceSize;
      trim = mkRect(Rectangle, s.x, s.y, s.w, s.h);
    }

    const t = mkSubTex(Texture, baseTex, frame, orig, trim, rot, fd.anchor || null);

    try {
      t.label = k;
    } catch (e) {
      // Ignore
    }

    rememberBaseTex(t, atlasBases);
    texMap.set(k, t);
  }
}

export function buildItemsFromTextures(tex: Map<string, any>, cfg: { catLevels?: number } = {}): { items: SpriteItem[]; cats: Map<string, SpriteItem[]> } {
  const keys = [...tex.keys()].sort((a, b) => a.localeCompare(b));
  const used = new Set<string>();
  const items: SpriteItem[] = [];
  const cats = new Map<string, SpriteItem[]>();

  const addToCat = (key: string, item: SpriteItem) => {
    const cat = categoryOf(key, cfg.catLevels || 1);
    if (!cats.has(cat)) cats.set(cat, []);
    cats.get(cat)!.push(item);
  };

  for (const key of keys) {
    const texEntry = tex.get(key);
    if (!texEntry || used.has(key)) continue;

    const anim = animParse(key);
    if (!anim) {
      const item: SpriteItem = { key, isAnim: false, first: texEntry };
      items.push(item);
      addToCat(key, item);
      continue;
    }

    const frames: Array<{ idx: number; tex: any }> = [];
    for (const candidate of keys) {
      const maybe = animParse(candidate);
      if (!maybe || maybe.baseKey !== anim.baseKey) continue;

      const t = tex.get(candidate);
      if (!t) continue;

      frames.push({ idx: maybe.idx, tex: t });
      used.add(candidate);
    }

    frames.sort((a, b) => a.idx - b.idx);
    const ordered = frames.map((f) => f.tex);

    if (ordered.length === 1) {
      const item: SpriteItem = { key: anim.baseKey, isAnim: false, first: ordered[0] };
      items.push(item);
      addToCat(anim.baseKey, item);
    } else if (ordered.length > 1) {
      const item: SpriteItem = {
        key: anim.baseKey,
        isAnim: true,
        frames: ordered,
        first: ordered[0],
        count: ordered.length,
      };
      items.push(item);
      addToCat(anim.baseKey, item);
    }
  }

  return { items, cats };
}
