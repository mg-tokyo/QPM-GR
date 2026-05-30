// src/ui/locker/lockerPlantPicker.ts
// Plant species picker dropdown for the Locker custom rules builder.
// Bug fix #1: document click listener only lives while dropdown is open.

import { areCatalogsReady, getAllPlantSpecies } from '../../catalogs/gameCatalogs';
import { getCropSpriteDataUrl } from '../../sprite-v2/compat';
import { RARITY_COLORS } from '../shop/restockWindowConstants';
import { t } from '../../i18n';
import {
  UNLOCKED_BG, UNLOCKED_BORDER, HOVER_BG, HOVER_BORDER, TEXT_MUTED,
  makeHint, forEachRarityGroup,
} from './lockerPrimitives';

// ── Constants ───────────────────────────────────────────────────────────────

const PICKER_TILE = 44;
const PICKER_SPRITE = 30;

// ── Picker sprite tile ──────────────────────────────────────────────────────

function makePickerSpriteTile(
  species: string,
  spriteUrl: string,
  onClick: () => void,
): HTMLElement {
  const tile = document.createElement('div');
  tile.title = species;
  tile.style.cssText = `width:${PICKER_TILE}px;height:${PICKER_TILE + 14}px;display:flex;flex-direction:column;align-items:center;gap:1px;padding:4px 2px 2px;border-radius:6px;cursor:pointer;border:1.5px solid ${UNLOCKED_BORDER};background:${UNLOCKED_BG};transition:background .1s,border-color .1s`;

  if (spriteUrl) {
    const img = document.createElement('img');
    img.alt = species;
    img.src = spriteUrl;
    img.style.cssText = `width:${PICKER_SPRITE}px;height:${PICKER_SPRITE}px;image-rendering:pixelated;object-fit:contain`;
    tile.appendChild(img);
  } else {
    const fb = document.createElement('div');
    fb.textContent = species.slice(0, 3).toUpperCase();
    fb.style.cssText = `width:${PICKER_SPRITE}px;height:${PICKER_SPRITE}px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:${TEXT_MUTED};background:rgba(255,255,255,0.06);border-radius:4px`;
    tile.appendChild(fb);
  }

  const name = document.createElement('div');
  name.textContent = species;
  name.style.cssText = `font-size:8px;text-align:center;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${PICKER_TILE}px;color:${TEXT_MUTED}`;
  tile.appendChild(name);

  tile.addEventListener('mouseenter', () => { tile.style.background = HOVER_BG; tile.style.borderColor = HOVER_BORDER; });
  tile.addEventListener('mouseleave', () => { tile.style.background = UNLOCKED_BG; tile.style.borderColor = UNLOCKED_BORDER; });
  tile.addEventListener('click', onClick);

  return tile;
}

// ── Picker dropdown content (rarity-grouped) ───────────────────────────────

function buildPickerDropdownContent(
  dropdown: HTMLElement,
  speciesList: string[],
  onPick: (sp: string) => void,
): void {
  dropdown.innerHTML = '';
  if (speciesList.length === 0) {
    dropdown.appendChild(makeHint(t('feature.locker.noPlantsAvailable')));
    return;
  }

  forEachRarityGroup(speciesList, (rarity, list) => {
    const color = RARITY_COLORS[rarity] ?? RARITY_COLORS.common ?? '#E7E7E7';
    const groupWrap = document.createElement('div');
    groupWrap.style.cssText = `border-radius:6px;padding:4px 6px;margin-bottom:4px;border:1px solid ${color}20;background:${color}06`;
    const hdr = document.createElement('div');
    hdr.textContent = rarity;
    hdr.style.cssText = `font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:${color};padding:0 2px 3px;text-align:center`;
    groupWrap.appendChild(hdr);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;justify-content:center';
    for (const sp of list.sort()) {
      grid.appendChild(makePickerSpriteTile(sp, getCropSpriteDataUrl(sp), () => onPick(sp)));
    }
    groupWrap.appendChild(grid);
    dropdown.appendChild(groupWrap);
  });
}

// ── Plant picker (exported) ─────────────────────────────────────────────────

export function buildPlantPicker(
  selected: string | null,
  eligible: Set<string>,
  onSelect: (species: string | null) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative';

  let showAll = false;
  let docListener: ((e: MouseEvent) => void) | null = null;

  // Trigger button
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;font-size:11px;cursor:pointer;min-width:120px;text-align:left`;

  const updateTrigger = (sp: string | null): void => {
    trigger.innerHTML = '';
    if (sp) {
      const url = getCropSpriteDataUrl(sp);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = sp;
        img.style.cssText = 'width:24px;height:24px;image-rendering:pixelated;object-fit:contain;flex-shrink:0';
        trigger.appendChild(img);
      }
      const lbl = document.createElement('span');
      lbl.textContent = sp;
      trigger.appendChild(lbl);
    } else {
      const lbl = document.createElement('span');
      lbl.textContent = t('feature.locker.selectPlant');
      lbl.style.color = TEXT_MUTED as string;
      trigger.appendChild(lbl);
    }
    const chev = document.createElement('span');
    chev.textContent = '\u25BE';
    chev.style.cssText = `margin-left:auto;color:${TEXT_MUTED};font-size:10px`;
    trigger.appendChild(chev);
  };
  updateTrigger(selected);

  // Dropdown panel
  const dropdown = document.createElement('div');
  dropdown.style.cssText = `display:none;position:absolute;top:100%;left:0;right:0;z-index:100;margin-top:4px;max-height:320px;overflow-y:auto;border-radius:8px;border:1px solid rgba(143,130,255,0.4);background:rgba(18,20,26,0.97);padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5)`;

  // Content container (below show-all toggle)
  const contentSlot = document.createElement('div');

  // Show All toggle inside dropdown
  const toggleRow = document.createElement('div');
  toggleRow.style.cssText = 'display:flex;justify-content:flex-end;padding:0 0 4px';
  const showAllBtn = document.createElement('button');
  showAllBtn.type = 'button';
  showAllBtn.textContent = t('feature.locker.showAll');
  showAllBtn.style.cssText = `background:none;border:none;color:${TEXT_MUTED};font-size:10px;cursor:pointer;padding:2px 4px;text-decoration:underline`;
  showAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showAll = !showAll;
    showAllBtn.textContent = showAll ? t('feature.locker.showEligible') : t('feature.locker.showAll');
    rebuildContent();
  });
  toggleRow.appendChild(showAllBtn);
  dropdown.append(toggleRow, contentSlot);

  const pickHandler = (sp: string): void => {
    onSelect(sp);
    updateTrigger(sp);
    closeDropdown();
  };

  function rebuildContent(): void {
    if (!areCatalogsReady()) {
      contentSlot.innerHTML = '';
      contentSlot.appendChild(makeHint(t('feature.locker.plantCatalogNotLoaded')));
      return;
    }
    const all = getAllPlantSpecies();
    const filtered = showAll ? all : all.filter(sp => eligible.has(sp));
    buildPickerDropdownContent(contentSlot, filtered, pickHandler);
  }

  rebuildContent();

  let isOpen = false;

  // Bug fix #1: listener only active while dropdown is open
  const openDropdown = (): void => {
    dropdown.style.display = 'block';
    isOpen = true;
    docListener = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) closeDropdown();
    };
    document.addEventListener('click', docListener, true);
  };

  const closeDropdown = (): void => {
    dropdown.style.display = 'none';
    isOpen = false;
    if (docListener) {
      document.removeEventListener('click', docListener, true);
      docListener = null;
    }
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) { closeDropdown(); return; }
    openDropdown();
  });

  wrap.append(trigger, dropdown);
  return wrap;
}
