// Pet Hutch Window - displays all pets from hutch and inventory

import { log } from '../../utils/logger';
import { readAtomValue } from '../../core/atomRegistry';
import { getPetSpriteCanvas } from '../../sprite-v2/compat';
import { getMutationSpriteDataUrl } from '../../utils/rendering/petMutationRenderer';
import { storage } from '../../utils/storage';
import { canvasToDataUrl } from '../../utils/dom/canvasHelpers';
import { t } from '../../i18n';

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

const DEFAULT_KEYBIND = 'h';
let currentKeybind = DEFAULT_KEYBIND;

const STYLE_ID = 'qpm-pet-hutch-styles';

function ensurePetHutchStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .qpm-pet-hutch-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px;
      background: rgba(30, 30, 35, 0.95);
      border: 2px solid rgba(100, 181, 246, 0.3);
      border-radius: 8px;
      min-width: 100px;
      transition: border-color 0.15s, transform 0.15s;
      cursor: pointer;
      transform: translateY(0);
    }
    .qpm-pet-hutch-card:hover {
      border-color: rgba(100, 181, 246, 0.8);
      transform: translateY(-2px);
    }
    .qpm-pet-hutch-card__sprite {
      width: 48px;
      height: 48px;
      image-rendering: pixelated;
      margin-bottom: 8px;
    }
    .qpm-pet-hutch-card__name {
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 4px;
      text-align: center;
    }
    .qpm-pet-hutch-card__level {
      font-size: 11px;
      color: #64B5F6;
      margin-bottom: 4px;
    }
    .qpm-pet-hutch-card__badge {
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
    }
    .qpm-pet-hutch-card__badge--hutch { background: #4CAF50; }
    .qpm-pet-hutch-card__badge--inv { background: #2196F3; }
  `;
  document.head.appendChild(style);
}

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
    const hutchData = await readAtomValue('hutchPets') as any;
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
  } catch (error) {
    log('⚠️ Failed to read hutch pets:', error);
  }

  // Get inventory pets
  try {
    const inventoryData = await readAtomValue('petInventory') as any;
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
  } catch (error) {
    log('⚠️ Failed to read inventory pets:', error);
  }

  return pets;
}

function renderPetCard(pet: PetItem): HTMLDivElement {
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

  if (!spriteUrl) {
    spriteUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect fill="%23666" width="48" height="48"/%3E%3C/svg%3E';
  }

  const level = pet.strength || pet.level || '?';

  const card = document.createElement('div');
  card.className = 'qpm-pet-hutch-card';

  const img = document.createElement('img');
  img.className = 'qpm-pet-hutch-card__sprite';
  img.src = spriteUrl;
  img.alt = species;
  card.appendChild(img);

  const name = document.createElement('div');
  name.className = 'qpm-pet-hutch-card__name';
  name.textContent = pet.name;
  card.appendChild(name);

  const levelEl = document.createElement('div');
  levelEl.className = 'qpm-pet-hutch-card__level';
  levelEl.textContent = t('feature.petHutch.level', { level: String(level) });
  card.appendChild(levelEl);

  const badge = document.createElement('span');
  badge.className = pet.location === 'hutch'
    ? 'qpm-pet-hutch-card__badge qpm-pet-hutch-card__badge--hutch'
    : 'qpm-pet-hutch-card__badge qpm-pet-hutch-card__badge--inv';
  badge.textContent = pet.location === 'hutch'
    ? t('feature.petHutch.hutch')
    : t('feature.petHutch.inv');
  card.appendChild(badge);

  return card;
}

function buildSection(
  headerColor: string,
  emoji: string,
  headerLabel: string,
  pets: PetItem[],
  emptyMessage: string,
  marginBottom: string,
): HTMLDivElement {
  const section = document.createElement('div');
  section.style.cssText = `margin-bottom:${marginBottom};`;

  const h3 = document.createElement('h3');
  h3.style.cssText = `color:${headerColor};font-size:16px;font-weight:700;margin-bottom:12px;border-bottom:2px solid ${headerColor};padding-bottom:6px;`;
  h3.textContent = `${emoji} ${headerLabel}`;
  section.appendChild(h3);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(100px, 1fr));gap:12px;';
  if (pets.length > 0) {
    for (const pet of pets) grid.appendChild(renderPetCard(pet));
  } else {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#888;font-size:14px;padding:20px;';
    empty.textContent = emptyMessage;
    grid.appendChild(empty);
  }
  section.appendChild(grid);
  return section;
}

async function renderWindow(): Promise<void> {
  if (!windowElement) return;

  const pets = await getAllPets();

  const hutchPets = pets.filter(p => p.location === 'hutch');
  const inventoryPets = pets.filter(p => p.location === 'inventory');

  const contentDiv = windowElement.querySelector('.pet-hutch-content');
  if (!contentDiv) return;

  const shell = document.createElement('div');
  shell.style.cssText = 'padding:20px;max-height:70vh;overflow-y:auto;';

  shell.appendChild(buildSection(
    '#4CAF50',
    '🏠',
    t('feature.petHutch.petHutchCount', { count: String(hutchPets.length) }),
    hutchPets,
    t('feature.petHutch.noPetsHutch'),
    '30px',
  ));

  shell.appendChild(buildSection(
    '#2196F3',
    '🎒',
    t('feature.petHutch.inventoryCount', { count: String(inventoryPets.length) }),
    inventoryPets,
    t('feature.petHutch.noPetsInventory'),
    '0',
  ));

  const keybindFooter = document.createElement('div');
  keybindFooter.style.cssText = 'margin-top:30px;padding-top:20px;border-top:1px solid rgba(100, 181, 246, 0.2);';
  const keybindText = document.createElement('div');
  keybindText.style.cssText = 'font-size:12px;color:#888;text-align:center;';
  const kbd = document.createElement('kbd');
  kbd.style.cssText = 'background:rgba(100, 181, 246, 0.2);padding:3px 8px;border-radius:3px;font-family:monospace;';
  kbd.textContent = currentKeybind.toUpperCase();
  const KEY_MARKER = '~~QPM_KEY~~';
  const hintTemplate = t('feature.petHutch.keybindHint', { key: KEY_MARKER });
  const [before, after] = hintTemplate.split(KEY_MARKER);
  if (before) keybindText.appendChild(document.createTextNode(before));
  keybindText.appendChild(kbd);
  if (after) keybindText.appendChild(document.createTextNode(after));
  keybindFooter.appendChild(keybindText);
  shell.appendChild(keybindFooter);

  contentDiv.replaceChildren(shell);
}

export function openPetHutchWindow(): void {
  if (isWindowOpen) {
    closePetHutchWindow();
    return;
  }

  log('🏠 Opening Pet Hutch window');

  ensurePetHutchStyles();

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
