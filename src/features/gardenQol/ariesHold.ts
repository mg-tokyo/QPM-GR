// src/features/gardenQol/ariesHold.ts
// Rapid-fire hold mode: holding Space rapidly simulates pressing it at N Hz.
// Replicates the Aries mod "Hold to repeat" feature for all game actions
// (planting, harvesting, interacting, collecting, etc.).

import { pageWindow } from '../../core/pageContext';
import { readAtomValueSync } from '../../core/atomRegistry';
import { getGardenQolConfig } from './state';
import type { HoldContexts } from './types';

// ── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_RATE_HZ = 10;
const KEYUP_DELAY_MS = 20;        // keydown → keyup gap per tap
const SYN_FLAG = '__qpm_rapid_syn__';
const SPACE_KEYCODE = 32;

// ── State ──────────────────────────────────────────────────────────────────

let listening = false;
let held = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let upTimer: ReturnType<typeof setTimeout> | null = null;
let lastTarget: EventTarget | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

// ── Synthetic event dispatch ──────────────────────────────────────────────

function dispatchKey(type: 'keydown' | 'keyup', repeat: boolean): void {
  const target = lastTarget || pageWindow.document;
  // Use the page window's KeyboardEvent constructor for correct realm
  const EventCtor = (pageWindow as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const ev = new EventCtor(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: ' ',
    code: 'Space',
    repeat,
  });

  // Legacy properties (some game handlers check keyCode/which)
  Object.defineProperties(ev, {
    keyCode:  { get: () => SPACE_KEYCODE },
    which:    { get: () => SPACE_KEYCODE },
    charCode: { get: () => SPACE_KEYCODE },
    [SYN_FLAG]: { value: true },
  });

  try {
    (target as Node).dispatchEvent(ev);
  } catch {
    pageWindow.document.dispatchEvent(ev);
  }
}

// ── Action context detection ──────────────────────────────────────────────

function getActionContext(): keyof HoldContexts {
  const action = readAtomValueSync('action');
  if (typeof action !== 'string' || action.length === 0) return 'other';

  const lower = action.toLowerCase();
  if (lower === 'harvest' || lower === 'rainbowharvest' || lower === 'goldharvest') return 'harvest';
  if (lower === 'plant' || lower === 'plantseed') return 'plant';
  if (lower === 'removegardenobject' || lower === 'shovel' || lower === 'dig' || lower === 'remove') return 'shovel';
  if (lower === 'sell' || lower === 'sellpet' || lower === 'sellallcrops') return 'sell';
  if (lower === 'hatch' || lower === 'hatchegg') return 'hatch';
  return 'other';
}

// ── Rapid-fire loop ──────────────────────────────────────────────────────

function tick(): void {
  if (!held) return;
  const config = getGardenQolConfig();
  // Stop immediately if the user toggled the setting off mid-hold
  if (!config.ariesHold) {
    held = false;
    stopLoop();
    return;
  }
  // Per-context hold check: skip tick if the current action context is disabled
  const context = getActionContext();
  if (!config.holdContexts[context]) return;

  dispatchKey('keydown', true);
  if (upTimer != null) clearTimeout(upTimer);
  upTimer = setTimeout(() => {
    dispatchKey('keyup', false);
    upTimer = null;
  }, KEYUP_DELAY_MS);
}

function startLoop(): void {
  stopLoop();
  tick(); // first tick fires immediately (matches Aries behavior)
  const rateHz = getGardenQolConfig().holdRateHz || DEFAULT_RATE_HZ;
  const rateMs = 1000 / rateHz;
  tickTimer = setInterval(tick, rateMs);
}

function stopLoop(): void {
  if (tickTimer != null) { clearInterval(tickTimer); tickTimer = null; }
  if (upTimer != null) { clearTimeout(upTimer); upTimer = null; }
}

// ── Event handlers ──────────────────────────────────────────────────────

function onKeyDown(event: KeyboardEvent): void {
  // Skip our own synthetic events
  if ((event as unknown as Record<string, unknown>)[SYN_FLAG]) return;
  if (event.code !== 'Space') return;
  if (event.repeat) return;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (isTextInputFocused()) return;
  if (!getGardenQolConfig().ariesHold) return;

  held = true;
  lastTarget = event.target;
  startLoop();
}

function onKeyUp(event: KeyboardEvent): void {
  if ((event as unknown as Record<string, unknown>)[SYN_FLAG]) return;
  if (event.code !== 'Space') return;
  if (!held) return;
  held = false;
  stopLoop();
}

function onBlur(): void {
  if (!held) return;
  held = false;
  stopLoop();
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

export function startAriesHold(): void {
  if (listening) return;
  listening = true;
  // Register in capture phase on the PAGE window (not sandbox window),
  // BEFORE instaHarvest to track held state before instaHarvest may
  // stopImmediatePropagation for qualifying plants.
  const pw = pageWindow as unknown as Window;
  pw.addEventListener('keydown', onKeyDown as EventListener, true);
  pw.addEventListener('keyup', onKeyUp as EventListener, true);
  pw.addEventListener('blur', onBlur);
}

export function stopAriesHold(): void {
  if (!listening) return;
  listening = false;
  held = false;
  stopLoop();
  const pw = pageWindow as unknown as Window;
  pw.removeEventListener('keydown', onKeyDown as EventListener, true);
  pw.removeEventListener('keyup', onKeyUp as EventListener, true);
  pw.removeEventListener('blur', onBlur);
  lastTarget = null;
}
