// src/ui/pets/floatingCard/bodyRenderers.ts
// Pure DOM helpers shared by the feed floating card. Kept separate so the
// main `card.ts` stays under the 750-line hard limit.

import {
  getCropSpriteDataUrl,
  getAnySpriteDataUrl,
  getPetSpriteDataUrlWithMutations,
  isSpritesReady,
} from '../../../sprite-v2/compat';
import { HYDRATION_EVENT } from '../../../sprite-v2/service/constants';
import { HUNGER_POTION_KEY } from '../../../features/pets/hungerPotion';
import type { ActivePetInfo } from '../../../store/pets';
import type { EligibleFoodEntry } from '../../../features/pets/foodRules';

const MAX_FOOD_PILLS = 6;

export function setSpriteContent(
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

// Rive pet species load only after the game fetches their .riv, so a card that
// rendered first keeps the fallback until a hydration event re-renders it.
export function watchSpriteHydration(
  spriteWrap: HTMLElement,
  getPet: () => ActivePetInfo | null,
): () => void {
  const onHydrated = (): void => {
    if (spriteWrap.querySelector('img')) return;
    const pet = getPet();
    if (pet) setSpriteContent(spriteWrap, pet);
  };
  window.addEventListener(HYDRATION_EVENT, onHydrated);
  return () => window.removeEventListener(HYDRATION_EVENT, onHydrated);
}

function resolveFoodSprite(foodKey: string): string {
  if (foodKey === HUNGER_POTION_KEY) {
    return getAnySpriteDataUrl('sprite/item/ReplenishPotion') ||
           getAnySpriteDataUrl('item/ReplenishPotion') || '';
  }
  return getCropSpriteDataUrl(foodKey);
}

export function renderFoodCounters(
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

    const preview = document.createElement('span');
    preview.className = 'qpm-float-card__feed-preview';
    pill.appendChild(preview);

    container.appendChild(pill);
  }

  if (overflowCount > 0) {
    const overflowPill = document.createElement('div');
    overflowPill.className = 'qpm-float-card__food';
    const overflowLabel = document.createElement('span');
    overflowLabel.className = 'qpm-float-card__food-count';
    overflowLabel.textContent = `+${overflowCount}`;
    overflowPill.appendChild(overflowLabel);
    container.appendChild(overflowPill);
  }

  if (labelEl) labelEl.style.display = visibleFoods.length >= 3 ? 'none' : '';
}
