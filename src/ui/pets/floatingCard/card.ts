// src/ui/pets/floatingCard/card.ts
// Detached, draggable feed cards bound to active slot indexes.
//
// Drag/persistence/clamp/registry mechanics live in the reusable shell at
// src/ui/components/floatingCard/. This file owns only the feed-card body
// (sprite, hunger bar, food pills, Feed button, Mount button) and the
// subscriptions that drive it.

import { storage } from '../../../utils/storage';
import { log } from '../../../utils/logger';
import { pixelsToPct } from '../../../utils/windowPosition';
import { getActivePetInfos, onActivePetInfos, type ActivePetInfo } from '../../../store/pets';
import { onInventoryChange } from '../../../store/inventory';
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
} from '../../../features/pets/instantFeed';
import { PET_FOOD_RULES_CHANGED_EVENT } from '../../../features/pets/foodRules';
import { PET_FEED_POLICY_CHANGED_EVENT } from '../../../store/petTeams';
import { getAnySpriteDataUrl, isSpritesReady } from '../../../sprite-v2/compat';
import { sendRoomAction } from '../../../websocket/api';
import { getRiddenPetId, onRiddenPetChange, ridePet, dismountPet } from '../../../store/mountState';
import { getPlayerPosition } from '../../../utils/ghostStep';
import { normalizeSpeciesKey } from '../../../utils/helpers';
import { getCropBaseSellPrice } from '../../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../../utils/game/cropMultipliers';
import type { FoodSelection } from '../../../features/pets/foodRules';
import {
  openFloatingCard as openShellCard,
  closeFloatingCard as closeShellCard,
  hasFloatingCard as hasShellCard,
  getPersistedFloatingCards,
  seedSessionPositions,
  type FloatingCardEntry,
} from '../../components/floatingCard';
import { STYLES } from './styles';
import { setSpriteContent, renderFoodCounters } from './bodyRenderers';
import { createFeedKeybindGearButton } from './gearButton';

const STORAGE_KEY = 'qpm.petFloatingCards.v1';
const FEED_EVENT = 'qpm:feedPet';
const FLOATING_CARD_STATE_EVENT = 'qpm:floating-card-state';
const MAX_SLOTS = 3;

const CARD_W = 172;
const CARD_W_MAX = 220;
const CARD_H_FALLBACK = 120;

const REFRESH_COALESCE_MS = 400;

function computeSpriteSignature(pet: ActivePetInfo | null): string {
  const readyFlag = isSpritesReady() ? 'r' : 'w';
  if (!pet) return `null|${readyFlag}`;
  return `${pet.species ?? ''}|${pet.mutations.join(',')}|${readyFlag}`;
}

function computePetIdentitySignature(pet: ActivePetInfo | null): string {
  if (!pet) return 'null';
  return `${pet.slotId ?? ''}|${pet.petId ?? ''}|${pet.species ?? ''}|${pet.mutations.join(',')}|${pet.chargedAbilityId ?? ''}`;
}

const DRAG_EXCLUDE_SELECTORS: readonly string[] = [
  '.qpm-float-card__close',
  '.qpm-float-card__feed-btn',
  '.qpm-float-card__sprite-wrap',
];

interface SlotEntry {
  slotIndex: number;
  shell: FloatingCardEntry;
  refreshAvailability: () => void;
}

const slotEntries = new Map<number, SlotEntry>();
let stylesInjected = false;
let initialized = false;

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

const slotKey = (slotIndex: number): string => String(slotIndex);

function slotIndexFromKey(key: string): number | null {
  const n = Number(key);
  return Number.isInteger(n) ? clampSlotIndex(n) : null;
}

function getDefaultPct(slotIndex: number): { xPct: number; yPct: number } {
  const off = slotIndex * 18;
  return pixelsToPct(
    window.innerWidth - 220 - off,
    Math.max(16, window.innerHeight - 190 - off),
    CARD_W,
    CARD_H_FALLBACK,
  );
}

function emitFloatingCardStateChanged(slotIndex: number, open: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent(FLOATING_CARD_STATE_EVENT, { detail: { slotIndex, open } }));
  } catch { /* no-op */ }
}

const getActivePetForSlot = (slotIndex: number): ActivePetInfo | null =>
  getActivePetInfos().find((pet) => pet.slotIndex === slotIndex) ?? null;

function resolveSlotByPetId(petId: string): number | null {
  const pet = getActivePetInfos().find((entry) => entry.petId === petId);
  return pet ? clampSlotIndex(pet.slotIndex) : null;
}

function createSlotCard(slotIndex: number): SlotEntry {
  ensureStyles();

  const cleanups: Array<() => void> = [];

  // ─── Header ──────────────────────────────────────────────────────────────
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

  const gearBtnHandle = createFeedKeybindGearButton(slotIndex);
  header.appendChild(gearBtnHandle.el);
  cleanups.push(() => gearBtnHandle.dispose());

  const closeBtn = document.createElement('button');
  closeBtn.className = 'qpm-float-card__close';
  closeBtn.textContent = 'x';
  closeBtn.title = 'Close floating card';
  closeBtn.addEventListener('click', () => closeFloatingCardForSlot(slotIndex));
  header.appendChild(closeBtn);

  // ─── Body ────────────────────────────────────────────────────────────────
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

  const btnRow = document.createElement('div');
  btnRow.className = 'qpm-float-card__btn-row';
  btnRow.appendChild(feedBtn);
  body.appendChild(btnRow);

  const noPetMsg = document.createElement('div');
  noPetMsg.className = 'qpm-float-card__no-pet';
  noPetMsg.textContent = 'No active pet in this slot';
  noPetMsg.style.display = 'none';
  body.appendChild(noPetMsg);

  // ─── Shell mount ─────────────────────────────────────────────────────────
  let destroyed = false;
  let currentPet: ActivePetInfo | null = null;
  let refreshSeq = 0;
  let lastMismatchSignature: string | null = null;
  let lastMismatchRetrySignature: string | null = null;
  let feedHovered = false;
  let selectedFood: FoodSelection | null = null;
  let mountBtn: HTMLButtonElement | null = null;
  let isMountable = false;
  let refreshTimer: number | null = null;
  let lastSpriteSignature: string | null = null;
  let lastPetIdentitySignature: string | null = null;

  const scheduleRefresh = (): void => {
    if (destroyed) return;
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      if (destroyed) return;
      void refreshAvailability();
    }, REFRESH_COALESCE_MS);
  };

  const flushRefresh = (): void => {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    lastPetIdentitySignature = computePetIdentitySignature(currentPet);
    void refreshAvailability();
  };

  cleanups.push(() => {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  });

  const shellEntry = openShellCard({
    key: slotKey(slotIndex),
    className: 'qpm-float-card',
    header,
    body,
    persistKey: STORAGE_KEY,
    defaultPosition: getDefaultPct(slotIndex),
    baseWidth: CARD_W,
    maxWidth: CARD_W_MAX,
    dragExcludeSelectors: DRAG_EXCLUDE_SELECTORS,
    onDestroy() {
      destroyed = true;
      cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
      slotEntries.delete(slotIndex);
      emitFloatingCardStateChanged(slotIndex, false);
    },
  });
  const card = shellEntry.el;

  function createMountButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'qpm-float-card__mount-btn';
    btn.title = 'Mount';
    updateMountButtonSprite(btn, false);
    btn.addEventListener('click', () => {
      if (!currentPet?.slotId) return;
      const riddenId = getRiddenPetId();
      if (riddenId === currentPet.slotId) {
        dismountPet();
      } else {
        ridePet(currentPet.slotId);
      }
    });
    return btn;
  }

  function updateMountButtonSprite(btn: HTMLButtonElement, isRiding: boolean): void {
    const key = isRiding ? 'sprite/ui/DismountPin' : 'sprite/ui/MountPin';
    const src = getAnySpriteDataUrl(key);
    btn.innerHTML = '';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = isRiding ? 'Dismount' : 'Mount';
      img.className = 'qpm-float-card__mount-icon';
      btn.appendChild(img);
    }
    btn.title = isRiding ? 'Dismount' : 'Mount';
  }

  function syncMountButton(): void {
    if (!mountBtn || !currentPet?.slotId) return;
    const isRiding = getRiddenPetId() === currentPet.slotId;
    updateMountButtonSprite(mountBtn, isRiding);
    mountBtn.disabled = !isRiding && !!(currentPet.hungerPct != null && currentPet.hungerPct <= 0);
  }

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
    const spriteSig = computeSpriteSignature(pet);
    if (spriteSig !== lastSpriteSignature) {
      lastSpriteSignature = spriteSig;
      setSpriteContent(spriteWrap, pet);
    }

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

    const hasMountAbility = pet?.chargedAbilityId != null;
    if (hasMountAbility && !mountBtn) {
      mountBtn = createMountButton();
      btnRow.appendChild(mountBtn);
    }
    if (mountBtn) {
      mountBtn.style.display = hasMountAbility ? '' : 'none';
    }
    if (hasMountAbility) {
      syncMountButton();
    }
    isMountable = !!hasMountAbility;
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

      requestAnimationFrame(() => {
        if (destroyed || seq !== refreshSeq) return;
        card.style.width = '';
        const overflow = foodCountersRow.scrollWidth - foodCountersRow.clientWidth;
        if (overflow > 2) {
          card.style.width = `${Math.min(CARD_W + overflow + 4, CARD_W_MAX)}px`;
        }
        // Re-clamp position after width change.
        shellEntry.refresh();
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
    const identitySig = computePetIdentitySignature(pet);
    if (identitySig !== lastPetIdentitySignature) {
      lastPetIdentitySignature = identitySig;
      scheduleRefresh();
    }
  };

  cleanups.push(onActivePetInfos(onPetChange));
  cleanups.push(onInventoryChange(() => { scheduleRefresh(); }));

  const onRulesChanged = (): void => { scheduleRefresh(); };
  window.addEventListener(PET_FOOD_RULES_CHANGED_EVENT, onRulesChanged as EventListener);
  cleanups.push(() => window.removeEventListener(PET_FOOD_RULES_CHANGED_EVENT, onRulesChanged as EventListener));
  window.addEventListener(PET_FEED_POLICY_CHANGED_EVENT, onRulesChanged as EventListener);
  cleanups.push(() => window.removeEventListener(PET_FEED_POLICY_CHANGED_EVENT, onRulesChanged as EventListener));

  const onFeedEvent = (): void => { scheduleRefresh(); };
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

  cleanups.push(onRiddenPetChange(() => {
    if (isMountable) syncMountButton();
  }));

  cleanups.push(onFeedQueueEvent((event: FeedQueueEvent) => {
    if (destroyed) return;
    if (event.type === 'drained') {
      scheduleRefresh();
      return;
    }
    if (event.slotIndex !== slotIndex) return;
    const pending = getFeedQueueLength(slotIndex);
    if (pending > 0) {
      setFeedButtonState(`Feed (${pending})`, false);
    } else {
      setFeedButtonState('Feed', false);
      scheduleRefresh();
    }
  }));

  // Initial pet render
  renderPet(getActivePetForSlot(slotIndex));

  return {
    slotIndex,
    shell: shellEntry,
    refreshAvailability: () => { flushRefresh(); },
  };
}

function openSlotCardInternal(slotIndex: number): void {
  const existing = slotEntries.get(slotIndex);
  if (existing) {
    const el = existing.shell.el;
    el.style.border = '1px solid rgba(143,130,255,0.9)';
    window.setTimeout(() => {
      if (el.isConnected) {
        el.style.border = '1px solid rgba(143,130,255,0.45)';
      }
    }, 450);
    existing.refreshAvailability();
    return;
  }

  const entry = createSlotCard(slotIndex);
  slotEntries.set(slotIndex, entry);
  emitFloatingCardStateChanged(slotIndex, true);
  entry.refreshAvailability();
  log(`[FloatingCard] Opened slot-bound card for slot ${slotIndex + 1}`);
}

function restorePersistedCards(): void {
  const persisted = getPersistedFloatingCards(STORAGE_KEY);
  // Pre-seed so sequential opens don't erase each other's positions.
  seedSessionPositions(persisted);
  for (const card of persisted) {
    const slotIndex = slotIndexFromKey(card.key);
    if (slotIndex == null) continue;
    openSlotCardInternal(slotIndex);
  }
}

function migrateLegacyStorageShape(): void {
  const raw = storage.get<unknown>(STORAGE_KEY, undefined);
  if (!raw || typeof raw !== 'object') return;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.cards)) return;
  let dirty = false;
  const cards = data.cards.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const e = entry as Record<string, unknown>;
    if (typeof e.key === 'string' && e.key.length > 0) return entry;
    if (typeof e.slotIndex === 'number' && Number.isFinite(e.slotIndex)) {
      dirty = true;
      const xPct = typeof e.xPct === 'number' ? e.xPct : undefined;
      const yPct = typeof e.yPct === 'number' ? e.yPct : undefined;
      if (xPct != null && yPct != null) {
        return { key: String(e.slotIndex), xPct, yPct };
      }
      const x = Number(e.x);
      const y = Number(e.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const pct = pixelsToPct(x, y, CARD_W, CARD_H_FALLBACK);
        return { key: String(e.slotIndex), xPct: pct.xPct, yPct: pct.yPct };
      }
    }
    return entry;
  });
  if (dirty) {
    storage.set(STORAGE_KEY, { cards, updatedAt: Date.now() });
  }
}

export function initFloatingCards(): void {
  if (initialized) return;
  initialized = true;
  // One-time migration: rewrite legacy `slotIndex` entries to canonical `key`
  // entries so subsequent shell writes don't leave a mix on disk. The shell
  // already tolerates both formats on read.
  migrateLegacyStorageShape();
  restorePersistedCards();
}

export function openFloatingCardForSlot(slotIndex: number): void {
  const normalized = clampSlotIndex(slotIndex);
  if (normalized == null) return;
  initFloatingCards();
  openSlotCardInternal(normalized);
}

export function closeFloatingCardForSlot(slotIndex: number): void {
  const normalized = clampSlotIndex(slotIndex);
  if (normalized == null) return;
  closeShellCard(slotKey(normalized));
}

export function hasFloatingCardForSlot(slotIndex: number): boolean {
  const normalized = clampSlotIndex(slotIndex);
  if (normalized == null) return false;
  return hasShellCard(slotKey(normalized));
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
  for (const entry of Array.from(slotEntries.values())) {
    closeShellCard(slotKey(entry.slotIndex));
  }
}

export function hasFloatingCard(petId: string): boolean {
  const slotIndex = resolveSlotByPetId(petId);
  return slotIndex != null ? hasShellCard(slotKey(slotIndex)) : false;
}
