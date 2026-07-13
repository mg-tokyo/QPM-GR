import { getCropSpriteDataUrl, getPetSpriteDataUrl } from '../../../sprite-v2/compat';
import { t } from '../../../i18n';
import { BORDER_ACTIVE, BORDER_SUBTLE, TEXT, MUTED, CARD_BG, HOVER_BG } from './constants';
import { el, fullFmt, makeCoinIcon } from './domHelpers';
import type { PlantOption, PetOption } from './types';

export function buildPlantSelector(
  plants: PlantOption[],
  initial: PlantOption | null,
  onSelect: (plant: PlantOption) => void,
): { container: HTMLElement; refresh: (plants: PlantOption[]) => void } {
  const container = el('div', 'position:relative;');

  const btn = el(
    'button',
    [
      'width:100%',
      'padding:10px 14px',
      'font-size:14px',
      'border-radius:8px',
      `border:1px solid ${BORDER_SUBTLE}`,
      `background:${CARD_BG}`,
      `color:${TEXT}`,
      'cursor:pointer',
      'text-align:left',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'font-family:inherit',
    ].join(';'),
  );
  btn.type = 'button';

  const btnIcon = el('img', 'width:28px;height:28px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;');
  const btnLabel = el('span', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;');
  const btnPrice = el('span', 'display:flex;align-items:center;gap:3px;flex-shrink:0;white-space:nowrap;');
  const btnArrow = el('span', `color:${MUTED};flex-shrink:0;font-size:12px;`, '▼');

  btn.append(btnIcon, btnLabel, btnPrice, btnArrow);
  container.appendChild(btn);

  const dropdown = el(
    'div',
    [
      'position:absolute',
      'top:100%',
      'left:0',
      'right:0',
      'z-index:50',
      'margin-top:4px',
      'background:rgba(18,20,26,0.98)',
      `border:1px solid ${BORDER_ACTIVE}`,
      'border-radius:8px',
      'max-height:280px',
      'display:none',
      'flex-direction:column',
      'overflow:hidden',
    ].join(';'),
  );
  container.appendChild(dropdown);

  const searchInput = el(
    'input',
    [
      'width:100%',
      'box-sizing:border-box',
      'padding:8px 12px',
      'font-size:13px',
      `border-bottom:1px solid ${BORDER_SUBTLE}`,
      'border:none',
      `border-bottom:1px solid ${BORDER_SUBTLE}`,
      'background:transparent',
      `color:${TEXT}`,
      'outline:none',
      'font-family:inherit',
    ].join(';'),
  );
  (searchInput as HTMLInputElement).type = 'text';
  (searchInput as HTMLInputElement).placeholder = t('feature.cropCalc.searchCrops');
  dropdown.appendChild(searchInput);

  const listContainer = el('div', 'flex:1;overflow-y:auto;max-height:240px;');
  dropdown.appendChild(listContainer);

  let currentPlants = plants;
  let isOpen = false;

  function updateBtn(plant: PlantOption | null): void {
    if (!plant) {
      (btnIcon as HTMLImageElement).style.display = 'none';
      btnLabel.textContent = t('feature.cropCalc.selectCrop');
      btnPrice.innerHTML = '';
      return;
    }
    const spriteUrl = getCropSpriteDataUrl(plant.key);
    if (spriteUrl) {
      (btnIcon as HTMLImageElement).src = spriteUrl;
      (btnIcon as HTMLImageElement).style.display = '';
    } else {
      (btnIcon as HTMLImageElement).style.display = 'none';
    }
    btnLabel.textContent = plant.name;
    btnPrice.innerHTML = '';
    btnPrice.append(makeCoinIcon(16), document.createTextNode(` ${fullFmt.format(plant.baseSellPrice)}`));
  }

  function renderList(filter: string): void {
    listContainer.innerHTML = '';
    const lower = filter.toLowerCase();
    const filtered = lower ? currentPlants.filter((p) => p.name.toLowerCase().includes(lower)) : currentPlants;

    for (const plant of filtered) {
      const row = el(
        'div',
        [
          'display:flex',
          'align-items:center',
          'gap:10px',
          'padding:7px 12px',
          'cursor:pointer',
          'transition:background 0.1s',
        ].join(';'),
      );
      row.addEventListener('mouseenter', () => { row.style.background = HOVER_BG; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      const icon = el('img', 'width:24px;height:24px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;');
      const spriteUrl = getCropSpriteDataUrl(plant.key);
      if (spriteUrl) {
        (icon as HTMLImageElement).src = spriteUrl;
      } else {
        icon.style.display = 'none';
      }

      const name = el('span', `flex:1;font-size:13px;color:${TEXT};`, plant.name);
      const priceWrap = el('span', 'display:flex;align-items:center;gap:3px;flex-shrink:0;');
      priceWrap.append(makeCoinIcon(14), el('span', `font-size:11px;color:${MUTED};`, fullFmt.format(plant.baseSellPrice)));

      row.append(icon, name, priceWrap);
      row.addEventListener('click', () => {
        onSelect(plant);
        updateBtn(plant);
        close();
      });
      listContainer.appendChild(row);
    }

    if (filtered.length === 0) {
      listContainer.appendChild(el('div', `padding:12px;text-align:center;color:${MUTED};font-size:12px;`, t('feature.cropCalc.noResults')));
    }
  }

  function open(): void {
    isOpen = true;
    dropdown.style.display = 'flex';
    (searchInput as HTMLInputElement).value = '';
    renderList('');
    (searchInput as HTMLInputElement).focus();
  }

  function close(): void {
    isOpen = false;
    dropdown.style.display = 'none';
  }

  btn.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  searchInput.addEventListener('input', () => {
    renderList((searchInput as HTMLInputElement).value);
  });

  document.addEventListener('click', (e) => {
    if (isOpen && !container.contains(e.target as Node)) close();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  updateBtn(initial);

  const refresh = (newPlants: PlantOption[]) => {
    currentPlants = newPlants;
  };

  return { container, refresh };
}

export function buildPetSelector(
  pets: PetOption[],
  initial: PetOption | null,
  onSelect: (pet: PetOption) => void,
): { container: HTMLElement } {
  const container = el('div', 'position:relative;');

  const btn = el(
    'button',
    [
      'width:100%',
      'padding:10px 14px',
      'font-size:14px',
      'border-radius:8px',
      `border:1px solid ${BORDER_SUBTLE}`,
      `background:${CARD_BG}`,
      `color:${TEXT}`,
      'cursor:pointer',
      'text-align:left',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'font-family:inherit',
    ].join(';'),
  );
  btn.type = 'button';

  const btnIcon = el('img', 'width:28px;height:28px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;');
  const btnLabel = el('span', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;');
  const btnPrice = el('span', 'display:flex;align-items:center;gap:3px;flex-shrink:0;white-space:nowrap;');
  const btnArrow = el('span', `color:${MUTED};flex-shrink:0;font-size:12px;`, '▼');

  btn.append(btnIcon, btnLabel, btnPrice, btnArrow);
  container.appendChild(btn);

  const dropdown = el(
    'div',
    [
      'position:absolute',
      'top:100%',
      'left:0',
      'right:0',
      'z-index:50',
      'margin-top:4px',
      'background:rgba(18,20,26,0.98)',
      `border:1px solid ${BORDER_ACTIVE}`,
      'border-radius:8px',
      'max-height:280px',
      'display:none',
      'flex-direction:column',
      'overflow:hidden',
    ].join(';'),
  );
  container.appendChild(dropdown);

  const searchInput = el(
    'input',
    [
      'width:100%',
      'box-sizing:border-box',
      'padding:8px 12px',
      'font-size:13px',
      'border:none',
      `border-bottom:1px solid ${BORDER_SUBTLE}`,
      'background:transparent',
      `color:${TEXT}`,
      'outline:none',
      'font-family:inherit',
    ].join(';'),
  );
  (searchInput as HTMLInputElement).type = 'text';
  (searchInput as HTMLInputElement).placeholder = t('feature.cropCalc.searchPets');
  dropdown.appendChild(searchInput);

  const listContainer = el('div', 'flex:1;overflow-y:auto;max-height:240px;');
  dropdown.appendChild(listContainer);

  let isOpen = false;

  function updateBtn(pet: PetOption | null): void {
    if (!pet) {
      (btnIcon as HTMLImageElement).style.display = 'none';
      btnLabel.textContent = t('feature.cropCalc.selectPet');
      btnPrice.innerHTML = '';
      return;
    }
    const spriteUrl = getPetSpriteDataUrl(pet.key);
    if (spriteUrl) {
      (btnIcon as HTMLImageElement).src = spriteUrl;
      (btnIcon as HTMLImageElement).style.display = '';
    } else {
      (btnIcon as HTMLImageElement).style.display = 'none';
    }
    btnLabel.textContent = pet.name;
    btnPrice.innerHTML = '';
    btnPrice.append(makeCoinIcon(16), document.createTextNode(` ${fullFmt.format(pet.maturitySellPrice)}`));
  }

  function renderList(filter: string): void {
    listContainer.innerHTML = '';
    const lower = filter.toLowerCase();
    const filtered = lower ? pets.filter((p) => p.name.toLowerCase().includes(lower)) : pets;

    for (const pet of filtered) {
      const row = el(
        'div',
        [
          'display:flex',
          'align-items:center',
          'gap:10px',
          'padding:7px 12px',
          'cursor:pointer',
          'transition:background 0.1s',
        ].join(';'),
      );
      row.addEventListener('mouseenter', () => { row.style.background = HOVER_BG; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      const icon = el('img', 'width:24px;height:24px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;');
      const spriteUrl = getPetSpriteDataUrl(pet.key);
      if (spriteUrl) {
        (icon as HTMLImageElement).src = spriteUrl;
      } else {
        icon.style.display = 'none';
      }

      const nameEl = el('span', `flex:1;font-size:13px;color:${TEXT};`, pet.name);
      const priceWrap = el('span', 'display:flex;align-items:center;gap:3px;flex-shrink:0;');
      priceWrap.append(makeCoinIcon(14), el('span', `font-size:11px;color:${MUTED};`, fullFmt.format(pet.maturitySellPrice)));
      const rarityEl = el('span', `font-size:10px;color:${MUTED};flex-shrink:0;margin-left:4px;opacity:0.7;`, pet.rarity);

      row.append(icon, nameEl, priceWrap, rarityEl);
      row.addEventListener('click', () => {
        onSelect(pet);
        updateBtn(pet);
        close();
      });
      listContainer.appendChild(row);
    }

    if (filtered.length === 0) {
      listContainer.appendChild(el('div', `padding:12px;text-align:center;color:${MUTED};font-size:12px;`, t('feature.cropCalc.noResults')));
    }
  }

  function open(): void {
    isOpen = true;
    dropdown.style.display = 'flex';
    (searchInput as HTMLInputElement).value = '';
    renderList('');
    (searchInput as HTMLInputElement).focus();
  }

  function close(): void {
    isOpen = false;
    dropdown.style.display = 'none';
  }

  btn.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  searchInput.addEventListener('input', () => {
    renderList((searchInput as HTMLInputElement).value);
  });

  document.addEventListener('click', (e) => {
    if (isOpen && !container.contains(e.target as Node)) close();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  updateBtn(initial);

  return { container };
}
