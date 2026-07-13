import {
  getCropSpriteDataUrl,
  getCropSpriteDataUrlWithMutations,
  getPetSpriteDataUrl,
  getPetSpriteDataUrlWithMutations,
} from '../../../sprite-v2/compat';
import { ACCENT, TEXT } from './constants';
import { el } from './domHelpers';
import type { PlantOption, PetOption } from './types';

export function buildCropSpriteDisplay(): {
  wrapper: HTMLElement;
  update: (plant: PlantOption | null, mutations: string[], sizePercent: number) => void;
} {
  const wrapper = el(
    'div',
    'width:112px;height:112px;display:flex;align-items:center;justify-content:center;margin:0 auto;overflow:visible;',
  );
  const img = el('img', 'object-fit:contain;image-rendering:pixelated;transition:transform 0.15s ease;') as HTMLImageElement;
  const fallback = el(
    'div',
    `width:64px;height:64px;border-radius:50%;background:${ACCENT};display:flex;align-items:center;justify-content:center;font-size:28px;color:${TEXT};font-weight:700;transition:transform 0.15s ease;`,
  );

  let currentChild: HTMLElement | null = null;

  function update(plant: PlantOption | null, mutations: string[], sizePercent: number): void {
    const cssScale = 0.55 + ((sizePercent - 50) / 50) * 0.45;

    if (!plant) {
      fallback.textContent = '?';
      fallback.style.transform = `scale(${cssScale})`;
      if (currentChild !== fallback) {
        wrapper.innerHTML = '';
        wrapper.appendChild(fallback);
        currentChild = fallback;
      }
      return;
    }

    const activeMuts = mutations.filter(Boolean);
    const url = activeMuts.length > 0
      ? getCropSpriteDataUrlWithMutations(plant.key, activeMuts)
      : getCropSpriteDataUrl(plant.key);

    if (url) {
      img.src = url;
      img.alt = plant.name;
      img.style.maxWidth = '112px';
      img.style.maxHeight = '112px';
      img.style.transform = `scale(${cssScale})`;
      if (currentChild !== img) {
        wrapper.innerHTML = '';
        wrapper.appendChild(img);
        currentChild = img;
      }
    } else {
      fallback.textContent = plant.name.charAt(0).toUpperCase();
      fallback.style.transform = `scale(${cssScale})`;
      if (currentChild !== fallback) {
        wrapper.innerHTML = '';
        wrapper.appendChild(fallback);
        currentChild = fallback;
      }
    }
  }

  return { wrapper, update };
}

export function buildPetSpriteDisplay(): {
  wrapper: HTMLElement;
  update: (pet: PetOption | null, mutations: string[], currentStr: number, maxStr: number) => void;
} {
  const wrapper = el(
    'div',
    'width:112px;height:112px;display:flex;align-items:center;justify-content:center;margin:0 auto;overflow:visible;',
  );
  const img = el('img', 'object-fit:contain;image-rendering:pixelated;transition:transform 0.15s ease;') as HTMLImageElement;
  const fallback = el(
    'div',
    `width:64px;height:64px;border-radius:50%;background:${ACCENT};display:flex;align-items:center;justify-content:center;font-size:28px;color:${TEXT};font-weight:700;transition:transform 0.15s ease;`,
  );

  let currentChild: HTMLElement | null = null;

  function update(pet: PetOption | null, mutations: string[], currentStr: number, maxStr: number): void {
    // Visual scale: map strength range to 0.55–1.0 CSS scale
    const minStr = maxStr - 30;
    const progress = maxStr > minStr ? (currentStr - minStr) / (maxStr - minStr) : 1;
    const cssScale = 0.55 + progress * 0.45;

    if (!pet) {
      fallback.textContent = '?';
      fallback.style.transform = `scale(${cssScale})`;
      if (currentChild !== fallback) {
        wrapper.innerHTML = '';
        wrapper.appendChild(fallback);
        currentChild = fallback;
      }
      return;
    }

    const activeMuts = mutations.filter(Boolean);
    const url = activeMuts.length > 0
      ? getPetSpriteDataUrlWithMutations(pet.key, activeMuts)
      : getPetSpriteDataUrl(pet.key);

    if (url) {
      img.src = url;
      img.alt = pet.name;
      img.style.maxWidth = '112px';
      img.style.maxHeight = '112px';
      img.style.transform = `scale(${cssScale})`;
      if (currentChild !== img) {
        wrapper.innerHTML = '';
        wrapper.appendChild(img);
        currentChild = img;
      }
    } else {
      fallback.textContent = pet.name.charAt(0).toUpperCase();
      fallback.style.transform = `scale(${cssScale})`;
      if (currentChild !== fallback) {
        wrapper.innerHTML = '';
        wrapper.appendChild(fallback);
        currentChild = fallback;
      }
    }
  }

  return { wrapper, update };
}
