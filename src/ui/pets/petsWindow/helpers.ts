// Shared UI helpers for the pets window.

import { getAnySpriteDataUrl } from '../../../sprite-v2/compat';
import { calculatePetScore, type CollectedPet } from '../../../features/pets/optimizer';
import { calculateMaxStrength } from '../../../store/xpTracker';
import { getAbilityDefinition } from '../../../features/pets/data/petAbilities';
import type { PooledPet } from '../../../types/petTeams';
import { IS_MAC, IS_OPERA } from './constants';
import { t } from '../../../i18n';

// ---------------------------------------------------------------------------
// Button helper
// ---------------------------------------------------------------------------

export function btn(label: string, variant: 'default' | 'primary' | 'danger' | 'sm' = 'default', extraClass = ''): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = `qpm-btn${variant === 'primary' ? ' qpm-btn--primary' : variant === 'danger' ? ' qpm-btn--danger' : variant === 'sm' ? ' qpm-btn--sm' : ''} ${extraClass}`.trim();
  el.textContent = label;
  return el;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999999;
    background:${type === 'error' ? 'rgba(244,67,54,0.9)' : type === 'success' ? 'rgba(76,175,80,0.9)' : 'rgba(18,20,26,0.95)'};
    border:1px solid ${type === 'error' ? 'rgba(244,67,54,0.5)' : type === 'success' ? 'rgba(76,175,80,0.5)' : 'rgba(143,130,255,0.4)'};
    color:#fff; border-radius:8px; padding:10px 16px; font-size:13px;
    box-shadow:0 4px 16px rgba(0,0,0,0.5); max-width:320px;
  `;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------------------
// Keybind utilities
// ---------------------------------------------------------------------------

export function canonicalKeyFromEvent(e: KeyboardEvent): string {
  const code = e.code || '';
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();

  switch (code) {
    case 'Space': return 'space';
    case 'Minus': return '-';
    case 'Equal': return '=';
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    case 'Backslash': return '\\';
    case 'Semicolon': return ';';
    case 'Quote': return '\'';
    case 'Backquote': return '`';
    case 'Comma': return ',';
    case 'Period': return '.';
    case 'Slash': return '/';
    case 'ArrowUp': return 'arrowup';
    case 'ArrowDown': return 'arrowdown';
    case 'ArrowLeft': return 'arrowleft';
    case 'ArrowRight': return 'arrowright';
    case 'Enter': return 'enter';
    case 'Tab': return 'tab';
    case 'Escape': return 'escape';
    case 'Backspace': return 'backspace';
    case 'Delete': return 'delete';
    case 'Home': return 'home';
    case 'End': return 'end';
    case 'PageUp': return 'pageup';
    case 'PageDown': return 'pagedown';
    case 'Insert': return 'insert';
    default: {
      const key = e.key.toLowerCase();
      return key.length > 0 ? key : '';
    }
  }
}

export function normalizeKeybind(e: KeyboardEvent): string {
  const SKIP = ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Dead', 'Unidentified'];
  if (SKIP.includes(e.key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  const key = canonicalKeyFromEvent(e);
  if (!key) return '';
  parts.push(key);
  return parts.join('+');
}

export function formatKeybind(combo: string): string {
  if (!combo) return '';
  return combo.split('+').map(p => {
    if (p === 'ctrl') return IS_MAC ? '\u2318' : 'Ctrl';
    if (p === 'alt') return IS_MAC ? '\u2325' : 'Alt';
    if (p === 'shift') return IS_MAC ? '\u21E7' : 'Shift';
    if (p === 'space') return 'Space';
    if (p.startsWith('arrow')) return p.replace('arrow', 'Arrow ');
    if (p.length > 1 && p.startsWith('f') && /^f\d{1,2}$/.test(p)) return p.toUpperCase();
    return p.length === 1 ? p.toUpperCase() : p;
  }).join(IS_MAC ? '' : '+');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  ) {
    return true;
  }
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

/** Bare keys that Opera GX "Advanced keyboard shortcuts" intercepts at the browser level. */
const OPERA_GX_CONFLICT_KEYS = new Set(['1', '2', '6', '7', '8', '9', '0', 'z', 'x', '/']);

export function hasModifier(combo: string): boolean {
  return combo.includes('ctrl+') || combo.includes('alt+') || combo.includes('shift+');
}

export function isOperaConflict(combo: string): boolean {
  return !hasModifier(combo) && OPERA_GX_CONFLICT_KEYS.has(combo);
}

/**
 * Create a keybind capture button.  Uses a `<button>` instead of `<input>`
 * because Opera GX routes keyboard events through its text-input pipeline
 * for `<input>` elements, which can silently swallow keydown events.
 * A `<button>` is a plain focusable element with no text-input semantics,
 * so keyboard events reach the DOM event system normally.
 */
export function createKeybindButton(
  opts: {
    onSet: (combo: string) => void;
    onClear: () => void;
    readCurrent: () => string;
    width?: string;
  },
): HTMLButtonElement {
  const kbBtn = document.createElement('button');
  kbBtn.type = 'button';
  kbBtn.className = 'qpm-keybind-input';
  if (opts.width) kbBtn.style.width = opts.width;

  let recording = false;
  let stopCapture: (() => void) | null = null;
  let noKeyTimer: ReturnType<typeof setTimeout> | null = null;

  function display(): void {
    const fresh = opts.readCurrent();
    kbBtn.textContent = fresh ? formatKeybind(fresh) : '\u2014'; // em dash
    kbBtn.style.color = '';
  }

  function stopRecording(): void {
    recording = false;
    stopCapture?.();
    if (noKeyTimer) { clearTimeout(noKeyTimer); noKeyTimer = null; }
    display();
  }

  const onCapturedKey = (e: KeyboardEvent): void => {
    if (!recording) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (noKeyTimer) { clearTimeout(noKeyTimer); noKeyTimer = null; }

    if (e.key === 'Escape') { stopRecording(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      opts.onClear();
      stopRecording();
      return;
    }
    const combo = normalizeKeybind(e);
    if (!combo) return;

    // Warn on Opera GX bare-key conflicts (only on Opera/Opera GX)
    if (IS_OPERA && isOperaConflict(combo)) {
      kbBtn.textContent = t('feature.petsWindow.operaBlocked', { combo: formatKeybind(combo) });
      kbBtn.style.color = '#f87171';
      setTimeout(() => {
        if (!recording) return;
        kbBtn.textContent = t('feature.petsWindow.tryModifierKey');
        kbBtn.style.color = '#fbbf24';
      }, 2000);
      return;
    }

    opts.onSet(combo);
    stopRecording();
  };

  kbBtn.addEventListener('click', () => {
    if (recording) { stopRecording(); return; }
    recording = true;
    kbBtn.textContent = t('feature.petsWindow.pressKey');
    kbBtn.style.color = '';

    stopCapture?.();
    window.addEventListener('keydown', onCapturedKey, true);
    stopCapture = () => {
      window.removeEventListener('keydown', onCapturedKey, true);
      stopCapture = null;
    };

    // Timeout: if no key arrives within 3 s, show guidance
    noKeyTimer = setTimeout(() => {
      noKeyTimer = null;
      if (!recording) return;
      kbBtn.textContent = IS_OPERA
        ? t('feature.petsWindow.noKeyDetectedOpera')
        : t('feature.petsWindow.noKeyDetected');
      kbBtn.style.color = '#fbbf24';
    }, 3000);
  });

  // Stop recording if button loses focus (e.g. user clicks elsewhere)
  kbBtn.addEventListener('blur', () => { if (recording) stopRecording(); });

  display();
  return kbBtn;
}

// ---------------------------------------------------------------------------
// Coin sprite URL (shared by teamSummary and comparisonPanel)
// ---------------------------------------------------------------------------

let coinSpriteUrlCache: string | null = null;

export function getCoinSpriteUrl(): string | null {
  if (coinSpriteUrlCache) return coinSpriteUrlCache;
  const url = getAnySpriteDataUrl('sprite/ui/Coin');
  if (url) coinSpriteUrlCache = url;
  return coinSpriteUrlCache;
}

let ageSpriteUrlCache: string | null = null;

export function getAgeSpriteUrl(): string | null {
  if (ageSpriteUrlCache) return ageSpriteUrlCache;
  const url = getAnySpriteDataUrl('sprite/ui/Age');
  if (url) ageSpriteUrlCache = url;
  return ageSpriteUrlCache;
}

// ---------------------------------------------------------------------------
// Team score computation (shared by teamList and teamEditor)
// ---------------------------------------------------------------------------

function pooledToCollected(pooledPet: PooledPet): CollectedPet {
  return {
    id: pooledPet.id,
    itemId: pooledPet.id,
    name: pooledPet.name,
    species: pooledPet.species,
    location: pooledPet.location,
    slotIndex: pooledPet.slotIndex ?? -1,
    strength: pooledPet.strength ?? 0,
    maxStrength: pooledPet.species && pooledPet.targetScale
      ? calculateMaxStrength(pooledPet.targetScale, pooledPet.species)
      : null,
    targetScale: pooledPet.targetScale,
    xp: pooledPet.xp,
    level: pooledPet.level,
    abilities: pooledPet.abilities,
    abilityIds: pooledPet.abilities.map(a => getAbilityDefinition(a)?.id ?? a),
    mutations: pooledPet.mutations,
    hasGold: pooledPet.mutations.some(m => m.toLowerCase().includes('gold')),
    hasRainbow: pooledPet.mutations.some(m => m.toLowerCase().includes('rainbow')),
    raw: null,
  };
}

export function computeTeamScore(teamSlots: Array<string | null>, petPool: PooledPet[]): number {
  let total = 0;
  for (const slotId of teamSlots) {
    if (!slotId) continue;
    const pooledPet = petPool.find(p => p.id === slotId);
    if (!pooledPet || !pooledPet.species) continue;
    const score = calculatePetScore(pooledToCollected(pooledPet));
    total += score.total;
  }
  return total;
}

export function computePetScore(
  slotId: string,
  petPool: PooledPet[],
): { total: number; granterBonus: number; granterType: 'rainbow' | 'gold' | null } | null {
  const pooledPet = petPool.find(p => p.id === slotId);
  if (!pooledPet || !pooledPet.species) return null;
  const score = calculatePetScore(pooledToCollected(pooledPet));
  return { total: score.total, granterBonus: score.granterBonus, granterType: score.granterType };
}
