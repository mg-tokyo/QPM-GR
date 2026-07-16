// src/ui/shopRestockAlerts/soundEngine.ts
// Web Audio API synthesis + playback + loop management for restock alerts.
//
// Key design decisions (learned from Aries mod):
// - AudioContext must be primed on a user gesture before it can play.
// - Custom sounds use HTMLAudioElement (new Audio()) — simpler and more
//   reliable than fetch + decodeAudioData in a userscript context.
// - Webkit prefix fallback for older browsers.

import { criticalInterval } from '../../../utils/scheduling/timerManager';
import { pageWindow } from '../../../core/pageContext';
import { BUILTIN_SOUND_IDS } from './soundConfig';

// ---------------------------------------------------------------------------
// Audio context (lazy singleton + priming)
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
let primed = false;

type AudioContextCtor = typeof AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  const win = pageWindow as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? (typeof AudioContext !== 'undefined' ? AudioContext : null);
}

/**
 * Returns a ready-to-use AudioContext, creating and priming it if needed.
 * Must be called in response to a user gesture the first time.
 */
async function ensureAudioContext(): Promise<AudioContext | null> {
  if (audioCtx && audioCtx.state === 'closed') {
    audioCtx = null;
    primed = false;
  }

  if (!audioCtx) {
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch {
      /* browser refused AudioContext construction — caller degrades to no-sound */
      return null;
    }
  }

  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch {
      // Likely no user gesture yet — context stays suspended
    }
  }

  // Prime with a silent oscillator on the first use
  if (!primed && audioCtx.state === 'running') {
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.0001; // inaudible
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.02);
      primed = true;
    } catch {
      // Non-fatal — we'll try again next time
    }
  }

  return audioCtx;
}

/**
 * Synchronous getter for the AudioContext. Returns null if not yet created.
 * Prefer `ensureAudioContext()` for playback paths.
 */
function getAudioContextSync(): AudioContext | null {
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => { /* no user gesture yet — context stays suspended */ });
  }
  return audioCtx;
}

// ---------------------------------------------------------------------------
// Built-in sound synthesis
// ---------------------------------------------------------------------------

function synthPing(ctx: AudioContext, volume: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.16);
}

function synthChime(ctx: AudioContext, volume: number): void {
  const notes = [523.25, 659.25]; // C5, E5
  const noteDur = 0.2;
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = notes[i]!;
    const start = ctx.currentTime + i * noteDur;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + noteDur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + noteDur + 0.01);
  }
}

function synthBell(ctx: AudioContext, volume: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 440;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.51);
}

function synthAlert(ctx: AudioContext, volume: number): void {
  const notes = [440, 523.25, 659.25]; // A4, C5, E5
  const noteDur = 0.1;
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = notes[i]!;
    const start = ctx.currentTime + i * noteDur;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + noteDur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + noteDur + 0.01);
  }
}

function synthGentle(ctx: AudioContext, volume: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 330;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.31);
}

const SYNTH_MAP: Record<string, (ctx: AudioContext, volume: number) => void> = {
  ping: synthPing,
  chime: synthChime,
  bell: synthBell,
  alert: synthAlert,
  gentle: synthGentle,
};

// ---------------------------------------------------------------------------
// Public — one-shot playback
// ---------------------------------------------------------------------------

/**
 * Play a built-in synthesized sound. This is async because the AudioContext
 * may need to be created/resumed first.
 */
export async function playSound(soundId: string, volume = 0.7): Promise<void> {
  const fn = SYNTH_MAP[soundId];
  if (!fn) return;
  const ctx = await ensureAudioContext();
  if (!ctx || ctx.state !== 'running') return;
  try {
    fn(ctx, Math.max(0, Math.min(1, volume)));
  } catch {
    // Oscillator creation can fail in edge cases
  }
}

/**
 * Play a custom sound from a data URL using HTMLAudioElement.
 * More reliable in userscript contexts than Web Audio decodeAudioData.
 */
export async function playCustomSound(dataUrl: string, volume = 0.7): Promise<void> {
  try {
    const audio = new Audio();
    audio.src = dataUrl;
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.crossOrigin = 'anonymous';
    const playPromise = audio.play();
    if (playPromise) await playPromise.catch(() => { /* autoplay blocked — expected without user gesture */ });
  } catch {
    // Autoplay blocked or invalid audio data
  }
}

// ---------------------------------------------------------------------------
// Preview (called from UI on user click — guaranteed user gesture context)
// ---------------------------------------------------------------------------

export function previewSound(
  soundId: string,
  volume = 0.7,
  isCustom = false,
  dataUrl?: string,
): void {
  if (isCustom && dataUrl) {
    void playCustomSound(dataUrl, volume);
  } else {
    void playSound(soundId, volume);
  }
}

// ---------------------------------------------------------------------------
// Loop management
// ---------------------------------------------------------------------------

const DEFAULT_LOOP_MS = 3_000;
const activeLoops = new Map<string, () => void>();

interface LoopConfig {
  soundId: string;
  volume: number;
  isCustom: boolean;
  dataUrl?: string;
}

const loopConfigs = new Map<string, LoopConfig>();

export function startLoop(
  itemKey: string,
  soundId: string,
  volume = 0.7,
  isCustom = false,
  dataUrl?: string,
  intervalMs = DEFAULT_LOOP_MS,
): void {
  // Stop existing loop for this key if any
  stopLoop(itemKey);

  const config: LoopConfig = dataUrl !== undefined
    ? { soundId, volume, isCustom, dataUrl }
    : { soundId, volume, isCustom };
  loopConfigs.set(itemKey, config);

  const timerId = `restock-sound-loop-${itemKey}`;
  const stopFn = criticalInterval(timerId, () => {
    const cfg = loopConfigs.get(itemKey);
    if (!cfg) { stopLoop(itemKey); return; }
    if (cfg.isCustom && cfg.dataUrl) {
      void playCustomSound(cfg.dataUrl, cfg.volume);
    } else {
      void playSound(cfg.soundId, cfg.volume);
    }
  }, intervalMs);

  activeLoops.set(itemKey, stopFn);
}

export function stopLoop(itemKey: string): void {
  const stopFn = activeLoops.get(itemKey);
  if (stopFn) {
    stopFn();
    activeLoops.delete(itemKey);
  }
  loopConfigs.delete(itemKey);
}

export function stopAllLoops(): void {
  for (const [key, stopFn] of activeLoops) {
    stopFn();
    loopConfigs.delete(key);
  }
  activeLoops.clear();
}

export function isLooping(itemKey: string): boolean {
  return activeLoops.has(itemKey);
}

export function isBuiltinSound(soundId: string): boolean {
  return BUILTIN_SOUND_IDS.has(soundId);
}
