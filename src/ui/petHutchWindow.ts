// Pet Hutch Window - displays all pets from hutch and inventory

import { log } from '../utils/logger';
import { getAtomByLabel, readAtomValue } from '../core/jotaiBridge';
import { getPetSpriteCanvas } from '../sprite-v2/compat';
import { getMutationSpriteDataUrl } from '../utils/petMutationRenderer';
import { storage } from '../utils/storage';
import { canvasToDataUrl } from '../utils/canvasHelpers';
import { t } from '../i18n';

interface PetItem {
  name: string;
  species: string;
  petSpecies?: string;
  xp: number;
  strength?: number;
  level?: number;
  mutation?: string;
  location: 'hutch' | 'inventory';
}

let isWindowOpen = false;
let windowElement: HTMLDivElement | null = null;

// Keybind configuration
const DEFAULT_KEYBIND = 'h'; // Default to 'H' key
let currentKeybind = DEFAULT_KEYBIND;

function loadKeybind(): void {
  const saved = storage.get<string>('petHutch:keybind', DEFAULT_KEYBIND);
  currentKeybind = saved.toLowerCase();
}

function saveKeybind(key: string): void {
  currentKeybind = key.toLowerCase();
  storage.set('petHutch:keybind', currentKeybind);
}

async function getAllPets(): Promise<PetItem[]> {
  const pets: PetItem[] = [];

  // Get hutch pets
  try {
    const hutchAtom = getAtomByLabel('myPetHutchPetItemsAtom');
    if (hutchAtom) {
      const hutchData = await readAtomValue(hutchAtom) as any;
      if (Array.isArray(hutchData)) {
        for (const item of hutchData) {
          const species = item.petSpecies || item.species;
          if (!species) continue;

          pets.push({
            name: item.name || species,
            species,
            petSpecies: item.petSpecies,
            xp: item.xp || 0,
            strength: item.strength,
            level: item.level,
            mutation: item.mutation,
            location: 'hutch'
          });
        }
      }
    }
  } catch (error) {
    log('⚠️ Failed to read hutch pets:', error);
  }

  // Get inventory pets
  try {
    const inventoryAtom = getAtomByLabel('myPetInventoryAtom');
    if (inventoryAtom) {
      const inventoryData = await readAtomValue(inventoryAtom) as any;

      if (Array.isArray(inventoryData)) {
        for (const item of inventoryData) {
          const species = item.petSpecies || item.species;
          if (!species || item.itemType !== 'pet') continue;

          pets.push({
            name: item.name || species,
            species,
            petSpecies: item.petSpecies,
            xp: item.xp || 0,
            strength: item.strength,
            level: item.level,
            mutation: item.mutation,
            location: 'inventory'
          });
        }
      }
    }
  } catch (error) {
    log('⚠️ Failed to read inventory pets:', error);
  }

  return pets;
}

function renderPetCard(pet: PetItem): string {
  const species = pet.petSpecies || pet.species;
  let spriteUrl: string | null;

  try {
    if (pet.mutation) {
      spriteUrl = getMutationSpriteDataUrl(species, pet.mutation as any);
    } else {
      spriteUrl = canvasToDataUrl(getPetSpriteCanvas(species));
    }
  } catch {
    spriteUrl = canvasToDataUrl(getPetSpriteCanvas(species));
  }

  // Fallback if sprite is null
  if (!spriteUrl) {
    spriteUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect fill="%23666" width="48" height="48"/%3E%3C/svg%3E';
  }

  const level = pet.strength || pet.level || '?';
  const locationBadge = pet.location === 'hutch'
    ? `<span style="background: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;">${t('feature.petHutch.hutch')}</span>`
    : `<span style="background: #2196F3; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;">${t('feature.petHutch.inv')}</span>`;

  return `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px;
      background: rgba(30, 30, 35, 0.95);
      border: 2px solid rgba(100, 181, 246, 0.3);
      border-radius: 8px;
      min-width: 100px;
      transition: all 0.2s;
      cursor: pointer;
    " class="pet-card" onmouseover="this.style.borderColor='rgba(100, 181, 246, 0.8)'; this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='rgba(100, 181, 246, 0.3)'; this.style.transform='translateY(0)'">
      <img src="${spriteUrl}" style="width: 48px; height: 48px; image-rendering: pixelated; margin-bottom: 8px;" alt="${species}" />
      <div style="font-size: 12px; font-weight: 600; color: #fff; margin-bottom: 4px; text-align: center;">${pet.name}</div>
      <div style="font-size: 11px; color: #64B5F6; margin-bottom: 4px;">${t('feature.petHutch.level', { level: String(level) })}</div>
      ${locationBadge}
    </div>
  `;
}

async function renderWindow(): Promise<void> {
  if (!windowElement) return;

  const pets = await getAllPets();

  // Separate hutch and inventory pets
  const hutchPets = pets.filter(p => p.location === 'hutch');
  const inventoryPets = pets.filter(p => p.location === 'inventory');

  const content = `
    <div style="padding: 20px; max-height: 70vh; overflow-y: auto;">
      <!-- Hutch Section -->
      <div style="margin-bottom: 30px;">
        <h3 style="color: #4CAF50; font-size: 16px; font-weight: 700; margin-bottom: 12px; border-bottom: 2px solid #4CAF50; padding-bottom: 6px;">
          🏠 ${t('feature.petHutch.petHutchCount', { count: String(hutchPets.length) })}
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 12px;">
          ${hutchPets.length > 0 ? hutchPets.map(pet => renderPetCard(pet)).join('') : `<div style="color: #888; font-size: 14px; padding: 20px;">${t('feature.petHutch.noPetsHutch')}</div>`}
        </div>
      </div>

      <!-- Inventory Section -->
      <div>
        <h3 style="color: #2196F3; font-size: 16px; font-weight: 700; margin-bottom: 12px; border-bottom: 2px solid #2196F3; padding-bottom: 6px;">
          🎒 ${t('feature.petHutch.inventoryCount', { count: String(inventoryPets.length) })}
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 12px;">
          ${inventoryPets.length > 0 ? inventoryPets.map(pet => renderPetCard(pet)).join('') : `<div style="color: #888; font-size: 14px; padding: 20px;">${t('feature.petHutch.noPetsInventory')}</div>`}
        </div>
      </div>

      <!-- Keybind Settings -->
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(100, 181, 246, 0.2);">
        <div style="font-size: 12px; color: #888; text-align: center;">
          ${t('feature.petHutch.keybindHint', { key: `<kbd style="background: rgba(100, 181, 246, 0.2); padding: 3px 8px; border-radius: 3px; font-family: monospace;">${currentKeybind.toUpperCase()}</kbd>` })}
        </div>
      </div>
    </div>
  `;

  const contentDiv = windowElement.querySelector('.pet-hutch-content');
  if (contentDiv) {
    contentDiv.innerHTML = content;
  }
}

export function openPetHutchWindow(): void {
  if (isWindowOpen) {
    closePetHutchWindow();
    return;
  }

  log('🏠 Opening Pet Hutch window');

  windowElement = document.createElement('div');
  windowElement.className = 'qpm-window pet-hutch-window';
  windowElement.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 800px;
    background: rgba(20, 20, 25, 0.98);
    border: 3px solid rgba(100, 181, 246, 0.6);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
    z-index: 99999;
    font-family: 'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif;
  `;

  windowElement.innerHTML = `
    <div style="
      background: linear-gradient(135deg, rgba(100, 181, 246, 0.2) 0%, rgba(100, 181, 246, 0.05) 100%);
      padding: 16px 20px;
      border-bottom: 2px solid rgba(100, 181, 246, 0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
    ">
      <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #64B5F6;">
        🏠 ${t('feature.petHutch.title')}
      </h2>
      <button class="close-btn" style="
        background: rgba(244, 67, 54, 0.2);
        border: 2px solid rgba(244, 67, 54, 0.5);
        color: #F44336;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.2s;
      " onmouseover="this.style.background='rgba(244, 67, 54, 0.4)'; this.style.borderColor='rgba(244, 67, 54, 0.8)'" onmouseout="this.style.background='rgba(244, 67, 54, 0.2)'; this.style.borderColor='rgba(244, 67, 54, 0.5)'">
        ✕ ${t('common.close')}
      </button>
    </div>
    <div class="pet-hutch-content"></div>
  `;

  document.body.appendChild(windowElement);

  // Close button handler
  const closeBtn = windowElement.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closePetHutchWindow);
  }

  // Render content
  renderWindow();

  isWindowOpen = true;
}

export function closePetHutchWindow(): void {
  if (windowElement) {
    windowElement.remove();
    windowElement = null;
  }
  isWindowOpen = false;
}

export function togglePetHutchWindow(): void {
  if (isWindowOpen) {
    closePetHutchWindow();
  } else {
    openPetHutchWindow();
  }
}

// Keyboard handler
function handleKeyPress(event: KeyboardEvent): void {
  // Don't trigger if user is typing in an input/textarea
  const target = event.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }

  if (event.key.toLowerCase() === currentKeybind) {
    event.preventDefault();
    togglePetHutchWindow();
  }
}

export function initPetHutchWindow(): void {
  loadKeybind();
  document.addEventListener('keydown', handleKeyPress);
  log(`🏠 Pet Hutch window initialized (keybind: ${currentKeybind.toUpperCase()})`);
}

export function setKeybind(key: string): void {
  saveKeybind(key);
  log(`🏠 Pet Hutch keybind updated to: ${key.toUpperCase()}`);
}

export function getKeybind(): string {
  return currentKeybind;
}
