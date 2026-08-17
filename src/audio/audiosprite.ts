import { pageWindow } from '../core/pageContext';
import { createNamedLogger } from '../diagnostics/logger';
import type { BridgePlayOpts } from './types';

const spriteLog = createNamedLogger('audio.sprite');

let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let atlas: Record<string, { start: number; end: number }> | null = null;
let discoveredMp3: string | null = null;
let discoveredJson: string | null = null;
let initPromise: Promise<boolean> | null = null;

const activeSources = new Set<AudioBufferSourceNode>();
const activeLoopHandles = new Set<FetchedLoopHandle>();

export interface FetchedLoopHandle {
  readonly id: number;
  setVolume(v: number): void;
  setPan(p: number): void;
  stop(): void;
  isActive(): boolean;
}

function ensureAudioContext(): AudioContext | null {
  if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
  const winRec = pageWindow as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = winRec.AudioContext ?? winRec.webkitAudioContext ?? (typeof AudioContext !== 'undefined' ? AudioContext : null);
  if (!Ctor) return null;
  try { audioCtx = new Ctor(); } catch { audioCtx = null; }
  return audioCtx;
}

export function discoverAudiospriteUrls(): { mp3: string; json: string } | null {
  let mp3: string | null = null;
  let json: string | null = null;
  try {
    const entries = performance.getEntriesByType('resource');
    for (const e of entries) {
      const url = e.name;
      if (!mp3 && /\/(?:runtime-assets|assets\/audio\/sfx)\/[^?#]*sfx[^?#]*\.mp3(?:\?|$)/i.test(url)) mp3 = url;
      if (!json && /\/audio\/sfx\/sfx\.json(?:\?|$)/i.test(url)) json = url;
    }
    if (!mp3) {
      for (const e of entries) { if (/\/sfx[^/?#]*\.mp3(?:\?|$)/i.test(e.name)) { mp3 = e.name; break; } }
    }
    if (!json) {
      for (const e of entries) { if (/\/sfx[^/?#]*(?:atlas|sprite)?\.json(?:\?|$)/i.test(e.name)) { json = e.name; break; } }
    }
  } catch (err) {
    spriteLog.debug('resource-timing scan failed', { error: String((err as Error)?.message ?? err) });
  }
  return mp3 && json ? { mp3, json } : null;
}

function extractAtlas(data: unknown): Record<string, { start: number; end: number }> | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  const candidates: unknown[] = [data, rec.spritemap, rec.sprites, rec.sprite, rec.map];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const keys = Object.keys(c as object);
    if (keys.length < 4) continue;
    const first = (c as Record<string, unknown>)[keys[0]!];
    if (first && typeof first === 'object'
        && typeof (first as Record<string, unknown>).start === 'number'
        && typeof (first as Record<string, unknown>).end === 'number') {
      return c as Record<string, { start: number; end: number }>;
    }
  }
  return null;
}

export function tryInitAudiosprite(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const urls = discoverAudiospriteUrls();
    if (!urls) { spriteLog.debug('no audiosprite URLs in resource timing'); return false; }
    const ctx = ensureAudioContext();
    if (!ctx) { spriteLog.debug('no AudioContext ctor'); return false; }
    try {
      const [jsonResp, mp3Resp] = await Promise.all([fetch(urls.json), fetch(urls.mp3)]);
      if (!jsonResp.ok || !mp3Resp.ok) {
        spriteLog.debug('fetch failed', { jsonOk: jsonResp.ok, mp3Ok: mp3Resp.ok });
        return false;
      }
      const jsonData = await jsonResp.json();
      const map = extractAtlas(jsonData);
      if (!map) { spriteLog.debug('atlas extract failed'); return false; }
      const buf = await mp3Resp.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      audioBuffer = decoded;
      atlas = map;
      discoveredMp3 = urls.mp3;
      discoveredJson = urls.json;
      return true;
    } catch (err) {
      spriteLog.debug('init threw', { error: String((err as Error)?.message ?? err) });
      return false;
    }
  })();
  return initPromise;
}

export function isFetchedReady(): boolean { return !!(audioBuffer && atlas); }
export function fetchedNames(): readonly string[] { return atlas ? Object.keys(atlas) : []; }
export function fetchedHas(name: string): boolean { return !!atlas && Object.prototype.hasOwnProperty.call(atlas, name); }

export function fetchedPlay(name: string, opts: BridgePlayOpts): boolean {
  if (!audioCtx || !audioBuffer || !atlas) return false;
  const sprite = atlas[name];
  if (!sprite) return false;
  if (audioCtx.state === 'suspended') { void audioCtx.resume().catch(() => { /* boundary */ }); }
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    const gain = audioCtx.createGain();
    gain.gain.value = clamp01(opts.volume ?? 1);
    let tail: AudioNode = gain;
    if (opts.pan !== undefined) {
      const panner = audioCtx.createStereoPanner();
      panner.pan.value = clamp(opts.pan, -1, 1);
      gain.connect(panner);
      tail = panner;
    }
    src.connect(gain);
    tail.connect(audioCtx.destination);
    activeSources.add(src);
    src.addEventListener('ended', () => activeSources.delete(src));
    const duration = Math.max(0, sprite.end - sprite.start);
    src.start(0, sprite.start, duration);
    return true;
  } catch (err) {
    spriteLog.debug('play threw', { name, error: String((err as Error)?.message ?? err) });
    return false;
  }
}

let LOOP_ID = 0;

export function fetchedStartLoop(name: string, opts: BridgePlayOpts): FetchedLoopHandle | null {
  if (!audioCtx || !audioBuffer || !atlas) return null;
  const sprite = atlas[name];
  if (!sprite) return null;
  if (audioCtx.state === 'suspended') { void audioCtx.resume().catch(() => { /* boundary */ }); }
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.loop = true;
    src.loopStart = sprite.start;
    src.loopEnd = sprite.end;
    const gain = audioCtx.createGain();
    gain.gain.value = clamp01(opts.volume ?? 1);
    let panner: StereoPannerNode | null = null;
    if (opts.pan !== undefined) {
      panner = audioCtx.createStereoPanner();
      panner.pan.value = clamp(opts.pan, -1, 1);
      src.connect(gain).connect(panner).connect(audioCtx.destination);
    } else {
      src.connect(gain).connect(audioCtx.destination);
    }
    src.start(0, sprite.start);
    const id = ++LOOP_ID;
    let active = true;
    const handle: FetchedLoopHandle = {
      id,
      setVolume: (v: number) => { if (active) gain.gain.value = clamp01(v); },
      setPan: (p: number) => { if (active && panner) panner.pan.value = clamp(p, -1, 1); },
      stop: () => {
        if (!active) return;
        active = false;
        try { src.stop(); } catch { /* boundary */ }
        activeLoopHandles.delete(handle);
      },
      isActive: () => active,
    };
    activeLoopHandles.add(handle);
    return handle;
  } catch (err) {
    spriteLog.debug('startLoop threw', { name, error: String((err as Error)?.message ?? err) });
    return null;
  }
}

export function fetchedStopAll(): void {
  for (const src of activeSources) { try { src.stop(); } catch { /* boundary */ } }
  activeSources.clear();
  for (const h of activeLoopHandles) { try { h.stop(); } catch { /* boundary */ } }
  activeLoopHandles.clear();
}

export function fetchedActiveCount(): number {
  let n = 0;
  for (const h of activeLoopHandles) if (h.isActive()) n++;
  return n + activeSources.size;
}

export function fetchedResumeContext(): void {
  if (audioCtx?.state === 'suspended') void audioCtx.resume().catch(() => { /* boundary */ });
}

export function fetchedDebugSnapshot(): { mp3: string | null; json: string | null; sfxCount: number; contextState: string | null } {
  return {
    mp3: discoveredMp3,
    json: discoveredJson,
    sfxCount: atlas ? Object.keys(atlas).length : 0,
    contextState: audioCtx?.state ?? null,
  };
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
