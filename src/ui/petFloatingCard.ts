// src/ui/petFloatingCard.ts
// Detached, draggable feed cards bound to active slot indexes.

import { storage } from '../utils/storage';
import { log } from '../utils/logger';
import {
  clampPct,
  pctToPixels as _pctToPixels,
  pixelsToPct as _pixelsToPct,
  clampPixels as _clampPixels,
} from '../utils/windowPosition';
import { getActivePetInfos, onActivePetInfos, type ActivePetInfo } from '../store/pets';
import { onInventoryChange } from '../store/inventory';
import {
  getInstantFeedPlan,
  getInstantFeedPlanByPetId,
  getInstantFeedPlanBySlotId,
  enqueueFeedBySlotId,
  enqueueFeedByPetId,
  enqueueFeed,
  getFeedQueueLength,
  onFeedQueueEvent,
  type InstantFeedPlan,
  type FeedQueueEvent,
} from '../features/instantFeed';
import { PET_FOOD_RULES_CHANGED_EVENT } from '../features/petFoodRules';
import { PET_FEED_POLICY_CHANGED_EVENT } from '../store/petTeams';
import { getFeedKeybind, setFeedKeybind, clearFeedKeybind } from '../features/feedKeybinds';
import { createKeybindButton, formatKeybind } from './petsWindow/helpers';
import {
  getCropSpriteDataUrl,
  getPetSpriteDataUrlWithMutations,
  isSpritesReady,
} from '../sprite-v2/compat';
import { sendRoomAction } from '../websocket/api';
import { getAtomByLabel, readAtomValue } from '../core/jotaiBridge';

const STORAGE_KEY = 'qpm.petFloatingCards.v1';
const FEED_EVENT = 'qpm:feedPet';
const FLOATING_CARD_STATE_EVENT = 'qpm:floating-card-state';
const MAX_SLOTS = 3;

/** Remembers last position per slot so reopening restores placement even after close. */
const lastKnownPositions = new Map<number, { xPct: number; yPct: number }>();

/** Resolve the player's current grid position (for pet greet). */
async function resolvePlayerPosition(): Promise<{ x: number; y: number } | null> {
  // Game stores position in a standalone positionAtom, not nested in playerAtom
  for (const label of ['positionAtom', 'playerAtom']) {
    const atom = getAtomByLabel(label);
    if (!atom) continue;
    const val = await readAtomValue<unknown>(atom).catch(() => null);
    if (!val || typeof val !== 'object') continue;
    const obj = val as Record<string, unknown>;
    // positionAtom is directly { x, y }; playerAtom may nest it under a key
    const candidates = 'x' in obj && 'y' in obj
      ? [obj]
      : [obj.position, obj.coords, obj.playerPosition].filter(Boolean);
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      const { x, y } = c as Record<string, unknown>;
      if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y))
        return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return null;
}

const STYLES = `
.qpm-float-card {
  position: fixed;
  background: rgba(18,20,26,0.96);
  border: 1px solid rgba(143,130,255,0.45);
  border-radius: 9px;
  width: 172px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.55);
  z-index: 999990;
  font-family: inherit;
  user-select: none;
  overflow: hidden;
}
.qpm-float-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: grab;
  background: rgba(143,130,255,0.08);
  border-bottom: 1px solid rgba(143,130,255,0.18);
}
.qpm-float-card__header:active { cursor: grabbing; }
.qpm-float-card__sprite-wrap {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  border-radius: 4px;
  transition: box-shadow 0.15s;
}
.qpm-float-card__sprite-wrap:hover {
  box-shadow: 0 0 0 1px rgba(143,130,255,0.3);
}
.qpm-float-card__sprite {
  width: 24px;
  height: 24px;
  image-rendering: pixelated;
  object-fit: contain;
}
.qpm-float-card__name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qpm-float-card__close {
  width: 18px;
  height: 18px;
  background: none;
  border: none;
  color: rgba(224,224,224,0.45);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
  transition: color 0.12s, background 0.12s;
}
.qpm-float-card__close:hover { color: #e0e0e0; background: rgba(255,255,255,0.1); }
.qpm-float-card__body {
  padding: 7px 9px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qpm-float-card__hunger {
  display: flex;
  align-items: center;
  gap: 6px;
}
.qpm-float-card__hunger-pct {
  font-size: 11px;
  color: rgba(224,224,224,0.55);
  min-width: 30px;
  text-align: right;
}
.qpm-float-card__hunger-track {
  flex: 1;
  height: 5px;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  overflow: hidden;
}
.qpm-float-card__hunger-fill {
  height: 100%;
  border-radius: 3px;
}
.qpm-float-card__feed-btn {
  width: 100%;
  background: rgba(143,130,255,0.2);
  border: 1px solid rgba(143,130,255,0.45);
  border-radius: 5px;
  color: #d0c8ff;
  font-size: 12px;
  font-weight: 500;
  min-height: 30px;
  padding: 5px 42px 5px 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}
.qpm-float-card__feed-btn:hover { background: rgba(143,130,255,0.35); }
.qpm-float-card__feed-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.qpm-float-card__feed-label { pointer-events: none; }
.qpm-float-card__food {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(143,130,255,0.09);
  border: 1px solid rgba(143,130,255,0.22);
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 10px;
  color: rgba(224,224,224,0.72);
  pointer-events: none;
}
.qpm-float-card__food--overlay {
  position: absolute;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
}
.qpm-float-card__food-icon {
  width: 10px;
  height: 10px;
  image-rendering: pixelated;
  object-fit: contain;
}
.qpm-float-card__food-fallback {
  font-size: 10px;
  min-width: 12px;
  text-align: center;
  color: rgba(224,224,224,0.82);
}
.qpm-float-card__food-count {
  font-weight: 700;
  color: #ecefff;
}
.qpm-float-card__no-pet {
  font-size: 11px;
  color: rgba(224,224,224,0.35);
  text-align: center;
  padding: 4px 0;
}
`;

/** Position stored as viewport-ratio (0–1). Survives any resize. */
interface PersistedFloatingCard {
  slotIndex: number;
  /** 0 = left edge, 1 = right edge (card fully visible). */
  xPct: number;
  /** 0 = top edge, 1 = bottom edge (card fully visible). */
  yPct: number;
}

interface PersistedFloatingCardsState {
  cards: PersistedFloatingCard[];
  updatedAt: number;
}

interface FloatingCardEntry {
  slotIndex: number;
  el: HTMLElement;
  /** Position as viewport ratio — the single source of truth. */
  position: { xPct: number; yPct: number };
  destroy: () => void;
  refreshAvailability: () => void;
}

const registry = new Map<number, FloatingCardEntry>();
let stylesInjected = false;
let initialized = false;

const CARD_W = 172;
const CARD_H_FALLBACK = 120;

function ensureStyles(): void {
  if (stylesInjected) return;
  const el = document.createElement('style');
  el.id = 'qpm-float-card-styles';
  el.textContent = STYLES;
  document.head.appendChild(el);
  stylesInjected = true;
}

function clampSlotIndex(slotIndex: number): number | null {
  if (!Number.isInteger(slotIndex)) return null;
  if (slotIndex < 0 || slotIndex >= MAX_SLOTS) return null;
  return slotIndex;
}

function getCardHeight(el: HTMLElement): number {
  return el.offsetHeight || CARD_H_FALLBACK;
}

/** Convert viewport ratios → pixel left/top, always within visible viewport. */
function pctToPixels(xPct: number, yPct: number, cardH: number): { x: number; y: number } {
  return _pctToPixels(xPct, yPct, CARD_W, cardH);
}

/** Convert pixel left/top → viewport ratios (0–1). */
function pixelsToPct(x: number, y: number, cardH: number): { xPct: number; yPct: number } {
  return _pixelsToPct(x, y, CARD_W, cardH);
}

/** Clamp pixel position so card stays fully on-screen. */
function clampPixels(x: number, y: number, cardH: number): { x: number; y: number } {
  return _clampPixels(x, y, CARD_W, cardH);
}

function getDefaultPct(slotIndex: number): { xPct: number; yPct: number } {
  const offset = slotIndex * 18;
  const x = window.innerWidth - 220 - offset;
  const y = Math.max(16, window.innerHeight - 190 - offset);
  return pixelsToPct(x, y, CARD_H_FALLBACK);
}

/** Set card position from ratios. */
function applyPctPosition(el: HTMLElement, xPct: number, yPct: number): void {
  const { x, y } = pctToPixels(xPct, yPct, getCardHeight(el));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

/** Set card position from pixels, clamped to viewport. Used during drag. */
function applyPixelPosition(el: HTMLElement, x: number, y: number): void {
  const c = clampPixels(x, y, getCardHeight(el));
  el.style.left = `${c.x}px`;
  el.style.top = `${c.y}px`;
}

/** Reposition all open cards from their stored ratios. Called on viewport resize. */
function handleViewportResize(): void {
  for (const entry of registry.values()) {
    applyPctPosition(entry.el, entry.position.xPct, entry.position.yPct);
  }
}

function loadPersistedState(): PersistedFloatingCardsState {
  const stored = storage.get<PersistedFloatingCardsState>(STORAGE_KEY, { cards: [], updatedAt: 0 });
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.cards)) {
    return { cards: [], updatedAt: 0 };
  }

  const cards = stored.cards
    .map((entry): PersistedFloatingCard | null => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const slotIndex = clampSlotIndex(Number(raw.slotIndex));
      if (slotIndex == null) return null;

      // New format: xPct / yPct (0–1 ratios)
      if (typeof raw.xPct === 'number' && typeof raw.yPct === 'number') {
        return { slotIndex, xPct: clampPct(raw.xPct), yPct: clampPct(raw.yPct) };
      }

      // Old format: absolute x / y pixels — migrate to ratios
      const x = Number(raw.x);
      const y = Number(raw.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const pct = pixelsToPct(x, y, CARD_H_FALLBACK);
      return { slotIndex, xPct: pct.xPct, yPct: pct.yPct };
    })
    .filter((entry): entry is PersistedFloatingCard => !!entry);

  return {
    cards,
    updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : 0,
  };
}

function persistRegistryState(): void {
  const cards: PersistedFloatingCard[] = [];
  for (const entry of registry.values()) {
    cards.push({
      slotIndex: entry.slotIndex,
      xPct: entry.position.xPct,
      yPct: entry.position.yPct,
    });
  }

  storage.set(STORAGE_KEY, {
    cards,
    updatedAt: Date.now(),
  } satisfies PersistedFloatingCardsState);
}

function emitFloatingCardStateChanged(slotIndex: number, open: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent(FLOATING_CARD_STATE_EVENT, {
      detail: { slotIndex, open },
    }));
  } catch {
    // no-op
  }
}

function getActivePetForSlot(slotIndex: number): ActivePetInfo | null {
  const active = getActivePetInfos();
  return active.find((pet) => pet.slotIndex === slotIndex) ?? null;
}

function resolveSlotByPetId(petId: string): number | null {
  const active = getActivePetInfos();
  const pet = active.find((entry) => entry.petId === petId);
  if (!pet) return null;
  return clampSlotIndex(pet.slotIndex);
}

function setSpriteContent(
  spriteWrap: HTMLElement,
  pet: ActivePetInfo | null,
): void {
  spriteWrap.innerHTML = '';

  if (pet?.species && isSpritesReady()) {
    const src = getPetSpriteDataUrlWithMutations(pet.species, pet.mutations ?? []);
    if (src) {
      const img = document.createElement('img');
      img.className = 'qpm-float-card__sprite';
      img.src = src;
      img.alt = pet.species;
      spriteWrap.appendChild(img);
      return;
    }
  }

  const fallback = document.createElement('span');
  fallback.textContent = '•';
  fallback.style.color = 'rgba(224,224,224,0.65)';
  fallback.style.fontSize = '13px';
  fallback.style.fontWeight = '700';
  spriteWrap.appendChild(fallback);
}

function setFoodCounter(
  iconWrap: HTMLElement,
  countEl: HTMLElement,
  foodKey: string | null,
  count: number,
): void {
  iconWrap.innerHTML = '';

  if (foodKey) {
    const sprite = getCropSpriteDataUrl(foodKey);
    if (sprite) {
      const img = document.createElement('img');
      img.className = 'qpm-float-card__food-icon';
      img.src = sprite;
      img.alt = foodKey;
      iconWrap.appendChild(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'qpm-float-card__food-fallback';
      fallback.textContent = foodKey.slice(0, 1).toUpperCase();
      iconWrap.appendChild(fallback);
    }
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'qpm-float-card__food-fallback';
    fallback.textContent = '-';
    iconWrap.appendChild(fallback);
  }

  countEl.textContent = `${Math.max(0, Math.floor(count))}`;
}

function createFloatingCard(slotIndex: number, initialPct?: { xPct: number; yPct: number }): FloatingCardEntry {
  ensureStyles();

  const cleanups: Array<() => void> = [];
  const card = document.createElement('div');
  card.className = 'qpm-float-card';

  const resolvedPct = initialPct ?? getDefaultPct(slotIndex);
  const intendedPos = { xPct: resolvedPct.xPct, yPct: resolvedPct.yPct };
  applyPctPosition(card, intendedPos.xPct, intendedPos.yPct);

  const header = document.createElement('div');
  header.className = 'qpm-float-card__header';

  const spriteWrap = document.createElement('div');
  spriteWrap.className = 'qpm-float-card__sprite-wrap';
  spriteWrap.addEventListener('click', async () => {
    if (!currentPet) return;
    const pos = await resolvePlayerPosition();
    if (!pos) return;
    sendRoomAction('RequestPetGreet', { position: pos }, { throttleMs: 2000 });
  });
  header.appendChild(spriteWrap);

  const nameEl = document.createElement('div');
  nameEl.className = 'qpm-float-card__name';
  header.appendChild(nameEl);

  // Feed keybind gear icon
  const gearBtn = document.createElement('button');
  gearBtn.type = 'button';
  gearBtn.style.cssText = 'background:none;border:none;font-size:11px;color:rgba(224,224,224,0.4);cursor:pointer;padding:2px;flex-shrink:0;transition:color 0.12s;';
  gearBtn.textContent = '\u2699';
  gearBtn.title = `Feed keybind: ${formatKeybind(getFeedKeybind(slotIndex)) || 'none'}`;
  let gearPopup: HTMLElement | null = null;
  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (gearPopup) {
      gearPopup.remove();
      gearPopup = null;
      return;
    }
    gearPopup = document.createElement('div');
    gearPopup.style.cssText = 'position:fixed;z-index:2147483647;background:rgba(14,17,25,0.98);border:1px solid rgba(143,130,255,0.35);border-radius:6px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,0.5);display:flex;align-items:center;gap:6px;font-size:11px;color:rgba(224,224,224,0.7);';
    gearPopup.textContent = 'Feed key: ';
    const kbBtn = createKeybindButton({
      onSet(combo) {
        setFeedKeybind(slotIndex, combo);
        gearBtn.title = `Feed keybind: ${formatKeybind(combo)}`;
        if (gearPopup) { gearPopup.remove(); gearPopup = null; }
      },
      onClear() {
        clearFeedKeybind(slotIndex);
        gearBtn.title = 'Feed keybind: none';
        if (gearPopup) { gearPopup.remove(); gearPopup = null; }
      },
      readCurrent: () => getFeedKeybind(slotIndex),
      width: '80px',
    });
    gearPopup.appendChild(kbBtn);
    document.body.appendChild(gearPopup);
    const rect = gearBtn.getBoundingClientRect();
    gearPopup.style.left = `${Math.max(8, Math.round(rect.left))}px`;
    gearPopup.style.top = `${Math.round(rect.bottom + 4)}px`;
    const closePopup = (ev: MouseEvent): void => {
      if (gearPopup && !gearPopup.contains(ev.target as Node) && ev.target !== gearBtn) {
        gearPopup.remove();
        gearPopup = null;
        document.removeEventListener('mousedown', closePopup, true);
      }
    };
    document.addEventListener('mousedown', closePopup, true);
    cleanups.push(() => {
      document.removeEventListener('mousedown', closePopup, true);
      if (gearPopup) { gearPopup.remove(); gearPopup = null; }
    });
  });
  gearBtn.addEventListener('mouseenter', () => { gearBtn.style.color = 'rgba(224,224,224,0.7)'; });
  gearBtn.addEventListener('mouseleave', () => { gearBtn.style.color = 'rgba(224,224,224,0.4)'; });
  header.appendChild(gearBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'qpm-float-card__close';
  closeBtn.textContent = 'x';
  closeBtn.title = 'Close floating card';
  header.appendChild(closeBtn);

  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'qpm-float-card__body';

  const hungerRow = document.createElement('div');
  hungerRow.className = 'qpm-float-card__hunger';
  const hungerPct = document.createElement('span');
  hungerPct.className = 'qpm-float-card__hunger-pct';
  const hungerTrack = document.createElement('div');
  hungerTrack.className = 'qpm-float-card__hunger-track';
  const hungerFill = document.createElement('div');
  hungerFill.className = 'qpm-float-card__hunger-fill';
  hungerTrack.appendChild(hungerFill);
  hungerRow.append(hungerPct, hungerTrack);
  body.appendChild(hungerRow);

  const feedBtn = document.createElement('button');
  feedBtn.className = 'qpm-float-card__feed-btn';
  const feedLabel = document.createElement('span');
  feedLabel.className = 'qpm-float-card__feed-label';
  feedLabel.textContent = 'Feed';
  feedBtn.appendChild(feedLabel);

  const foodCounter = document.createElement('div');
  foodCounter.className = 'qpm-float-card__food qpm-float-card__food--overlay';
  const foodIconWrap = document.createElement('span');
  const foodCount = document.createElement('span');
  foodCount.className = 'qpm-float-card__food-count';
  foodCounter.append(foodIconWrap, foodCount);
  feedBtn.appendChild(foodCounter);

  body.appendChild(feedBtn);

  const noPetMsg = document.createElement('div');
  noPetMsg.className = 'qpm-float-card__no-pet';
  noPetMsg.textContent = 'No active pet in this slot';
  noPetMsg.style.display = 'none';
  body.appendChild(noPetMsg);

  card.appendChild(body);
  document.body.appendChild(card);

  let destroyed = false;
  let currentPet: ActivePetInfo | null = null;
  let refreshSeq = 0;
  let lastMismatchSignature: string | null = null;
  let lastMismatchRetrySignature: string | null = null;

  const setFeedButtonState = (label: string, disabled: boolean): void => {
    feedLabel.textContent = label;
    feedBtn.disabled = disabled;
  };

  const renderPet = (pet: ActivePetInfo | null): void => {
    currentPet = pet;
    setSpriteContent(spriteWrap, pet);

    if (!pet) {
      nameEl.textContent = 'Empty slot';
      hungerRow.style.display = 'none';
      noPetMsg.style.display = '';
      feedBtn.style.display = 'none';
      foodCounter.style.display = 'none';
      return;
    }

    nameEl.textContent = pet.name || pet.species || 'Pet';
    noPetMsg.style.display = 'none';
    feedBtn.style.display = '';
    foodCounter.style.display = '';

    if (pet.hungerPct != null) {
      hungerRow.style.display = '';
      hungerPct.textContent = `${Math.round(pet.hungerPct)}%`;
      hungerFill.style.width = `${pet.hungerPct}%`;
      hungerFill.style.background = pet.hungerPct < 30
        ? '#ff6464'
        : pet.hungerPct < 60
          ? '#ffb464'
          : '#64ff96';
    } else {
      hungerRow.style.display = 'none';
    }
  };

  const refreshAvailability = async (): Promise<void> => {
    const seq = ++refreshSeq;
    if (destroyed) return;

    if (!currentPet) {
      setFoodCounter(foodIconWrap, foodCount, null, 0);
      setFeedButtonState('Feed', true);
      return;
    }

    try {
      let plan: InstantFeedPlan;
      if (currentPet.slotId) {
        plan = await getInstantFeedPlanBySlotId(currentPet.slotId);
      } else if (currentPet.petId) {
        plan = await getInstantFeedPlanByPetId(currentPet.petId);
      } else {
        plan = await getInstantFeedPlan(slotIndex);
      }
      if (destroyed || seq !== refreshSeq) return;

      const mismatch = (
        (currentPet.slotId && plan.slotId && currentPet.slotId !== plan.slotId) ||
        (currentPet.petId && plan.petId && currentPet.petId !== plan.petId)
      );
      if (mismatch) {
        const signature = `${currentPet.slotId ?? ''}|${currentPet.petId ?? ''}|${plan.slotId ?? ''}|${plan.petId ?? ''}`;
        if (signature !== lastMismatchSignature) {
          lastMismatchSignature = signature;
          log('[FloatingCard] identity mismatch while resolving feed plan', {
            slotIndex,
            current: {
              slotId: currentPet.slotId,
              petId: currentPet.petId,
              species: currentPet.species,
            },
            resolved: {
              slotId: plan.slotId,
              petId: plan.petId,
              species: plan.petSpecies,
            },
          });
        }
        if (signature !== lastMismatchRetrySignature) {
          lastMismatchRetrySignature = signature;
          window.setTimeout(() => {
            if (destroyed || seq !== refreshSeq) return;
            void refreshAvailability();
          }, 0);
        }
        return;
      } else {
        lastMismatchSignature = null;
        lastMismatchRetrySignature = null;
      }

      const selected = plan.foodSelection;
      const foodKey = selected?.item.species ?? selected?.item.name ?? null;
      setFoodCounter(foodIconWrap, foodCount, foodKey, plan.availableCount);

      const pending = getFeedQueueLength(slotIndex);
      if (pending > 0) {
        setFeedButtonState(`Feed (${pending})`, false);
      } else {
        const canFeed = !!plan.petId && !!selected && plan.availableCount > 0;
        setFeedButtonState('Feed', !canFeed);
        feedBtn.title = canFeed ? `Feed with ${foodKey ?? 'food'}` : (plan.error ?? 'No suitable food');
      }
    } catch {
      if (destroyed || seq !== refreshSeq) return;
      setFoodCounter(foodIconWrap, foodCount, null, 0);
      setFeedButtonState('Feed', true);
      feedBtn.title = 'Unable to evaluate food availability';
    }
  };

  const onPetChange = (pets: ActivePetInfo[]): void => {
    const pet = pets.find((entry) => entry.slotIndex === slotIndex) ?? null;
    renderPet(pet);
    void refreshAvailability();
  };

  const unsubscribePets = onActivePetInfos(onPetChange);
  cleanups.push(unsubscribePets);

  const unsubscribeInventory = onInventoryChange(() => {
    void refreshAvailability();
  });
  cleanups.push(unsubscribeInventory);

  const onRulesChanged = (): void => {
    void refreshAvailability();
  };
  window.addEventListener(PET_FOOD_RULES_CHANGED_EVENT, onRulesChanged as EventListener);
  cleanups.push(() => window.removeEventListener(PET_FOOD_RULES_CHANGED_EVENT, onRulesChanged as EventListener));
  window.addEventListener(PET_FEED_POLICY_CHANGED_EVENT, onRulesChanged as EventListener);
  cleanups.push(() => window.removeEventListener(PET_FEED_POLICY_CHANGED_EVENT, onRulesChanged as EventListener));

  const onFeedEvent = (): void => {
    void refreshAvailability();
  };
  window.addEventListener(FEED_EVENT, onFeedEvent as EventListener);
  cleanups.push(() => window.removeEventListener(FEED_EVENT, onFeedEvent as EventListener));

  feedBtn.addEventListener('click', () => {
    if (!currentPet) return;
    if (currentPet.slotId) {
      enqueueFeedBySlotId(currentPet.slotId);
    } else if (currentPet.petId) {
      enqueueFeedByPetId(currentPet.petId);
    } else {
      enqueueFeed(slotIndex);
    }
    const pending = getFeedQueueLength(slotIndex);
    if (pending > 0) {
      setFeedButtonState(`Feed (${pending})`, false);
    }
  });

  const unsubscribeQueue = onFeedQueueEvent((event: FeedQueueEvent) => {
    if (destroyed) return;
    if (event.type === 'drained') {
      void refreshAvailability();
      return;
    }
    if (event.slotIndex !== slotIndex) return;
    const pending = getFeedQueueLength(slotIndex);
    if (pending > 0) {
      setFeedButtonState(`Feed (${pending})`, false);
    } else {
      setFeedButtonState('Feed', false);
      void refreshAvailability();
    }
  });
  cleanups.push(unsubscribeQueue);

  let dragStartX = 0;
  let dragStartY = 0;
  let cardStartLeft = 0;
  let cardStartTop = 0;
  let isDragging = false;

  const onMouseDown = (event: MouseEvent): void => {
    if ((event.target as Element).closest('.qpm-float-card__close')) return;
    if ((event.target as Element).closest('.qpm-float-card__feed-btn')) return;
    if ((event.target as Element).closest('.qpm-float-card__sprite-wrap')) return;

    const rect = card.getBoundingClientRect();
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    cardStartLeft = rect.left;
    cardStartTop = rect.top;
    event.preventDefault();
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!isDragging) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    applyPixelPosition(card, cardStartLeft + dx, cardStartTop + dy);
  };

  const onMouseUp = (): void => {
    if (!isDragging) return;
    isDragging = false;
    // Read the clamped visual position and convert to viewport ratio.
    const rect = card.getBoundingClientRect();
    const pct = pixelsToPct(rect.left, rect.top, getCardHeight(card));
    intendedPos.xPct = pct.xPct;
    intendedPos.yPct = pct.yPct;
    lastKnownPositions.set(slotIndex, { xPct: pct.xPct, yPct: pct.yPct });
    persistRegistryState();
  };

  header.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  cleanups.push(() => {
    header.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    // Save position before removing so reopen restores it
    lastKnownPositions.set(slotIndex, { xPct: intendedPos.xPct, yPct: intendedPos.yPct });
    cleanups.forEach((fn) => fn());
    card.remove();
    registry.delete(slotIndex);
    persistRegistryState();
    emitFloatingCardStateChanged(slotIndex, false);
  };

  closeBtn.addEventListener('click', destroy);

  return {
    slotIndex,
    el: card,
    position: intendedPos,
    destroy,
    refreshAvailability: () => {
      void refreshAvailability();
    },
  };
}

function openFloatingCardInternal(slotIndex: number, initialPct?: { xPct: number; yPct: number }): void {
  if (registry.has(slotIndex)) {
    const existing = registry.get(slotIndex);
    if (existing) {
      existing.el.style.border = '1px solid rgba(143,130,255,0.9)';
      window.setTimeout(() => {
        if (existing.el.isConnected) {
          existing.el.style.border = '1px solid rgba(143,130,255,0.45)';
        }
      }, 450);
      existing.refreshAvailability();
    }
    return;
  }

  const entry = createFloatingCard(slotIndex, initialPct);
  registry.set(slotIndex, entry);
  persistRegistryState();
  emitFloatingCardStateChanged(slotIndex, true);
  entry.refreshAvailability();
  log(`[FloatingCard] Opened slot-bound card for slot ${slotIndex + 1}`);
}

function restorePersistedCards(): void {
  const persisted = loadPersistedState();
  for (const card of persisted.cards) {
    lastKnownPositions.set(card.slotIndex, { xPct: card.xPct, yPct: card.yPct });
    openFloatingCardInternal(card.slotIndex, { xPct: card.xPct, yPct: card.yPct });
  }
}

export function initFloatingCards(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener('resize', handleViewportResize);
  restorePersistedCards();
}

export function openFloatingCardForSlot(slotIndex: number): void {
  const normalized = clampSlotIndex(slotIndex);
  if (normalized == null) return;
  initFloatingCards();
  // Restore last known position (in-memory first, then persisted storage)
  const lastPos = lastKnownPositions.get(normalized);
  if (lastPos) {
    openFloatingCardInternal(normalized, lastPos);
    return;
  }
  const persisted = loadPersistedState();
  const saved = persisted.cards.find(c => c.slotIndex === normalized);
  openFloatingCardInternal(normalized, saved ? { xPct: saved.xPct, yPct: saved.yPct } : undefined);
}

export function closeFloatingCardForSlot(slotIndex: number): void {
  registry.get(slotIndex)?.destroy();
}

export function hasFloatingCardForSlot(slotIndex: number): boolean {
  return registry.has(slotIndex);
}

export function openFloatingCard(petId: string): void {
  const slotIndex = resolveSlotByPetId(petId);
  if (slotIndex == null) {
    log(`[FloatingCard] Pet ${petId} not found in active slots - cannot open slot-bound card`);
    return;
  }
  openFloatingCardForSlot(slotIndex);
}

export function closeFloatingCard(target: string | number): void {
  if (typeof target === 'number') {
    closeFloatingCardForSlot(target);
    return;
  }

  const slotIndex = resolveSlotByPetId(target);
  if (slotIndex == null) return;
  closeFloatingCardForSlot(slotIndex);
}

export function closeAllFloatingCards(): void {
  for (const entry of Array.from(registry.values())) {
    entry.destroy();
  }
}

export function hasFloatingCard(petId: string): boolean {
  const slotIndex = resolveSlotByPetId(petId);
  return slotIndex != null ? registry.has(slotIndex) : false;
}
