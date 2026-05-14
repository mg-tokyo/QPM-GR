// src/ui/journalCheckerSection.ts
// Visually revamped Journal Checker UI

import {
  getCropSpriteCanvas,
  getCropSpriteWithMutations,
  getPetSpriteCanvas,
  getPetSpriteWithMutations,
  getPetSpriteDataUrl as compatGetPetSpriteDataUrl,
  getPetSpriteDataUrlWithMutations as compatGetPetSpriteDataUrlWithMutations,
  getProduceSpriteDataUrl as compatGetProduceSpriteDataUrl,
  getProduceSpriteDataUrlWithMutations as compatGetProduceSpriteDataUrlWithMutations,
} from '../sprite-v2/compat';
import { storage } from '../utils/storage';
import { t } from '../i18n';
import { getCropSizeIndicatorConfig, setCropSizeIndicatorConfig } from '../features/cropSizeIndicator';
import { getPlantCatalog, getMutationCatalog, getPetCatalog } from '../catalogs/gameCatalogs';
import { getVariantChipColors } from '../data/variantBadges';
import { canvasToDataUrl } from '../utils/canvasHelpers';

// Species name normalization for sprite lookups
const SPECIES_NAME_MAP: Record<string, string> = {
  'orangetulip': 'Tulip',
  'tulip': 'Tulip',
  'dawncelestial': 'Dawnbinder',
  'dawnbinder': 'Dawnbinder',
  'mooncelestial': 'Moonbinder',
  'moonbinder': 'Moonbinder',
  'starweaver': 'Starweaver',
  'mythicalegg': 'Mythical',
  'mythical': 'Mythical',
};

function normalizeSpeciesName(species: string): string {
  const key = species.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SPECIES_NAME_MAP[key] || species;
}

// Human-readable display names for PascalCase catalog keys
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  Cacao: 'Cacao Bean',
  DawnCelestial: 'Dawnbinder',
  MoonCelestial: 'Moonbinder',
  OrangeTulip: 'Orange Tulip',
  BurrosTail: "Burro's Tail",
  FavaBean: 'Fava Bean',
  FourLeafClover: 'Four-Leaf Clover',
  PurpleDaisy: 'Purple Daisy',
  PassionFruit: 'Passion Fruit',
  DragonFruit: 'Dragon Fruit',
  PineTree: 'Pine Tree',
  VioletCort: 'Violet Cort',
  FireHorse: 'Fire Horse',
  SnowFox: 'Snow Fox',
  WhiteCaribou: 'White Caribou',
};

function formatSpeciesDisplayName(key: string): string {
  if (DISPLAY_NAME_OVERRIDES[key]) return DISPLAY_NAME_OVERRIDES[key];
  return key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

// Known mutation prefixes — when a species name starts with one of these,
// strip it and render the base crop with the mutation applied so we get
// the plant/crop sprite instead of the seed sprite.
const CROP_MUTATION_PREFIXES = [
  'Gold', 'Rainbow', 'Frozen', 'Wet', 'Amber', 'Chilled',
  'Dawnlit', 'Amberlit', 'Dawnbound', 'Amberbound',
];

function getCropSpriteUrl(species: string): string | null {
  // Use produce-only lookup (excludes 'seed' and 'pet') so "Rose" → plant sprite,
  // not a Rose-colored pet sprite.
  for (const prefix of CROP_MUTATION_PREFIXES) {
    if (species.startsWith(prefix + ' ')) {
      const base = species.slice(prefix.length + 1);
      const url = compatGetProduceSpriteDataUrlWithMutations(base, [prefix]) || null;
      if (url) return url;
    }
  }
  return compatGetProduceSpriteDataUrl(species) || null;
}

function getPetSpriteUrl(species: string): string | null {
  return compatGetPetSpriteDataUrl(species);
}

function pickPetRecommendationMutation(missingVariants: string[] | undefined): 'Rainbow' | 'Gold' | null {
  if (!Array.isArray(missingVariants)) return null;
  const normalized = missingVariants.map((variant) => String(variant).toLowerCase());
  if (normalized.includes('rainbow')) return 'Rainbow';
  if (normalized.includes('gold')) return 'Gold';
  return null;
}

function getRecommendationSpriteUrl(rec: {
  type: 'produce' | 'pet';
  species: string;
  missingVariants?: string[];
}): string | null {
  const normalizedSpecies = normalizeSpeciesName(rec.species);
  if (rec.type === 'produce') {
    return getCropSpriteUrl(normalizedSpecies) || getCropSpriteUrl(rec.species.toLowerCase());
  }

  const mutation = pickPetRecommendationMutation(rec.missingVariants);
  if (mutation) {
    const mutated =
      compatGetPetSpriteDataUrlWithMutations(normalizedSpecies, [mutation]) ||
      compatGetPetSpriteDataUrlWithMutations(rec.species, [mutation]) ||
      compatGetPetSpriteDataUrlWithMutations(rec.species.toLowerCase(), [mutation]);
    if (mutated) return mutated;
  }

  return (
    getPetSpriteUrl(normalizedSpecies) ||
    getPetSpriteUrl(rec.species.toLowerCase()) ||
    getPetSpriteUrl(rec.species)
  );
}

// Wrapper functions that handle normalization automatically
function getNormalizedCropSprite(species: string): string | null {
  const attempts = [
    normalizeSpeciesName(species),
    species.toLowerCase(),
    species,
  ];
  for (const id of attempts) {
    const url = canvasToDataUrl(getCropSpriteCanvas(id));
    if (url) return url;
  }
  return null;
}

function getNormalizedPetSprite(species: string): string | null {
  const attempts = [
    normalizeSpeciesName(species),
    species.toLowerCase(),
    species,
  ];
  for (const id of attempts) {
    const url = canvasToDataUrl(getPetSpriteCanvas(id));
    if (url) return url;
  }
  return null;
}

// Produce layout order by rarity tier (all 54 species)
// Names chosen so normalization matches catalog keys:
//   'Dawn Celestial' → 'dawncelestial' matches DawnCelestial → 'dawncelestial'
const SHOP_LAYOUT_ORDER = [
  // Common
  'Carrot', 'Cabbage', 'Strawberry', 'Aloe',
  // Uncommon
  'Clover', 'Beet', 'Rose', 'Fava Bean', 'Delphinium', 'Blueberry', 'Apple', 'Orange Tulip', 'Tomato', 'Daisy',
  // Rare
  'Daffodil', 'Corn', 'Watermelon', 'Pumpkin', 'Echeveria', 'Pear', 'Gentian', 'Lavender',
  // Legendary
  'Coconut', 'Pine Tree', 'Banana', 'Lily', 'Camellia', 'Squash', 'Peach', "Burro's Tail", 'Saffron', 'Four Leaf Clover', 'Purple Daisy',
  // Mythic
  'Mushroom', 'Cactus', 'Bamboo', 'Poinsettia', 'Violet Cort', 'Chrysanthemum', 'Date', 'Grape', 'Eggplant',
  // Divine
  'Pepper', 'Lemon', 'Passion Fruit', 'Dragon Fruit', 'Cacao', 'Lychee', 'Ube', 'Sunflower',
  // Celestial
  'Dawnbreaker', 'Starweaver', 'Dawn Celestial', 'Moon Celestial',
];
const SHOP_LAYOUT_INDEX = new Map(SHOP_LAYOUT_ORDER.map((name, idx) => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), idx]));

// Pet layout order by egg tier
const PET_LAYOUT_ORDER = [
  // Common
  'Worm', 'Snail', 'Bee',
  // Uncommon
  'Chicken', 'Bunny', 'Dragonfly',
  // Rare
  'Pig', 'Cow', 'Turkey',
  // Legendary
  'Squirrel', 'Turtle', 'Goat', 'Snow Fox', 'Stoat', 'White Caribou', 'Pony', 'Sheep', 'Horse',
  // Mythic
  'Hedgehog', 'Fire Horse', 'Butterfly', 'Peacock', 'Capybara', 'Ostrich',
];
const PET_LAYOUT_INDEX = new Map(PET_LAYOUT_ORDER.map((name, idx) => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), idx]));

const TALL_SPECIES = new Set(['cactus', 'bamboo']);

// Storage for user notes per species
function getSpeciesNotes(species: string): string {
  const notes = storage.get<Record<string, string>>('journal:notes', {});
  return notes[species] || '';
}

function saveSpeciesNotes(species: string, notes: string): void {
  const allNotes = storage.get<Record<string, string>>('journal:notes', {});
  allNotes[species] = notes;
  storage.set('journal:notes', allNotes);
}

export function createJournalCheckerSection(): HTMLElement {
  const root = document.createElement('div');
  root.dataset.qpmSection = 'journal-checker';
  root.style.cssText = `
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 8px;
    padding: 16px;
    color: #fff;
  `;

  // Add rainbow border animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes qpm-rainbow-border {
      0% { background-position: 0% 50%, 0% 50%; }
      50% { background-position: 0% 50%, 100% 50%; }
      100% { background-position: 0% 50%, 200% 50%; }
    }
    @keyframes qpm-rainbow-progress {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 200% 50%; }
    }
  `;
  root.appendChild(style);

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    margin-bottom: 12px;
    border-bottom: 2px solid #333;
    padding-bottom: 8px;
  `;
  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between;';
  const headerTextWrap = document.createElement('div');
  const headerTitle = document.createElement('div');
  headerTitle.style.cssText = 'font-size: 18px; font-weight: bold; color: #fff; margin-bottom: 4px;';
  headerTitle.textContent = `📔 ${t('feature.journal.title')}`;
  const headerSub = document.createElement('div');
  headerSub.style.cssText = 'font-size: 12px; color: #aaa;';
  headerSub.textContent = t('feature.journal.subtitle');
  headerTextWrap.appendChild(headerTitle);
  headerTextWrap.appendChild(headerSub);
  headerRow.appendChild(headerTextWrap);
  header.appendChild(headerRow);
  root.appendChild(header);

  // Stats summary with gradients and icons
  const statsContainer = document.createElement('div');
  statsContainer.style.cssText = `
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  `;

  const createStatBox = (icon: string, label: string, value: string, color: string, bgGradient: string) => {
    const box = document.createElement('div');
    box.style.cssText = `
      background: linear-gradient(135deg, ${bgGradient});
      border-radius: 10px;
      padding: 10px 8px;
      text-align: center;
      border: 2px solid ${color}22;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: pointer;
      position: relative;
      overflow: hidden;
      min-width: 0;
    `;

    const content = document.createElement('div');
    content.style.cssText = 'position: relative; z-index: 1;';
    content.innerHTML = `
      <div style="font-size: 22px; margin-bottom: 4px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); line-height: 1;">${icon}</div>
      <div class="stat-value" style="color: ${color}; font-size: 19px; font-weight: bold; margin-bottom: 3px; font-family: 'Segoe UI', Arial, sans-serif; text-shadow: 0 2px 8px rgba(0,0,0,0.4); line-height: 1.1;">${value}</div>
      <div style="color: #bbb; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${label}</div>
    `;
    box.appendChild(content);

    box.addEventListener('mouseenter', () => {
      box.style.transform = 'translateY(-2px)';
      box.style.borderColor = `${color}55`;
      box.style.boxShadow = `0 6px 12px ${color}22`;
    });
    box.addEventListener('mouseleave', () => {
      box.style.transform = 'translateY(0)';
      box.style.borderColor = `${color}22`;
      box.style.boxShadow = 'none';
    });

    return box;
  };

  const produceStatBox = createStatBox('🌾', t('feature.journal.produce'), '...', '#8BC34A', '#1e2a1e, #1a1a1a');
  const petVariantStatBox = createStatBox('🐾', t('feature.journal.petVariants'), '...', '#42A5F5', '#1a212a, #1a1a1a');
  const overallStatBox = createStatBox('✨', t('feature.journal.overall'), '...', '#9C27B0', '#241a2a, #1a1a1a');

  statsContainer.appendChild(produceStatBox);
  statsContainer.appendChild(petVariantStatBox);
  statsContainer.appendChild(overallStatBox);

  root.appendChild(statsContainer);

  // Category selector with modern buttons
  const categoryContainer = document.createElement('div');
  categoryContainer.style.cssText = `
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  `;

  const categories = [
    { key: 'produce', label: t('feature.journal.produce'), icon: '🌾', color: '#8BC34A' },
    { key: 'pets', label: t('feature.journal.pets'), icon: '🐾', color: '#42A5F5' },
    { key: 'recommendations', label: t('feature.journal.smartTips'), icon: '💡', color: '#9C27B0' },
    { key: 'missing', label: t('feature.journal.missing'), icon: '📋', color: '#FF9800' },
  ];

  let selectedCategory = 'produce';
  let showMissingOnly = false;
  let catalogRetries = 0;

  const updateDisplay = async () => {
    // Guard: wait for plant/mutation/pet catalogs before rendering
    if (!getPlantCatalog() || !getMutationCatalog() || !getPetCatalog()) {
      if (catalogRetries < 10) {
        catalogRetries++;
        resultsContainer.innerHTML = '';
        const loadingDiv = document.createElement('div');
        loadingDiv.style.cssText = 'color: #999; text-align: center; padding: 40px; font-size: 14px;';
        loadingDiv.textContent = `⏳ ${t('feature.journal.loadingData')}`;
        const loadingSub = document.createElement('span');
        loadingSub.style.cssText = 'font-size: 12px; color: #666;';
        loadingSub.textContent = t('feature.journal.waitingCatalogs');
        loadingDiv.appendChild(document.createElement('br'));
        loadingDiv.appendChild(loadingSub);
        resultsContainer.appendChild(loadingDiv);
        setTimeout(updateDisplay, 1500);
        return;
      }
      resultsContainer.innerHTML = '';
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'color: #999; text-align: center; padding: 40px; font-size: 14px;';
      errorDiv.textContent = `⚠️ ${t('feature.journal.catalogsNotLoaded')}`;
      const errorSub = document.createElement('span');
      errorSub.style.cssText = 'font-size: 12px; color: #666;';
      errorSub.textContent = t('feature.journal.tryRefreshing');
      errorDiv.appendChild(document.createElement('br'));
      errorDiv.appendChild(errorSub);
      resultsContainer.appendChild(errorDiv);
      return;
    }
    catalogRetries = 0;

    const summary = await import('../features/journalChecker').then(m => m.getJournalSummary());
    const stats = await import('../features/journalChecker').then(m => m.getJournalStats());

    if (!summary || !stats) {
      resultsContainer.innerHTML = '';
      const loadErrorDiv = document.createElement('div');
      loadErrorDiv.style.cssText = 'color: #999; text-align: center; padding: 40px; font-size: 14px;';
      loadErrorDiv.textContent = `⚠️ ${t('feature.journal.unableToLoad')}`;
      const loadErrorSub = document.createElement('span');
      loadErrorSub.style.cssText = 'font-size: 12px; color: #666;';
      loadErrorSub.textContent = t('feature.journal.tryRefreshingConsole');
      loadErrorDiv.appendChild(document.createElement('br'));
      loadErrorDiv.appendChild(loadErrorSub);
      resultsContainer.appendChild(loadErrorDiv);
      return;
    }

    // Update stats with animation
    const updateStat = (box: HTMLElement, text: string) => {
      const valueEl = box.querySelector('.stat-value');
      if (valueEl) {
        valueEl.textContent = text;
        valueEl.animate([
          { transform: 'scale(1.2)', opacity: 0.5 },
          { transform: 'scale(1)', opacity: 1 }
        ], { duration: 300, easing: 'ease-out' });
      }
    };

    updateStat(produceStatBox, `${stats.produce.collected}/${stats.produce.total}`);
    updateStat(petVariantStatBox, `${stats.petVariants.collected}/${stats.petVariants.total}`);
    updateStat(overallStatBox, `${Math.round(stats.overall.percentage)}%`);

    // Clear results
    resultsContainer.innerHTML = '';

    if (selectedCategory === 'produce') {
      const orderedProduce = summary.produce.slice().sort((a, b) => {
        const aKey = a.species.toLowerCase().replace(/[^a-z0-9]/g, '');
        const bKey = b.species.toLowerCase().replace(/[^a-z0-9]/g, '');
        const aIdx = SHOP_LAYOUT_INDEX.has(aKey) ? SHOP_LAYOUT_INDEX.get(aKey)! : Number.MAX_SAFE_INTEGER;
        const bIdx = SHOP_LAYOUT_INDEX.has(bKey) ? SHOP_LAYOUT_INDEX.get(bKey)! : Number.MAX_SAFE_INTEGER;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.species.localeCompare(b.species);
      });

      for (const species of orderedProduce) {
        const variants = showMissingOnly
          ? species.variants.filter(v => !v.collected)
          : species.variants;

        if (variants.length === 0) continue;

        const collectedCount = species.variants.filter(v => v.collected).length;
        const totalCount = species.variants.length;
        const percentage = (collectedCount / totalCount) * 100;
        const isComplete = percentage === 100;

        const speciesCard = document.createElement('div');

        // Add rainbow animation if all variants collected (MATCHES PET CARDS!)
        if (isComplete) {
          speciesCard.classList.add('qpm-rainbow-complete');
          speciesCard.style.cssText = `
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 10px;
            border: 1px solid #333;
            transition: all 0.2s;
          `;
        } else {
          speciesCard.style.cssText = `
            background: linear-gradient(135deg, #1f1f1f, #1a1a1a);
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 10px;
            border: 1px solid #333;
            transition: all 0.2s;
          `;
        }

        speciesCard.addEventListener('mouseenter', () => {
          if (!isComplete) {
            speciesCard.style.borderColor = '#8BC34A44';
          }
          speciesCard.style.transform = 'translateX(4px)';
        });
        speciesCard.addEventListener('mouseleave', () => {
          if (percentage !== 100) {
            speciesCard.style.borderColor = '#333';
          }
          speciesCard.style.transform = 'translateX(0)';
        });

        // Get sprite - apply rainbow mutation if all variants collected
        const speciesKey = species.species.toLowerCase().replace(/\s+/g, '');
        const normalizedName = normalizeSpeciesName(species.species);
        let spriteDataUrl: string | null = null;

        if (isComplete) {
          // Apply rainbow mutation for completed species
          const attempts = [
            canvasToDataUrl(getCropSpriteWithMutations(normalizedName, ['Rainbow'])),
            canvasToDataUrl(getCropSpriteWithMutations(speciesKey, ['Rainbow'])),
            canvasToDataUrl(getCropSpriteWithMutations(species.species, ['Rainbow'])),
          ];
          spriteDataUrl = attempts.find(Boolean) || canvasToDataUrl(getCropSpriteCanvas(normalizedName));
        } else {
          spriteDataUrl =
            canvasToDataUrl(getCropSpriteCanvas(normalizedName)) ||
            canvasToDataUrl(getCropSpriteCanvas(speciesKey)) ||
            canvasToDataUrl(getCropSpriteCanvas(species.species.toLowerCase()));
        }
        
        const isTall = TALL_SPECIES.has(speciesKey.replace(/[^a-z0-9]/g, ''));
        
        speciesCard.innerHTML = `
          <div style="display: flex; gap: 12px; margin-bottom: 12px;">
            ${spriteDataUrl ? `
              <div style="
                width: 64px;
                height: ${isTall ? '92px' : '64px'};
                background-image: url(${spriteDataUrl});
                background-size: ${isTall ? 'auto 96%' : 'contain'};
                background-repeat: no-repeat;
                background-position: center bottom;
                border-radius: 8px;
                border: 2px solid ${isComplete ? '#8BC34A' : '#444'};
                flex-shrink: 0;
                image-rendering: pixelated;
                ${isComplete ? 'box-shadow: 0 0 20px rgba(255, 23, 68, 0.5);' : ''}
              "></div>
            ` : ''}
            <div style="flex: 1;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <strong style="color: #fff; font-size: 14px;">${formatSpeciesDisplayName(species.species)}</strong>
                  ${isComplete ? '<span style="font-size: 16px;">✨</span>' : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="color: #8BC34A; font-size: 13px; font-weight: bold;">${collectedCount}/${totalCount}</span>
                  <span style="
                    background: ${isComplete ? '#8BC34A' : '#555'};
                    color: ${isComplete ? '#000' : '#fff'};
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: bold;
                  ">${Math.round(percentage)}%</span>
                </div>
              </div>
            </div>
          </div>
          <div style="
            background: #111;
            border-radius: 8px;
            height: 6px;
            margin-bottom: 12px;
            overflow: hidden;
          ">
            <div style="
              background: ${isComplete 
                ? 'linear-gradient(90deg, #FF1744, #FF9100, #FFEA00, #00E676, #2979FF, #D500F9, #FF1744)' 
                : 'linear-gradient(90deg, #8BC34A, #66BB6A)'};
              ${isComplete ? 'background-size: 200% 100%; animation: qpm-rainbow-progress 3s linear infinite;' : ''}
              height: 100%;
              width: ${percentage}%;
              transition: width 0.5s ease;
              box-shadow: 0 0 10px ${isComplete ? 'rgba(255, 23, 68, 0.5)' : '#8BC34A77'};
            "></div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${variants.map(v => {
              const chip = getVariantChipColors(v.variant, v.collected);
              return `
                <span style="
                  padding: 6px 12px;
                  border-radius: 6px;
                  font-size: 12px;
                  background: ${chip.bg};
                  color: ${chip.text};
                  font-weight: ${chip.weight};
                  transition: all 0.2s;
                  ${v.collected ? 'box-shadow: 0 2px 4px rgba(0,0,0,0.2);' : ''}
                ">${v.collected ? '✓ ' : ''}${v.variant}</span>
              `;
            }).join('')}
          </div>
        `;

        // Add notes section
        const notesContainer = document.createElement('div');
        notesContainer.style.cssText = 'margin-top: 12px; padding-top: 12px; border-top: 1px solid #333;';
        
        const notesLabel = document.createElement('div');
        notesLabel.style.cssText = 'font-size: 11px; color: #aaa; margin-bottom: 6px; font-weight: 500;';
        notesLabel.textContent = `📝 ${t('feature.journal.notes')}`;
        notesContainer.appendChild(notesLabel);

        const notesTextarea = document.createElement('textarea');
        notesTextarea.value = getSpeciesNotes(species.species);
        notesTextarea.placeholder = t('feature.journal.notesPlaceholder');
        notesTextarea.style.cssText = `
          width: 100%;
          min-height: 60px;
          padding: 8px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid #444;
          border-radius: 4px;
          color: #fff;
          font-size: 12px;
          font-family: inherit;
          resize: vertical;
        `;
        notesTextarea.addEventListener('blur', () => {
          saveSpeciesNotes(species.species, notesTextarea.value);
        });
        notesContainer.appendChild(notesTextarea);
        speciesCard.appendChild(notesContainer);

        resultsContainer.appendChild(speciesCard);
      }
    } else if (selectedCategory === 'pets') {
      const orderedPets = summary.pets.slice().sort((a, b) => {
        const aKey = a.species.toLowerCase().replace(/[^a-z0-9]/g, '');
        const bKey = b.species.toLowerCase().replace(/[^a-z0-9]/g, '');
        const aIdx = PET_LAYOUT_INDEX.has(aKey) ? PET_LAYOUT_INDEX.get(aKey)! : Number.MAX_SAFE_INTEGER;
        const bIdx = PET_LAYOUT_INDEX.has(bKey) ? PET_LAYOUT_INDEX.get(bKey)! : Number.MAX_SAFE_INTEGER;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.species.localeCompare(b.species);
      });

      for (const species of orderedPets) {
        const variants = showMissingOnly
          ? species.variants.filter(v => !v.collected)
          : species.variants;

        if (variants.length === 0) continue;

        const variantCollected = species.variants.filter(v => v.collected).length;
        const variantTotal = species.variants.length;
        const percentage = (variantCollected / variantTotal) * 100;

        const speciesCard = document.createElement('div');

        // Add rainbow animation if all variants collected
        if (percentage === 100) {
          speciesCard.classList.add('qpm-rainbow-complete');
          speciesCard.style.cssText = `
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 10px;
            border: 1px solid #333;
            transition: all 0.2s;
          `;
        } else {
          speciesCard.style.cssText = `
            background: linear-gradient(135deg, #1f1f1f, #1a1a1a);
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 10px;
            border: 1px solid #333;
            transition: all 0.2s;
          `;
        }

        speciesCard.addEventListener('mouseenter', () => {
          if (percentage !== 100) {
            speciesCard.style.borderColor = '#42A5F544';
          }
          speciesCard.style.transform = 'translateX(4px)';
        });
        speciesCard.addEventListener('mouseleave', () => {
          if (percentage !== 100) {
            speciesCard.style.borderColor = '#333';
          }
          speciesCard.style.transform = 'translateX(0)';
        });

        const isComplete = percentage === 100;
        const normalizedPetName = normalizeSpeciesName(species.species);
        
        // Apply rainbow mutation to pet sprite if all variants collected
        let petSprite: string | null = null;
        if (isComplete) {
          const rainbowSprite =
            canvasToDataUrl(getPetSpriteWithMutations(normalizedPetName, ['Rainbow'])) ||
            canvasToDataUrl(getPetSpriteWithMutations(species.species, ['Rainbow']));
          petSprite =
            rainbowSprite ||
            canvasToDataUrl(getPetSpriteCanvas(normalizedPetName)) ||
            canvasToDataUrl(getPetSpriteCanvas(species.species.toLowerCase()));
        } else {
          petSprite =
            canvasToDataUrl(getPetSpriteCanvas(normalizedPetName)) ||
            canvasToDataUrl(getPetSpriteCanvas(species.species.toLowerCase()));
        }
        
        const imageHtml = petSprite
          ? `<div style="
                width: 64px;
                height: 64px;
                background-image: url(${petSprite});
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                border-radius: 8px;
                border: 2px solid ${isComplete ? '#42A5F5' : '#444'};
                flex-shrink: 0;
                image-rendering: pixelated;
                ${isComplete ? 'box-shadow: 0 0 20px rgba(66, 165, 245, 0.5);' : ''}
              "></div>`
          : `<div style="
                width: 64px;
                height: 64px;
                background: linear-gradient(135deg, ${isComplete ? '#42A5F5' : '#333'}, ${isComplete ? '#64B5F6' : '#222'});
                border-radius: 8px;
                border: 2px solid ${isComplete ? '#42A5F5' : '#444'};
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 32px;
                ${isComplete ? 'box-shadow: 0 0 20px #42A5F566;' : ''}
              ">??</div>`;
        
        let html = `
          <div style="display: flex; gap: 12px; margin-bottom: 12px;">
            ${imageHtml}
            <div style="flex: 1;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <strong style="color: #fff; font-size: 14px;">${formatSpeciesDisplayName(species.species)}</strong>
                  ${isComplete ? '<span style="font-size: 16px;">✨</span>' : ''}
                </div>
                <span style="
                  background: ${isComplete ? '#42A5F5' : '#555'};
                  color: ${isComplete ? '#000' : '#fff'};
                  padding: 2px 8px;
                  border-radius: 12px;
                  font-size: 11px;
                  font-weight: bold;
                ">${Math.round(percentage)}%</span>
              </div>
            </div>
          </div>
          <div style="
            background: #111;
            border-radius: 8px;
            height: 6px;
            margin-bottom: 12px;
            overflow: hidden;
          ">
            <div style="
              background: ${isComplete 
                ? 'linear-gradient(90deg, #FF1744, #FF9100, #FFEA00, #00E676, #2979FF, #D500F9, #FF1744)' 
                : 'linear-gradient(90deg, #42A5F5, #64B5F6)'};
              ${isComplete ? 'background-size: 200% 100%; animation: qpm-rainbow-progress 3s linear infinite;' : ''}
              height: 100%;
              width: ${percentage}%;
              transition: width 0.5s ease;
              box-shadow: 0 0 10px ${isComplete ? 'rgba(66, 165, 245, 0.5)' : '#42A5F577'};
            "></div>
          </div>
        `;
        if (variants.length > 0) {
          html += `
            <div style="margin-bottom: 12px;">
              <div style="color: #42A5F5; font-size: 11px; font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                ${t('feature.journal.variantsCount', { collected: String(variantCollected), total: String(variantTotal) })}
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${variants.map(v => {
                  const chip = getVariantChipColors(v.variant, v.collected);
                  return `
                    <span style="
                      padding: 6px 12px;
                      border-radius: 6px;
                      font-size: 12px;
                      background: ${chip.bg};
                      color: ${chip.text};
                      font-weight: ${chip.weight};
                      ${v.collected ? 'box-shadow: 0 2px 4px rgba(0,0,0,0.2);' : ''}
                    ">${v.collected ? '✓ ' : ''}${v.variant}</span>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }

        speciesCard.innerHTML = html;
        
        // Add notes section for pets
        const notesContainer = document.createElement('div');
        notesContainer.style.cssText = 'margin-top: 12px; padding-top: 12px; border-top: 1px solid #333;';
        
        const notesLabel = document.createElement('div');
        notesLabel.style.cssText = 'font-size: 11px; color: #aaa; margin-bottom: 6px; font-weight: 500;';
        notesLabel.textContent = `📝 ${t('feature.journal.notes')}`;
        notesContainer.appendChild(notesLabel);

        const notesTextarea = document.createElement('textarea');
        notesTextarea.value = getSpeciesNotes(`pet:${species.species}`);
        notesTextarea.placeholder = t('feature.journal.notesPlaceholder');
        notesTextarea.style.cssText = `
          width: 100%;
          min-height: 60px;
          padding: 8px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid #444;
          border-radius: 4px;
          color: #fff;
          font-size: 12px;
          font-family: inherit;
          resize: vertical;
        `;
        notesTextarea.addEventListener('blur', () => {
          saveSpeciesNotes(`pet:${species.species}`, notesTextarea.value);
        });
        notesContainer.appendChild(notesTextarea);
        speciesCard.appendChild(notesContainer);
        
        resultsContainer.appendChild(speciesCard);
      }
    } else if (selectedCategory === 'recommendations') {
      // Load recommendations
      const { generateJournalStrategy, getDifficultyEmoji, getPriorityEmoji, getDifficultyDescription } = await import('../features/journalRecommendations');
      const strategy = await generateJournalStrategy();

      if (!strategy) {
        resultsContainer.innerHTML = '';
        const recErrorDiv = document.createElement('div');
        recErrorDiv.style.cssText = 'color: #999; text-align: center; padding: 40px; font-size: 14px;';
        recErrorDiv.textContent = `⚠️ ${t('feature.journal.unableToRecommend')}`;
        const recErrorSub = document.createElement('span');
        recErrorSub.style.cssText = 'font-size: 12px; color: #666;';
        recErrorSub.textContent = t('feature.journal.tryRefreshingConsole');
        recErrorDiv.appendChild(document.createElement('br'));
        recErrorDiv.appendChild(recErrorSub);
        resultsContainer.appendChild(recErrorDiv);
        return;
      }

      // Recommended Focus Section
      if (strategy.recommendedFocus.length > 0) {
        const focusSection = document.createElement('div');
        focusSection.style.cssText = `
          margin-bottom: 24px;
        `;
        const focusTitle = document.createElement('div');
        focusTitle.style.cssText = 'font-size: 16px; font-weight: bold; color: #9C27B0; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #9C27B033;';
        focusTitle.textContent = `🎯 ${t('feature.journal.recommendedFocus', { count: String(Math.min(10, strategy.recommendedFocus.length)) })}`;
        focusSection.appendChild(focusTitle);

        strategy.recommendedFocus.slice(0, 10).forEach(rec => {
          const recCard = document.createElement('div');
          recCard.style.cssText = `
            background: linear-gradient(135deg, #1f1f1f, #1a1a1a);
            border-left: 4px solid ${rec.priority === 'high' ? '#f44336' : rec.priority === 'medium' ? '#ff9800' : '#666'};
            border-radius: 8px;
            padding: 14px;
            margin-bottom: 10px;
            transition: all 0.2s;
          `;

          recCard.addEventListener('mouseenter', () => {
            recCard.style.transform = 'translateX(4px)';
            recCard.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
          });
          recCard.addEventListener('mouseleave', () => {
            recCard.style.transform = 'translateX(0)';
            recCard.style.boxShadow = 'none';
          });

          const priorityBadge = rec.priority === 'high' ? t('feature.journal.priorityHigh') : rec.priority === 'medium' ? t('feature.journal.priorityMed') : t('feature.journal.priorityLow');
          const priorityColor = rec.priority === 'high' ? '#f44336' : rec.priority === 'medium' ? '#ff9800' : '#666';

          // Get sprite for this species (pet recommendations prioritize Rainbow/Gold variants)
          const spriteUrl = getRecommendationSpriteUrl(rec);

          const spriteHtml = spriteUrl
            ? `<img src="${spriteUrl}" alt="${rec.species}" style="width: 32px; height: 32px; image-rendering: pixelated;">`
            : `<span style="font-size: 18px;">${rec.type === 'produce' ? '🌿' : '🐾'}</span>`;

          recCard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                ${spriteHtml}
                <strong style="color: #fff; font-size: 14px;">${rec.species}</strong>
              </div>
              <div style="display: flex; gap: 6px;">
                <span style="
                  background: ${priorityColor}33;
                  color: ${priorityColor};
                  padding: 2px 8px;
                  border-radius: 4px;
                  font-size: 10px;
                  font-weight: bold;
                ">${priorityBadge}</span>
                <span style="
                  background: #555;
                  color: #fff;
                  padding: 2px 8px;
                  border-radius: 4px;
                  font-size: 10px;
                  font-weight: bold;
                ">${getDifficultyEmoji(rec.difficulty)} ${getDifficultyDescription(rec.difficulty)}</span>
              </div>
            </div>
            <div style="
              background: #111;
              border-radius: 8px;
              height: 4px;
              margin-bottom: 8px;
              overflow: hidden;
            ">
              <div style="
                background: linear-gradient(90deg, #9C27B0, #BA68C8);
                height: 100%;
                width: ${rec.completionPct}%;
                box-shadow: 0 0 8px #9C27B077;
              "></div>
            </div>
            <div style="color: #aaa; font-size: 11px; margin-bottom: 6px;">
              <strong style="color: #9C27B0;">${t('feature.journal.pctComplete', { pct: rec.completionPct.toFixed(0) })}</strong> • ${rec.missingVariants.length !== 1 ? t('feature.journal.variantsRemaining', { count: String(rec.missingVariants.length) }) : t('feature.journal.variantRemaining', { count: String(rec.missingVariants.length) })} • ${t('feature.journal.estTime', { time: rec.estimatedTime })}
            </div>
            <div style="color: #ccc; font-size: 12px; margin-bottom: 8px; line-height: 1.4;">
              ${rec.strategy}
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
              ${rec.missingVariants.map(v => `
                <span style="
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 10px;
                  background: #333;
                  color: #999;
                ">${v}</span>
              `).join('')}
            </div>
          `;

          focusSection.appendChild(recCard);
        });

        resultsContainer.appendChild(focusSection);
      }

      // Low-Hanging Fruit Section
      if (strategy.lowHangingFruit.length > 0) {
        const fruitSection = document.createElement('div');
        fruitSection.style.cssText = `
          margin-bottom: 24px;
        `;
        const quickWinsTitle = document.createElement('div');
        quickWinsTitle.style.cssText = 'font-size: 16px; font-weight: bold; color: #4CAF50; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #4CAF5033;';
        quickWinsTitle.textContent = `🍒 ${t('feature.journal.quickWins')}`;
        fruitSection.appendChild(quickWinsTitle);

        strategy.lowHangingFruit.slice(0, 5).forEach(rec => {
          const fruitCard = document.createElement('div');
          fruitCard.style.cssText = `
            background: #1a1a1a;
            border: 1px solid #4CAF5033;
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s;
          `;

          fruitCard.addEventListener('mouseenter', () => {
            fruitCard.style.background = '#1f1f1f';
            fruitCard.style.borderColor = '#4CAF5055';
          });
          fruitCard.addEventListener('mouseleave', () => {
            fruitCard.style.background = '#1a1a1a';
            fruitCard.style.borderColor = '#4CAF5033';
          });

          // Get sprite for the species (pet recommendations prioritize Rainbow/Gold variants)
          const spriteUrl = getRecommendationSpriteUrl(rec);

          fruitCard.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
              ${spriteUrl ? `<img src="${spriteUrl}" style="width: 32px; height: 32px; image-rendering: pixelated;" alt="${rec.species}" />` : `<span style="font-size: 20px;">${rec.type === 'produce' ? '🌿' : '🐾'}</span>`}
              <div>
                <div style="font-size: 13px; font-weight: 600; color: #fff;">${rec.species}</div>
                <div style="font-size: 10px; color: #999;">${rec.missingVariants.join(', ')}</div>
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 11px; color: #4CAF50; font-weight: bold;">${rec.estimatedTime}</div>
              <div style="font-size: 10px; color: #666;">${getDifficultyEmoji(rec.difficulty)} ${getDifficultyDescription(rec.difficulty)}</div>
            </div>
          `;

          fruitSection.appendChild(fruitCard);
        });

        resultsContainer.appendChild(fruitSection);
      }

      // Fastest Path Section
      if (strategy.fastestPath.steps.length > 0) {
        const pathSection = document.createElement('div');
        pathSection.style.cssText = `
          margin-bottom: 24px;
        `;
        const pathTitle = document.createElement('div');
        pathTitle.style.cssText = 'font-size: 16px; font-weight: bold; color: #FF9800; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #FF980033;';
        pathTitle.textContent = `🚀 ${t('feature.journal.fastestPath', { count: String(strategy.fastestPath.expectedCompletion) })}`;
        pathSection.appendChild(pathTitle);

        const pathInfo = document.createElement('div');
        pathInfo.style.cssText = 'background: #FF980022; border-left: 3px solid #FF9800; border-radius: 6px; padding: 12px; margin-bottom: 12px;';
        const pathTime = document.createElement('div');
        pathTime.style.cssText = 'font-size: 12px; color: #FF9800; font-weight: 600; margin-bottom: 4px;';
        pathTime.textContent = `⏱️ ${t('feature.journal.estimatedTime', { time: strategy.fastestPath.estimatedTime })}`;
        const pathDesc = document.createElement('div');
        pathDesc.style.cssText = 'font-size: 11px; color: #aaa;';
        pathDesc.textContent = t('feature.journal.completeSpecies', { count: String(strategy.fastestPath.steps.length) });
        pathInfo.appendChild(pathTime);
        pathInfo.appendChild(pathDesc);
        pathSection.appendChild(pathInfo);

        strategy.fastestPath.steps.slice(0, 8).forEach((rec, index) => {
          const stepCard = document.createElement('div');
          stepCard.style.cssText = `
            background: #1a1a1a;
            border-left: 3px solid #FF9800;
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 10px;
          `;

          // Get sprite for the species (pet recommendations prioritize Rainbow/Gold variants)
          const spriteUrl = getRecommendationSpriteUrl(rec);

          stepCard.innerHTML = `
            <div style="
              background: #FF9800;
              color: #000;
              width: 24px;
              height: 24px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 11px;
              font-weight: bold;
              flex-shrink: 0;
            ">${index + 1}</div>
            ${spriteUrl ? `<img src="${spriteUrl}" style="width: 28px; height: 28px; image-rendering: pixelated; flex-shrink: 0;" alt="${rec.species}" />` : `<span style="font-size: 18px; flex-shrink: 0;">${rec.type === 'produce' ? '🌿' : '🐾'}</span>`}
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 12px; font-weight: 600; color: #fff; margin-bottom: 2px;">
                ${rec.species} (${rec.missingVariants.join(', ')})
              </div>
              <div style="font-size: 10px; color: #999;">${rec.estimatedTime} • ${getDifficultyEmoji(rec.difficulty)} ${getDifficultyDescription(rec.difficulty)}</div>
            </div>
          `;

          pathSection.appendChild(stepCard);
        });

        resultsContainer.appendChild(pathSection);
      }

      // Long-Term Goals Section
      if (strategy.longTermGoals.length > 0) {
        const goalsSection = document.createElement('div');
        goalsSection.style.cssText = `
          margin-bottom: 24px;
        `;
        const goalsTitle = document.createElement('div');
        goalsTitle.style.cssText = 'font-size: 16px; font-weight: bold; color: #f44336; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #f4433633;';
        goalsTitle.textContent = `🎖️ ${t('feature.journal.longTermChallenges')}`;
        goalsSection.appendChild(goalsTitle);

        const goalsWarning = document.createElement('div');
        goalsWarning.style.cssText = 'background: #f4433622; border-left: 3px solid #f44336; border-radius: 6px; padding: 10px; margin-bottom: 12px; font-size: 11px; color: #f44336;';
        goalsWarning.textContent = `⚠️ ${t('feature.journal.longTermWarning')}`;
        goalsSection.appendChild(goalsWarning);

        strategy.longTermGoals.slice(0, 5).forEach(rec => {
          const goalCard = document.createElement('div');
          goalCard.style.cssText = `
            background: #1a1a1a;
            border: 1px solid #f4433633;
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 8px;
          `;

          // Get sprite for the species (pet recommendations prioritize Rainbow/Gold variants)
          const spriteUrl = getRecommendationSpriteUrl(rec);

          goalCard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                ${spriteUrl ? `<img src="${spriteUrl}" style="width: 32px; height: 32px; image-rendering: pixelated;" alt="${rec.species}" />` : `<span style="font-size: 20px;">${rec.type === 'produce' ? '🌿' : '🐾'}</span>`}
                <strong style="color: #fff; font-size: 13px;">${rec.species}</strong>
              </div>
              <span style="font-size: 20px;">${getDifficultyEmoji(rec.difficulty)}</span>
            </div>
            <div style="font-size: 11px; color: #aaa; margin-bottom: 6px;">
              ${rec.missingVariants.join(', ')}
            </div>
            <div style="font-size: 10px; color: #999; line-height: 1.4;">
              ${rec.strategy}
            </div>
          `;

          goalsSection.appendChild(goalCard);
        });

        resultsContainer.appendChild(goalsSection);
      }
    }
  };

  categories.forEach(cat => {
    const isActive = selectedCategory === cat.key || (cat.key === 'missing' && showMissingOnly);
    const button = document.createElement('button');
    button.textContent = `${cat.icon} ${cat.label}`;
    button.style.cssText = `
      flex: 1;
      padding: 10px 18px;
      border-radius: 8px;
      border: 2px solid ${isActive ? cat.color : '#333'};
      background: ${isActive ? `${cat.color}22` : '#222'};
      color: ${isActive ? cat.color : '#999'};
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
      min-width: 110px;
    `;

    button.addEventListener('mouseenter', () => {
      if (!isActive) {
        button.style.background = '#2a2a2a';
        button.style.borderColor = '#444';
        button.style.color = '#ccc';
      }
    });
    button.addEventListener('mouseleave', () => {
      if (!isActive) {
        button.style.background = '#222';
        button.style.borderColor = '#333';
        button.style.color = '#999';
      }
    });

    button.addEventListener('click', () => {
      if (cat.key === 'missing') {
        showMissingOnly = !showMissingOnly;
      } else {
        selectedCategory = cat.key;
        showMissingOnly = false;
      }

      // Update all button styles
      categoryContainer.querySelectorAll('button').forEach((btn, idx) => {
        const category = categories[idx];
        if (!category) return;
        const isActive = selectedCategory === category.key || (category.key === 'missing' && showMissingOnly);
        (btn as HTMLButtonElement).style.background = isActive ? `${category.color}22` : '#222';
        (btn as HTMLButtonElement).style.borderColor = isActive ? category.color : '#333';
        (btn as HTMLButtonElement).style.color = isActive ? category.color : '#999';
      });

      updateDisplay();
    });

    categoryContainer.appendChild(button);
  });

  root.appendChild(categoryContainer);

  // Tooltip Helper toggle (controls crop tooltip indicators)
  const helperToggleCard = document.createElement('div');
  helperToggleCard.style.cssText = `
    margin: 0 0 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #2a2a2a;
    background: rgba(255, 255, 255, 0.03);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  `;

  const helperText = document.createElement('div');
  const helperTitle = document.createElement('div');
  helperTitle.style.cssText = 'font-size: 13px; font-weight: 600; color: #fff;';
  helperTitle.textContent = t('feature.journal.tooltipHelper');
  const helperDesc = document.createElement('div');
  helperDesc.style.cssText = 'font-size: 11px; color: #bbb;';
  helperDesc.textContent = t('feature.journal.tooltipHelperDesc');
  helperText.appendChild(helperTitle);
  helperText.appendChild(helperDesc);
  helperToggleCard.appendChild(helperText);

  const helperToggleButton = document.createElement('button');
  helperToggleButton.type = 'button';
  helperToggleButton.style.cssText = `
    border-radius: 999px;
    border: 2px solid #333;
    padding: 6px 18px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
    min-width: 72px;
  `;

  const applyToggleState = (enabled: boolean) => {
    helperToggleButton.textContent = enabled ? t('feature.dashboard.toggleOn') : t('feature.dashboard.toggleOff');
    helperToggleButton.style.background = enabled
      ? 'linear-gradient(135deg, #5ad1ff, #35a8f7)'
      : 'rgba(0, 0, 0, 0.3)';
    helperToggleButton.style.borderColor = enabled ? '#5ad1ff' : '#333';
    helperToggleButton.style.color = enabled ? '#00223b' : '#777';
    helperToggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  };

  let tooltipHelperEnabled = getCropSizeIndicatorConfig().showJournalIndicators !== false;
  applyToggleState(tooltipHelperEnabled);

  helperToggleButton.addEventListener('click', () => {
    tooltipHelperEnabled = !tooltipHelperEnabled;
    applyToggleState(tooltipHelperEnabled);
    setCropSizeIndicatorConfig({ showJournalIndicators: tooltipHelperEnabled });
  });

  helperToggleCard.appendChild(helperToggleButton);
  root.appendChild(helperToggleCard);

  // Results container with custom scrollbar
  const resultsContainer = document.createElement('div');
  resultsContainer.style.cssText = `
    flex: 1;
    min-height: 0;
    max-height: none;
    overflow-y: auto;
    padding-right: 4px;
  `;

  // Add custom scrollbar styling
  const scrollbarStyle = document.createElement('style');
  scrollbarStyle.textContent = `
    div[data-qpm-section="journal-checker"] ::-webkit-scrollbar {
      width: 8px;
    }
    div[data-qpm-section="journal-checker"] ::-webkit-scrollbar-track {
      background: #1a1a1a;
      border-radius: 4px;
    }
    div[data-qpm-section="journal-checker"] ::-webkit-scrollbar-thumb {
      background: #444;
      border-radius: 4px;
    }
    div[data-qpm-section="journal-checker"] ::-webkit-scrollbar-thumb:hover {
      background: #555;
    }

    /* Rainbow animation for completed items */
    @keyframes qpm-rainbow-border {
      0% { border-color: #ff0000; box-shadow: 0 0 20px #ff000044, inset 0 0 20px #ff000011; }
      16.67% { border-color: #ff8800; box-shadow: 0 0 20px #ff880044, inset 0 0 20px #ff880011; }
      33.33% { border-color: #ffff00; box-shadow: 0 0 20px #ffff0044, inset 0 0 20px #ffff0011; }
      50% { border-color: #00ff00; box-shadow: 0 0 20px #00ff0044, inset 0 0 20px #00ff0011; }
      66.67% { border-color: #0088ff; box-shadow: 0 0 20px #0088ff44, inset 0 0 20px #0088ff11; }
      83.33% { border-color: #8800ff; box-shadow: 0 0 20px #8800ff44, inset 0 0 20px #8800ff11; }
      100% { border-color: #ff0000; box-shadow: 0 0 20px #ff000044, inset 0 0 20px #ff000011; }
    }

    @keyframes qpm-rainbow-gradient {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    .qpm-rainbow-complete {
      animation: qpm-rainbow-border 3s linear infinite, qpm-rainbow-gradient 8s ease infinite;
      border-width: 2px !important;
      background: linear-gradient(
        135deg,
        #ff0000 0%,
        #ff8800 16.67%,
        #ffff00 33.33%,
        #00ff00 50%,
        #0088ff 66.67%,
        #8800ff 83.33%,
        #ff0000 100%
      );
      background-size: 400% 400%;
    }

    .qpm-rainbow-complete strong {
      color: #000 !important;
      text-shadow: 0 0 2px rgba(255, 255, 255, 0.5);
    }

    .qpm-rainbow-complete span[style*="color"] {
      color: #000 !important;
    }
  `;
  document.head.appendChild(scrollbarStyle);

  root.appendChild(resultsContainer);

  // Refresh button with icon
  const refreshButton = document.createElement('button');
  refreshButton.textContent = `🔄 ${t('feature.journal.refresh')}`;
  refreshButton.style.cssText = `
    width: 100%;
    flex-shrink: 0;
    padding: 12px;
    margin-top: 10px;
    border-radius: 8px;
    border: 2px solid #333;
    background: linear-gradient(135deg, #2a2a2a, #222);
    color: #fff;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: all 0.2s;
  `;

  refreshButton.addEventListener('mouseenter', () => {
    refreshButton.style.background = 'linear-gradient(135deg, #333, #2a2a2a)';
    refreshButton.style.borderColor = '#444';
    refreshButton.style.transform = 'translateY(-2px)';
    refreshButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
  });
  refreshButton.addEventListener('mouseleave', () => {
    refreshButton.style.background = 'linear-gradient(135deg, #2a2a2a, #222)';
    refreshButton.style.borderColor = '#333';
    refreshButton.style.transform = 'translateY(0)';
    refreshButton.style.boxShadow = 'none';
  });

  refreshButton.addEventListener('click', () => {
    refreshButton.textContent = `⏳ ${t('common.loading')}`;
    refreshButton.style.opacity = '0.6';
    import('../features/journalChecker').then(m => {
      m.refreshJournalCache();
      updateDisplay().then(() => {
        refreshButton.textContent = `🔄 ${t('feature.journal.refresh')}`;
        refreshButton.style.opacity = '1';
      });
    });
  });

  root.appendChild(refreshButton);

  // Initial load
  updateDisplay();

  return root;
}
