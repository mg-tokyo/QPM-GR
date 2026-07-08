// sprite-v2/renderer.ts - Mutation rendering engine with advanced layering

import type { MutationName, SpriteFilterConfig, VariantInfo, SpriteState, SpriteConfig, RenderJob } from './types';
import {
  MUT_META,
  MUTATION_ORDER,
  MUTATION_INDEX,
  TILE_SIZE_WORLD,
  BASE_ICON_SCALE,
  TALL_PLANT_MUTATION_ICON_SCALE_BOOST,
  FLOATING_MUTATION_ICONS,
  MUT_ICON_Y_EXCEPT,
  MUT_ICON_X_EXCEPT,
} from './settings';
import { baseNameOf, isTallKey } from './utils';
import { cacheSet, entryCost } from './cache';

// Mutation filter definitions
const FILTERS: Record<string, SpriteFilterConfig> = {
  Gold: { op: 'source-atop', colors: ['rgb(235,200,0)'], a: 0.7 },
  Rainbow: {
    op: 'color',
    colors: ['#FF1744', '#FF9100', '#FFEA00', '#00E676', '#2979FF', '#D500F9'],
    ang: 130,
    angTall: 0,
    masked: true,
  },
  Wet: { op: 'source-atop', colors: ['rgb(50,180,200)'], a: 0.25 },
  Chilled: { op: 'source-atop', colors: ['rgb(100,160,210)'], a: 0.45 },
  Frozen: { op: 'source-atop', colors: ['rgb(100,130,220)'], a: 0.5 },
  Dawnlit: { op: 'source-atop', colors: ['rgb(209,70,231)'], a: 0.5 },
  Ambershine: { op: 'source-atop', colors: ['rgb(190,100,40)'], a: 0.5 },
  Dawncharged: { op: 'source-atop', colors: ['rgb(140,80,200)'], a: 0.5 },
  Ambercharged: { op: 'source-atop', colors: ['rgb(170,60,25)'], a: 0.5 },
  Thunderstruck: { op: 'source-atop', colors: ['rgb(255,220,50)'], a: 0.5 },
};

let _supportedBlendOps: Set<string> | null = null;
function getSupportedBlendOps(): Set<string> {
  if (_supportedBlendOps) return _supportedBlendOps;
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    if (!g) return (_supportedBlendOps = new Set<string>());
    const ops = ['color', 'hue', 'saturation', 'luminosity', 'overlay', 'screen', 'lighter', 'source-atop'];
    const ok = new Set<string>();
    for (const op of ops) {
      g.globalCompositeOperation = op as GlobalCompositeOperation;
      if (g.globalCompositeOperation === op) ok.add(op);
    }
    return (_supportedBlendOps = ok);
  } catch {
    return (_supportedBlendOps = new Set<string>());
  }
}

function pickBlendOp(desired: string): GlobalCompositeOperation {
  const ops = getSupportedBlendOps();
  if (ops.has(desired)) return desired as GlobalCompositeOperation;
  if (ops.has('overlay')) return 'overlay';
  if (ops.has('screen')) return 'screen';
  if (ops.has('lighter')) return 'lighter';
  return 'source-atop';
}

export function hasMutationFilter(value: string): boolean {
  return Boolean(value && FILTERS[value]);
}

export function sortMutations(list: string[]): MutationName[] {
  const uniq = [...new Set(list.filter(Boolean))];
  return uniq.sort((a, b) => {
    return (MUTATION_INDEX.get(a as MutationName) ?? Infinity) - (MUTATION_INDEX.get(b as MutationName) ?? Infinity);
  }) as MutationName[];
}

function mutationAliases(mut: MutationName): MutationName[] {
  // Return all known aliases for a mutation name for backwards compatibility
  // This ensures old sprite keys (Amberlit, Dawnbound, etc) still work
  switch (mut) {
    case 'Ambershine':
      return ['Ambershine', 'Amberlit' as MutationName];
    case 'Dawncharged':
      return ['Dawncharged', 'Dawnbound' as MutationName];
    case 'Ambercharged':
      return ['Ambercharged', 'Amberbound' as MutationName];
    default:
      return [mut];
  }
}

function normalizeMutListColor(list: string[]): MutationName[] {
  const names = list.filter((m, idx, arr) => FILTERS[m] && arr.indexOf(m) === idx) as MutationName[];
  if (!names.length) return [];

  if (names.includes('Gold')) return ['Gold'];
  if (names.includes('Rainbow')) return ['Rainbow'];

  const warm = ['Ambershine', 'Dawnlit', 'Dawncharged', 'Ambercharged'];
  const hasWarm = names.some((n) => warm.includes(n));

  if (hasWarm) {
    return sortMutations(names.filter((n) => !['Wet', 'Chilled', 'Frozen'].includes(n)));
  }

  return sortMutations(names);
}

function normalizeMutListOverlay(list: string[]): MutationName[] {
  const names = list.filter((m, idx, arr) => {
    return MUT_META[m as MutationName]?.overlayTall && arr.indexOf(m) === idx;
  }) as MutationName[];

  return sortMutations(names);
}

interface MutationStep {
  name: MutationName;
  meta: typeof MUT_META[MutationName] | undefined;
  overlayTall: string | null;
  isTall: boolean;
}

function buildMutationPipeline(mutNames: MutationName[], isTall: boolean): MutationStep[] {
  return mutNames.map((m) => ({
    name: m,
    meta: MUT_META[m],
    overlayTall: MUT_META[m]?.overlayTall ?? null,
    isTall,
  }));
}

function angleGrad(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ang: number,
  fullSpan = false
): CanvasGradient {
  const rad = ((ang - 90) * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;

  if (!fullSpan) {
    const R = Math.min(w, h) / 2;
    return ctx.createLinearGradient(cx - Math.cos(rad) * R, cy - Math.sin(rad) * R, cx + Math.cos(rad) * R, cy + Math.sin(rad) * R);
  }

  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const R = (Math.abs(dx) * w) / 2 + (Math.abs(dy) * h) / 2;
  return ctx.createLinearGradient(cx - dx * R, cy - dy * R, cx + dx * R, cy + dy * R);
}

function fillGrad(ctx: CanvasRenderingContext2D, w: number, h: number, f: SpriteFilterConfig, fullSpan = false): void {
  const cols = f.colors?.length ? f.colors : ['#fff'];
  const g = f.ang != null ? angleGrad(ctx, w, h, f.ang, fullSpan) : ctx.createLinearGradient(0, 0, 0, h);

  if (cols.length === 1) {
    const color = cols[0] || '#fff';
    g.addColorStop(0, color);
    g.addColorStop(1, color);
  } else {
    cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c || '#fff'));
  }

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function applyFilterOnto(ctx: CanvasRenderingContext2D, sourceCanvas: HTMLCanvasElement, name: MutationName, isTall: boolean): void {
  const base = FILTERS[name];
  if (!base) return;

  const f = { ...base };
  if (name === 'Rainbow' && isTall && f.angTall != null) f.ang = f.angTall;

  const fullSpan = name === 'Rainbow' && isTall;
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  ctx.save();
  const blendOp = f.masked ? pickBlendOp(f.op) : 'source-in';
  ctx.globalCompositeOperation = blendOp;
  if (f.a != null) ctx.globalAlpha = f.a;

  if (f.masked) {
    const m = document.createElement('canvas');
    m.width = w;
    m.height = h;
    const mctx = m.getContext('2d')!;
    mctx.imageSmoothingEnabled = false;
    fillGrad(mctx, w, h, f, fullSpan);
    mctx.globalCompositeOperation = 'destination-in';
    mctx.drawImage(sourceCanvas, 0, 0);
    ctx.drawImage(m, 0, 0);
  } else {
    fillGrad(ctx, w, h, f, fullSpan);
  }

  ctx.restore();
}

export function textureToCanvas(tex: any, state: SpriteState, cfg: SpriteConfig): HTMLCanvasElement {
  const hit = state.srcCan.get(tex);
  if (hit) return hit;

  let c: HTMLCanvasElement | null = null;

  // --- Priority 1: Direct 2D canvas extraction from stored KTX2 source ---
  // KTX2-decoded textures have a source canvas stored in state.ktx2Canvases.
  // Using this is faster AND more reliable than GPU extract (which can return
  // blank canvases when the texture was never rendered to screen).
  if (!c) {
    c = tryDirectCanvasExtract(tex, state);
  }

  // --- Priority 2: GPU extract via renderer ---
  if (!c) {
    const RDR = state.renderer;
    try {
      if (RDR?.extract?.canvas && (RDR?.resolution ?? 1) === 1) {
        const s = new state.ctors!.Sprite(tex);
        const extracted = RDR.extract.canvas(s);
        s.destroy?.({ children: true, texture: false, baseTexture: false });
        // Validate the extraction produced visible content — GPU textures that
        // were never rendered to screen may yield blank (all-transparent) canvases.
        if (extracted && !isCanvasBlank(extracted)) {
          c = extracted;
        }
      }
    } catch (e) {
      // Fall through to manual extraction
    }
  }

  // --- Priority 3: Manual canvas extraction from PIXI source chain ---
  if (!c) {
    c = tryManualCanvasExtract(tex, state);
  }

  if (!c) throw new Error('textureToCanvas failed');

  state.srcCan.set(tex, c);
  if (state.srcCan.size > cfg.srcCanvasMax) {
    const k = state.srcCan.keys().next().value;
    if (k !== undefined) state.srcCan.delete(k);
  }

  return c;
}

/**
 * Try to extract a sub-region directly from a stored KTX2 source canvas.
 * This bypasses GPU extraction entirely, which is more reliable when textures
 * have not been rendered to screen (common for QPM's offscreen sprite use).
 */
function tryDirectCanvasExtract(tex: any, state: SpriteState): HTMLCanvasElement | null {
  if (!state.ktx2Canvases) return null;

  const texSource = tex?.source ?? tex?._source;
  if (!texSource || typeof texSource !== 'object') return null;

  const srcCanvas = state.ktx2Canvases.get(texSource as object);
  if (!srcCanvas) return null;

  return drawSubRegion(tex, srcCanvas);
}

/**
 * Manual canvas extraction from PIXI's internal source chain.
 * Walks multiple property paths to find the underlying canvas/image resource.
 */
function tryManualCanvasExtract(tex: any, state: SpriteState): HTMLCanvasElement | null {
  const fr = tex?.frame || tex?._frame;
  if (!fr) return null;

  // Walk PIXI's internal property chain to find the underlying canvas/image.
  // Covers PIXI v7 (_baseTexture.resource) and v8 (source.resource) layouts.
  const src =
    tex?.source?.resource?.source ||
    tex?.source?.resource ||
    tex?._source?.resource?.source ||
    tex?._source?.resource ||
    tex?._baseTexture?.resource?.source ||
    tex?._baseTexture?.resource ||
    null;

  // Also check if the source itself IS the drawable (some PIXI v8 paths)
  const drawable = (src instanceof HTMLCanvasElement || src instanceof HTMLImageElement)
    ? src
    : (tex?.source instanceof HTMLCanvasElement ? tex.source : null);

  if (!drawable) return null;

  return drawSubRegion(tex, drawable);
}

/**
 * Draw a sub-region from a source canvas/image using the texture's frame/trim/rotation.
 */
function drawSubRegion(tex: any, src: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement | null {
  const fr = tex?.frame || tex?._frame;
  if (!fr) return null;

  const orig = tex?.orig || tex?._orig;
  const trim = tex?.trim || tex?._trim;
  const rot = tex?.rotate || tex?._rotate || 0;

  const c = document.createElement('canvas');
  const fullW = Math.max(1, (orig?.width ?? fr.width) | 0);
  const fullH = Math.max(1, (orig?.height ?? fr.height) | 0);
  const offX = trim?.x ?? 0;
  const offY = trim?.y ?? 0;

  c.width = fullW;
  c.height = fullH;
  const ctx2d = c.getContext('2d');
  if (!ctx2d) return null;
  ctx2d.imageSmoothingEnabled = false;

  const rotated = rot === true || rot === 2 || rot === 8;
  if (rotated) {
    ctx2d.save();
    ctx2d.translate(offX + fr.height / 2, offY + fr.width / 2);
    ctx2d.rotate(-Math.PI / 2);
    ctx2d.drawImage(src, fr.x, fr.y, fr.width, fr.height, -fr.width / 2, -fr.height / 2, fr.width, fr.height);
    ctx2d.restore();
  } else {
    ctx2d.drawImage(src, fr.x, fr.y, fr.width, fr.height, offX, offY, fr.width, fr.height);
  }

  return c;
}

function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return true;

  try {
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return true;

    // Single mid-height row read — 1 getImageData call vs. the previous 5.
    const data = ctx2d.getImageData(0, h >> 1, w, 1).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function findOverlayTexture(itKey: string, mutName: MutationName, state: SpriteState, preferTall: boolean): { tex: any; key: string } | null {
  if (!mutName) return null;

  const base = baseNameOf(itKey);
  const aliases = mutationAliases(mutName);

  for (const name of aliases) {
    const tries = [
      `sprite/mutation/${name}${base}`,
      `sprite/mutation/${name}-${base}`,
      `sprite/mutation/${name}_${base}`,
      `sprite/mutation/${name}/${base}`,
      `sprite/mutation/${name}`,
    ];

    for (const k of tries) {
      const t = state.tex.get(k);
      if (t) return { tex: t, key: k };
    }

    if (preferTall) {
      const tallKey = `sprite/mutation-overlay/${name}TallPlant`;
      const t = state.tex.get(tallKey);
      if (t) return { tex: t, key: tallKey };
    }
  }

  return null;
}

function findIconTexture(itKey: string, mutName: MutationName, isTall: boolean, state: SpriteState): any {
  if (!mutName) return null;

  const meta = MUT_META[mutName];
  if (isTall && meta?.tallIconOverride) {
    const t = state.tex.get(meta.tallIconOverride);
    if (t) return t;
  }

  const base = baseNameOf(itKey);
  const aliases = mutationAliases(mutName);

  for (const name of aliases) {
    const tries = [
      `sprite/mutation/${name}Icon`,
      `sprite/mutation/${name}`,
      `sprite/mutation/${name}${base}`,
      `sprite/mutation/${name}-${base}`,
      `sprite/mutation/${name}_${base}`,
      `sprite/mutation/${name}/${base}`,
    ];

    for (const k of tries) {
      const t = state.tex.get(k);
      if (t) return t;
    }

    if (isTall) {
      const t = state.tex.get(`sprite/mutation-overlay/${name}TallPlantIcon`) || state.tex.get(`sprite/mutation-overlay/${name}TallPlant`);
      if (t) return t;
    }
  }

  return null;
}

function computeIconLayout(tex: any, baseName: string, isTall: boolean) {
  const width = tex?.orig?.width ?? tex?.frame?.width ?? tex?.width ?? 1;
  const height = tex?.orig?.height ?? tex?.frame?.height ?? tex?.height ?? 1;
  const anchorX = tex?.defaultAnchor?.x ?? 0;
  const anchorY = tex?.defaultAnchor?.y ?? 0;

  const targetX = MUT_ICON_X_EXCEPT[baseName] ?? anchorX;
  const isVerticalShape = height > width * 1.5;
  const targetY = MUT_ICON_Y_EXCEPT[baseName] ?? (isVerticalShape ? anchorY : 0.4);

  const offset = {
    x: (targetX - anchorX) * width,
    y: (targetY - anchorY) * height,
  };

  const minDimension = Math.min(width, height);
  const scaleFactor = Math.min(1.5, minDimension / TILE_SIZE_WORLD);
  let iconScale = BASE_ICON_SCALE * scaleFactor;
  if (isTall) iconScale *= TALL_PLANT_MUTATION_ICON_SCALE_BOOST;

  return {
    width,
    height,
    anchorX,
    anchorY,
    offset,
    iconScale,
  };
}

export function renderMutatedTexture(tex: any, itKey: string, V: VariantInfo, state: SpriteState, cfg: SpriteConfig): any {
  try {
    if (!tex || !state.ctors?.Texture) {
      return tex ?? null;
    }

    // Fast path: no mutations to composite — return base texture as-is.
    if (V.muts.length === 0 && V.overlayMuts.length === 0 && V.selectedMuts.length === 0) {
      return tex;
    }

    const { Texture } = state.ctors;

    const w = tex?.orig?.width ?? tex?.frame?.width ?? tex?.width ?? 1;
    const h = tex?.orig?.height ?? tex?.frame?.height ?? tex?.height ?? 1;
    const aX = tex?.defaultAnchor?.x ?? 0.5;
    const aY = tex?.defaultAnchor?.y ?? 0.5;
    const basePos = { x: w * aX, y: h * aY };
    const baseCanvas = textureToCanvas(tex, state, cfg);

    const isTall = isTallKey(itKey);
    const pipeline = buildMutationPipeline(V.muts, isTall);
    const overlayPipeline = buildMutationPipeline(V.overlayMuts, isTall);
    const iconPipeline = buildMutationPipeline(V.selectedMuts, isTall);

    const baseName = baseNameOf(itKey);
    const iconLayout = computeIconLayout(tex, baseName, isTall);

    // --- Pure 2D canvas compositing (no GPU dependency) ---
    // This avoids PIXI GPU pipeline issues where canvas-based textures
    // haven't been uploaded to the GPU (common with KTX2-decoded sources).
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d')!;
    octx.imageSmoothingEnabled = false;

    // Draw base sprite
    octx.drawImage(baseCanvas, 0, 0);

    // Color layers
    for (const step of pipeline) {
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = w;
      layerCanvas.height = h;
      const lctx = layerCanvas.getContext('2d')!;
      lctx.imageSmoothingEnabled = false;
      lctx.save();
      lctx.translate(w * aX, h * aY);
      lctx.drawImage(baseCanvas, -w * aX, -h * aY);
      lctx.restore();
      applyFilterOnto(lctx, layerCanvas, step.name, step.isTall);
      octx.drawImage(layerCanvas, 0, 0);
    }

    // Tall overlays
    if (isTall) {
      for (const step of overlayPipeline) {
        const hit = (step.overlayTall && state.tex.get(step.overlayTall) && { tex: state.tex.get(step.overlayTall), key: step.overlayTall }) || findOverlayTexture(itKey, step.name, state, true);
        if (!hit?.tex) continue;

        const oCan = textureToCanvas(hit.tex, state, cfg);
        if (!oCan) continue;

        const ow = oCan.width;
        const overlayX = basePos.x - aX * ow;

        const maskedCanvas = document.createElement('canvas');
        maskedCanvas.width = ow;
        maskedCanvas.height = oCan.height;
        const mctx = maskedCanvas.getContext('2d')!;
        mctx.imageSmoothingEnabled = false;
        mctx.drawImage(oCan, 0, 0);
        mctx.globalCompositeOperation = 'destination-in';
        mctx.drawImage(baseCanvas, -overlayX, 0);

        octx.drawImage(maskedCanvas, overlayX, 0);
      }
    }

    // Icons (mutation badge sprites)
    for (const step of iconPipeline) {
      if (step.name === 'Gold' || step.name === 'Rainbow') continue;

      const itex = findIconTexture(itKey, step.name, step.isTall, state);
      if (!itex) continue;

      const iconCanvas = textureToCanvas(itex, state, cfg);
      if (!iconCanvas) continue;

      const iconAnchorX = itex?.defaultAnchor?.x ?? 0.5;
      const iconAnchorY = itex?.defaultAnchor?.y ?? 0.5;
      const iconW = iconCanvas.width * iconLayout.iconScale;
      const iconH = iconCanvas.height * iconLayout.iconScale;
      const drawX = basePos.x + iconLayout.offset.x - iconAnchorX * iconW;
      const drawY = basePos.y + iconLayout.offset.y - iconAnchorY * iconH;

      octx.drawImage(iconCanvas, drawX, drawY, iconW, iconH);
    }

    // Wrap the final canvas as a PIXI Texture for the sprite system
    const outTex = Texture.from(out);

    // Store the composited canvas so textureToCanvas can extract it later
    // without going through the GPU.
    const texSource = outTex?.source ?? outTex?._source ?? outTex;
    if (texSource && typeof texSource === 'object' && state.ktx2Canvases) {
      state.ktx2Canvases.set(texSource as object, out);
    }

    try {
      (outTex as any).__mg_gen = true;
      outTex.label = `${itKey}|${V.sig}`;
    } catch (e) {
      // Ignore
    }

    return outTex;
  } catch (e) {
    // Mutation pipeline should degrade to base sprite instead of hiding visuals.
    return tex ?? null;
  }
}

export function processVariantJobs(state: SpriteState, cfg: SpriteConfig): boolean {
  if (!cfg.jobOn || !state.open || !state.jobs.length) return false;

  const now = performance.now();
  const burst = now - state.changedAt <= cfg.jobBurstWindowMs;
  const budget = burst ? cfg.jobBurstMs : cfg.jobBudgetMs;
  const t0 = performance.now();
  let done = 0;
  let needsLayout = false;

  while (state.jobs.length) {
    if (performance.now() - t0 >= budget) break;
    if (done >= cfg.jobCapPerTick) break;

    const job = state.jobs[0];
    if (!job) {
      state.jobs.shift();
      continue;
    }

    if (job.sig !== state.sig) {
      state.jobs.shift();
      state.jobMap.delete(job.k);
      continue;
    }

    const tex = job.src[job.i];
    if (!tex) {
      state.jobs.shift();
      state.jobMap.delete(job.k);
      continue;
    }

    const ft = renderMutatedTexture(tex, job.itKey, job.V, state, cfg);
    if (ft) job.out.push(ft);

    job.i++;
    done++;

    if (job.i >= job.src.length) {
      state.jobs.shift();
      state.jobMap.delete(job.k);

      let entry: any = null;
      if (job.isAnim) {
        if (job.out.length >= 2) entry = { isAnim: true, frames: job.out };
      } else {
        if (job.out[0]) entry = { isAnim: false, tex: job.out[0] };
      }

      if (entry) {
        cacheSet(state, cfg, job.k, entry);
        needsLayout = true;
      }
    }
  }

  return needsLayout;
}

export function buildVariantFromMutations(list: string[]): VariantInfo {
  // Color tint pipeline: only mutations with a defined FILTERS entry get a tint
  const raw = list.filter((value) => hasMutationFilter(value));
  const muts = normalizeMutListColor(raw);
  const overlayMuts = normalizeMutListOverlay(raw);

  // Icon pipeline: allow ALL mutation names so atlas icons are found dynamically
  // (findIconTexture and applyFilterOnto handle unknown names gracefully)
  const selected = sortMutations(list.filter(Boolean) as MutationName[]);

  return {
    mode: 'M',
    muts,
    overlayMuts,
    selectedMuts: selected,
    sig: `M:${selected.join(',')}|${muts.join(',')}|${overlayMuts.join(',')}`,
  };
}

export function computeVariantSignature(state: SpriteState): VariantInfo {
  if (!state.mutOn) {
    const f = hasMutationFilter(state.f) ? state.f : null;
    const baseMuts = f ? [f] : [];
    return { mode: 'F', muts: baseMuts as MutationName[], overlayMuts: baseMuts as MutationName[], selectedMuts: baseMuts as MutationName[], sig: `F:${f ?? ''}` };
  }

  const raw = state.mutations.filter((value) => hasMutationFilter(value));
  const selected = sortMutations(raw);
  const muts = normalizeMutListColor(raw);
  const overlayMuts = normalizeMutListOverlay(raw);

  return {
    mode: 'M',
    muts,
    overlayMuts,
    selectedMuts: selected,
    sig: `M:${selected.join(',')}|${muts.join(',')}|${overlayMuts.join(',')}`,
  };
}
