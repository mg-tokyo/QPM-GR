// src/ui/petFloatingCard/card.ts
// Detached, draggable feed cards bound to active slot indexes.

import { storage } from '../../utils/storage';
import { log } from '../../utils/logger';
import {
  clampPct,
  pctToPixels as _pctToPixels,
  pixelsToPct as _pixelsToPct,
  clampPixels as _clampPixels,
} from '../../utils/windowPosition';
import { getActivePetInfos, onActivePetInfos, type ActivePetInfo } from '../../store/pets';
import { onInventoryChange } from '../../store/inventory';
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
} from '../../features/instantFeed';
import { PET_FOOD_RULES_CHANGED_EVENT, type EligibleFoodEntry } from '../../features/petFoodRules';
import { PET_FEED_POLICY_CHANGED_EVENT } from '../../store/petTeams';
import { getFeedKeybind, setFeedKeybind, clearFeedKeybind } from '../../features/feedKeybinds';
import { createKeybindButton, formatKeybind } from '../petsWindow/helpers';
import {
  getCropSpriteDataUrl,
  getAnySpriteDataUrl,
  getPetSpriteDataUrlWithMutations,
  isSpritesReady,
} from '../../sprite-v2/compat';
import { HUNGER_POTION_KEY } from '../../features/hungerPotion';
import { sendRoomAction } from '../../websocket/api';
import { getPlayerPosition } from '../../utils/ghostStep';
import { normalizeSpeciesKey } from '../../utils/helpers';
import { getCropBaseSellPrice } from '../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../utils/cropMultipliers';
import type { FoodSelection } from '../../features/petFoodRules';
import { STYLES } from './styles';

const STORAGE_KEY = 'qpm.petFloatingCards.v1';
const FEED_EVENT = 'qpm:feedPet';
const FLOATING_CARD_STATE_EVENT = 'qpm:floating-card-state';
const MAX_SLOTS = 3;

/** Remembers last position per slot so reopening restores placement even after close. */
const lastKnownPositions = new Map<number, { xPct: number; yPct: number }>();

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
const CARD_W_MAX = 220;
const CARD_H_FALLBACK = 120;
const MAX_FOOD_PILLS = 6;

function ensureStyles(): void {
  if (stylesInjected) return;
  const el = document.createElement('style');
  el.id = 'qpm-float-card-styles';
  el.textContent = STYLES;
  document.head.appendChild(el);
  stylesInjected = true;
}

const clampSlotIndex = (si: number): number | null =>
  Number.isInteger(si) && si >= 0 && si < MAX_SLOTS ? si : null;

const getCardHeight = (el: HTMLElement): number => el.offsetHeight || CARD_H_FALLBACK;
const getCardWidth = (el: HTMLElement): number => Math.max(CARD_W, el.offsetWidth || CARD_W);

const pctToPixels = (xPct: number, yPct: number, cardW: number, cardH: number) => _pctToPixels(xPct, yPct, cardW, cardH);
const pixelsToPct = (x: number, y: number, cardW: number, cardH: number) => _pixelsToPct(x, y, cardW, cardH);
const clampPixels = (x: number, y: number, cardW: number, cardH: number) => _clampPixels(x, y, cardW, cardH);

function getDefaultPct(slotIndex: number): { xPct: number; yPct: number } {
  const off = slotIndex * 18;
  return pixelsToPct(window.innerWidth - 220 - off, Math.max(16, window.innerHeight - 190 - off), CARD_W, CARD_H_FALLBACK);
}

function applyPctPosition(el: HTMLElement, xPct: number, yPct: number): void {
  const { x, y } = pctToPixels(xPct, yPct, getCardWidth(el), getCardHeight(el));
  el.style.left = `${x}px`; el.style.top = `${y}px`;
}

function applyPixelPosition(el: HTMLElement, x: number, y: number): void {
  const c = clampPixels(x, y, getCardWidth(el), getCardHeight(el));
  el.style.left = `${c.x}px`; el.style.top = `${c.y}px`;
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
      const raw = entry as unknown as Record<string, unknown>;
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
      const pct = pixelsToPct(x, y, CARD_W, CARD_H_FALLBACK);
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
  try { window.dispatchEvent(new CustomEvent(FLOATING_CARD_STATE_EVENT, { detail: { slotIndex, open } })); } catch { /* no-op */ }
}

const getActivePetForSlot = (slotIndex: number): ActivePetInfo | null =>
  getActivePetInfos().find((pet) => pet.slotIndex === slotIndex) ?? null;

function resolveSlotByPetId(petId: string): number | null {
  const pet = getActivePetInfos().find((entry) => entry.petId === petId);
  return pet ? clampSlotIndex(pet.slotIndex) : null;
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
  fallback.textContent = '\u2022';
  fallback.style.color = 'rgba(224,224,224,0.65)';
  fallback.style.fontSize = '13px';
  fallback.style.fontWeight = '700';
  spriteWrap.appendChild(fallback);
}

function resolveFoodSprite(foodKey: string): string {
  // Hunger potion: try item sprite keys instead of crop sprites
  if (foodKey === HUNGER_POTION_KEY) {
    return getAnySpriteDataUrl('sprite/item/ReplenishPotion') ||
           getAnySpriteDataUrl('item/ReplenishPotion') || '';
  }
  return getCropSpriteDataUrl(foodKey);
}

function renderFoodCounters(
  container: HTMLElement,
  foods: EligibleFoodEntry[],
  selectedKey: string | null,
  labelEl?: HTMLElement,
): void {
  container.innerHTML = '';

  const overflowCount = foods.length > MAX_FOOD_PILLS ? foods.length - (MAX_FOOD_PILLS - 1) : 0;
  const visibleFoods = overflowCount > 0 ? foods.slice(0, MAX_FOOD_PILLS - 1) : foods;

  for (const food of visibleFoods) {
    const pill = document.createElement('div');
    pill.className = 'qpm-float-card__food';
    if (food.key === selectedKey) pill.dataset.selected = '1';
    const sprite = resolveFoodSprite(food.key);
    if (sprite) {
      const img = document.createElement('img');
      img.className = 'qpm-float-card__food-icon';
      img.src = sprite;
      img.alt = food.key;
      pill.appendChild(img);
    } else {
      const fb = document.createElement('span');
      fb.className = 'qpm-float-card__food-fallback';
      fb.textContent = food.key.slice(0, 1).toUpperCase();
      pill.appendChild(fb);
    }
    const countEl = document.createElement('span');
    countEl.className = 'qpm-float-card__food-count';
    countEl.textContent = String(Math.max(0, food.count));
    pill.appendChild(countEl);

    // Hidden +N% label — only populated on the selected food's pill
    const preview = document.createElement('span');
    preview.className = 'qpm-float-card__feed-preview';
    pill.appendChild(preview);

    container.appendChild(pill);
  }

  // Overflow indicator when >MAX_FOOD_PILLS foods
  if (overflowCount > 0) {
    const overflowPill = document.createElement('div');
    overflowPill.className = 'qpm-float-card__food';
    const overflowLabel = document.createElement('span');
    overflowLabel.className = 'qpm-float-card__food-count';
    overflowLabel.textContent = `+${overflowCount}`;
    overflowPill.appendChild(overflowLabel);
    container.appendChild(overflowPill);
  }

  // Hide "Feed" label when 3+ counters to avoid cramping
  if (labelEl) labelEl.style.display = visibleFoods.length >= 3 ? 'none' : '';
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
    const pos = await getPlayerPosition();
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
  const hungerPreviewFill = document.createElement('div');
  hungerPreviewFill.className = 'qpm-float-card__hunger-preview';
  hungerTrack.appendChild(hungerFill);
  hungerTrack.appendChild(hungerPreviewFill);
  hungerRow.append(hungerPct, hungerTrack);
  body.appendChild(hungerRow);

  const feedBtn = document.createElement('button');
  feedBtn.className = 'qpm-float-card__feed-btn';
  const feedLabel = document.createElement('span');
  feedLabel.className = 'qpm-float-card__feed-label';
  feedLabel.textContent = 'Feed';
  feedBtn.appendChild(feedLabel);

  const foodCountersRow = document.createElement('div');
  foodCountersRow.className = 'qpm-float-card__food-row';
  feedBtn.appendChild(foodCountersRow);

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
  let feedHovered = false;
  /** The FoodSelection that will actually be fed on next click. Updated by refreshAvailability. */
  let selectedFood: FoodSelection | null = null;

  /** Compute the actual sell price of the selected food item (baseSellPrice × scale × mutationMultiplier). */
  const computeSelectedCoinValue = (): number => {
    if (!selectedFood) return 0;
    if (selectedFood.isHungerPotion) return Infinity;
    const item = selectedFood.item;
    const species = item.species;
    if (!species) return 0;
    const baseSellPrice = getCropBaseSellPrice(species);
    if (baseSellPrice == null || baseSellPrice <= 0) return 0;
    const scale = item.scale ?? 1;
    const { totalMultiplier } = computeMutationMultiplier(item.mutations);
    return Math.round(baseSellPrice * scale * totalMultiplier);
  };


  /** Compute the hunger gain % for the selected food based on its actual sell price and the pet's hungerMax. */
  const computeSelectedGainPct = (): number => {
    if (!currentPet || currentPet.hungerPct == null || !selectedFood) return 0;
    const remaining = Math.round(100 - currentPet.hungerPct);
    if (remaining <= 0) return 0;
    if (selectedFood.isHungerPotion) return remaining;
    const hungerMax = currentPet.hungerMax;
    const coinValue = computeSelectedCoinValue();
    if (hungerMax == null || hungerMax <= 0 || coinValue <= 0) return 0;
    return Math.min(Math.round((coinValue / hungerMax) * 100), remaining);
  };

  /** Show the +N% preview on the selected pill and the hunger bar preview. */
  const reapplyHoverPreview = (): void => {
    if (!feedHovered || !currentPet || currentPet.hungerPct == null || currentPet.hungerPct >= 100 || feedBtn.disabled) return;
    const selectedPill = foodCountersRow.querySelector('.qpm-float-card__food[data-selected]');
    const previewEl = selectedPill?.querySelector('.qpm-float-card__feed-preview') as HTMLElement | null;
    if (!previewEl) return;
    const gainPct = computeSelectedGainPct();
    if (gainPct <= 0) return;
    previewEl.textContent = `+${gainPct}%`;
    previewEl.style.opacity = '1';
    hungerPreviewFill.style.left = `${currentPet.hungerPct}%`;
    hungerPreviewFill.style.width = `${gainPct}%`;
    hungerPreviewFill.style.opacity = '1';
  };

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
      return;
    }

    nameEl.textContent = pet.name || pet.species || 'Pet';
    noPetMsg.style.display = 'none';
    feedBtn.style.display = '';

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
      selectedFood = null;
      renderFoodCounters(foodCountersRow, [], null, feedLabel);
      card.style.width = '';
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
      selectedFood = selected;
      const rawFoodKey = selected?.item.species ?? selected?.item.name ?? null;
      const foodKey = rawFoodKey ? normalizeSpeciesKey(rawFoodKey) : null;
      renderFoodCounters(foodCountersRow, plan.eligibleFoods, foodKey, feedLabel);

      // Measure food row after paint and expand card width if pills overflow
      requestAnimationFrame(() => {
        if (destroyed || seq !== refreshSeq) return;
        const overflow = foodCountersRow.scrollWidth - foodCountersRow.clientWidth;
        if (overflow > 2) {
          const currentW = card.offsetWidth;
          const needed = Math.min(currentW + overflow + 4, CARD_W_MAX);
          card.style.width = `${needed}px`;
        } else {
          card.style.width = '';
        }
      });

      const pending = getFeedQueueLength(slotIndex);
      if (pending > 0) {
        setFeedButtonState(`Feed (${pending})`, false);
      } else {
        const canFeed = !!plan.petId && !!selected && plan.availableCount > 0;
        setFeedButtonState('Feed', !canFeed);
        feedBtn.title = canFeed ? `Feed with ${rawFoodKey ?? 'food'}` : (plan.error ?? 'No suitable food');
      }
      reapplyHoverPreview();
    } catch {
      if (destroyed || seq !== refreshSeq) return;
      selectedFood = null;
      renderFoodCounters(foodCountersRow, [], null, feedLabel);
      card.style.width = '';
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

  // Hover preview: show +N% on selected food pill and green preview bar on hunger track
  feedBtn.addEventListener('mouseenter', () => {
    feedHovered = true;
    reapplyHoverPreview();
  });
  feedBtn.addEventListener('mouseleave', () => {
    feedHovered = false;
    const selectedPill = foodCountersRow.querySelector('.qpm-float-card__food[data-selected]');
    const previewEl = selectedPill?.querySelector('.qpm-float-card__feed-preview') as HTMLElement | null;
    if (previewEl) {
      previewEl.style.opacity = '0';
      previewEl.textContent = '';
    }
    hungerPreviewFill.style.width = '0';
    hungerPreviewFill.style.opacity = '0';
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
    const pct = pixelsToPct(rect.left, rect.top, getCardWidth(card), getCardHeight(card));
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
