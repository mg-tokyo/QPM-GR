import { pageWindow } from '../core/pageContext';
import { createNamedLogger } from '../diagnostics/logger';
import type { BridgePlayOpts } from './types';

const fbLog = createNamedLogger('audio.fallback');

const urlIndex = new Map<string, string>();
let audioCtx: AudioContext | null = null;
const activeLoops = new Map<number, { audio: HTMLAudioElement; panner?: StereoPannerNode; gain?: GainNode }>();
let loopId = 0;

function ensureAudioContext(): AudioContext | null {
  if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
  const winRec = pageWindow as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = winRec.AudioContext ?? winRec.webkitAudioContext ?? (typeof AudioContext !== 'undefined' ? AudioContext : null);
  if (!Ctor) return null;
  try { audioCtx = new Ctor(); } catch { audioCtx = null; }
  if (audioCtx?.state === 'suspended') { void audioCtx.resume().catch(() => { /* boundary */ }); }
  return audioCtx;
}

/** Scan resource-timing entries for hashed sfx URLs. Returns discovered names. */
export function discoverFallbackCatalog(): string[] {
  try {
    const entries = performance.getEntriesByType('resource');
    for (const e of entries) {
      const url = e.name;
      if (!/\/(?:assets\/)?sfx\/.+\.(?:mp3|ogg|wav)(?:\?|$)/i.test(url)) continue;
      const stem = extractStem(url);
      if (stem && !urlIndex.has(stem)) urlIndex.set(stem, url);
    }
  } catch (err) {
    fbLog.debug('resource-timing scan failed', { error: String((err as Error)?.message ?? err) });
  }
  return Array.from(urlIndex.keys());
}

function extractStem(url: string): string | null {
  try {
    const path = url.split('?')[0]!.split('#')[0]!;
    const seg = path.split('/').pop();
    if (!seg) return null;
    const base = seg.replace(/\.(?:mp3|ogg|wav)$/i, '');
    return base.replace(/-[a-f0-9]{6,}$/i, '');
  } catch { return null; }
}

export function fallbackHas(name: string): boolean { return urlIndex.has(name); }
export function fallbackNames(): readonly string[] { return Array.from(urlIndex.keys()); }

export function fallbackPlay(name: string, opts: BridgePlayOpts): boolean {
  const url = urlIndex.get(name);
  if (!url) return false;
  try {
    const audio = new Audio();
    audio.src = url;
    audio.volume = clamp01(opts.volume ?? 1);
    audio.crossOrigin = 'anonymous';
    if (opts.pan !== undefined) attachPan(audio, opts.pan);
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked */ });
    return true;
  } catch (err) {
    fbLog.debug('play failed', { name, error: String((err as Error)?.message ?? err) });
    return false;
  }
}

export interface FallbackLoopHandle {
  readonly id: number;
  setVolume(v: number): void;
  setPan(p: number): void;
  stop(): void;
  isActive(): boolean;
}

export function fallbackStartLoop(name: string, opts: BridgePlayOpts): FallbackLoopHandle | null {
  const url = urlIndex.get(name);
  if (!url) return null;
  const audio = new Audio();
  audio.src = url;
  audio.loop = true;
  audio.volume = clamp01(opts.volume ?? 1);
  audio.crossOrigin = 'anonymous';
  let panner: StereoPannerNode | undefined;
  let gain: GainNode | undefined;
  if (opts.pan !== undefined) {
    const pair = attachPan(audio, opts.pan);
    if (pair) { panner = pair.panner; gain = pair.gain; }
  }
  const p = audio.play();
  if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked */ });
  const id = ++loopId;
  activeLoops.set(id, { audio, ...(panner ? { panner } : {}), ...(gain ? { gain } : {}) });
  let active = true;
  return {
    id,
    setVolume(v: number): void { if (!active) return; audio.volume = clamp01(v); },
    setPan(pan: number): void { if (!active || !panner) return; try { panner.pan.value = clamp(pan, -1, 1); } catch { /* boundary */ } },
    stop(): void {
      if (!active) return; active = false;
      try { audio.pause(); audio.src = ''; } catch { /* boundary */ }
      activeLoops.delete(id);
    },
    isActive(): boolean { return active; },
  };
}

function attachPan(audio: HTMLAudioElement, pan: number): { panner: StereoPannerNode; gain: GainNode } | null {
  const ctx = ensureAudioContext();
  if (!ctx) return null;
  try {
    const src = ctx.createMediaElementSource(audio);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    const gain = ctx.createGain();
    src.connect(panner).connect(gain).connect(ctx.destination);
    return { panner, gain };
  } catch (err) {
    fbLog.debug('createMediaElementSource failed', { error: String((err as Error)?.message ?? err) });
    return null;
  }
}

export function fallbackStopAll(): void {
  for (const [, h] of activeLoops) {
    try { h.audio.pause(); h.audio.src = ''; } catch { /* boundary */ }
  }
  activeLoops.clear();
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
