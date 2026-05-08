import { getGardenFiltersConfig, updateGardenFiltersConfig, getAllPlantSpecies, getAllEggTypes, applyGardenFiltersNow, resetGardenFiltersNow } from '../../features/gardenFilters';
import { getMutationCatalog, getEggCatalog, waitForCatalogs } from '../../catalogs/gameCatalogs';
import { spriteExtractor, getCropSpriteWithMutations } from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/canvasHelpers';
import { createCard } from '../panelHelpers';
import { t } from '../../i18n';

export async function createGardenFiltersSection(): Promise<HTMLElement> {
  const { root, body } = createCard(t('feature.gardenFilters.title'), {
    subtitle: t('feature.gardenFilters.subtitle'),
  });
  root.dataset.qpmSection = 'garden-filters';

  const config = getGardenFiltersConfig();

  // === MAIN TOGGLE ===
  const enableToggle = document.createElement('label');
  enableToggle.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    background: var(--qpm-surface-1, #1a1a1a);
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 16px;
  `;

  const enableCheckbox = document.createElement('input');
  enableCheckbox.type = 'checkbox';
  enableCheckbox.checked = config.enabled;
  enableCheckbox.style.cssText = `width: 20px; height: 20px; cursor: pointer;`;

  enableCheckbox.addEventListener('change', () => {
    updateGardenFiltersConfig({ enabled: enableCheckbox.checked });
  });

  const enableLabel = document.createElement('span');
  enableLabel.textContent = t('feature.gardenFilters.enableToggle');
  enableLabel.style.cssText = `font-weight: 600; font-size: 14px; color: var(--qpm-text, #fff);`;

  enableToggle.appendChild(enableCheckbox);
  enableToggle.appendChild(enableLabel);
  body.appendChild(enableToggle);

  // === INFO BOX ===
  const infoBox = document.createElement('div');
  infoBox.style.cssText = `
    padding: 12px;
    background: rgba(63, 81, 181, 0.1);
    border-left: 3px solid rgba(63, 81, 181, 0.6);
    border-radius: 4px;
    margin-bottom: 16px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--qpm-text-muted, #aaa);
  `;
  const infoStrong = document.createElement('strong');
  infoStrong.textContent = t('feature.gardenFilters.howItWorks');
  infoBox.appendChild(infoStrong);
  for (const key of [
    'feature.gardenFilters.infoBullet1',
    'feature.gardenFilters.infoBullet2',
    'feature.gardenFilters.infoBullet3',
    'feature.gardenFilters.infoBullet4',
  ] as const) {
    infoBox.appendChild(document.createElement('br'));
    infoBox.appendChild(document.createTextNode(`• ${t(key)}`));
  }
  body.appendChild(infoBox);

  // === MUTATION FILTERS SECTION ===
  const mutationsSection = document.createElement('div');
  mutationsSection.style.cssText = 'margin-bottom: 16px;';

  const mutationsHeader = document.createElement('div');
  mutationsHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  `;

  const mutationsTitle = document.createElement('h4');
  mutationsTitle.textContent = t('feature.gardenFilters.mutationFilters');
  mutationsTitle.style.cssText = `
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--qpm-accent, #4CAF50);
  `;

  const filterRemainingToggle = document.createElement('label');
  filterRemainingToggle.style.cssText = `
    display: none;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--qpm-text-muted, rgba(232,224,255,0.6));
    white-space: nowrap;
  `;

  const filterRemainingInput = document.createElement('input');
  filterRemainingInput.type = 'checkbox';
  filterRemainingInput.checked = config.excludeMutations;
  filterRemainingInput.style.cssText = 'width: 14px; height: 14px; cursor: pointer;';
  filterRemainingInput.addEventListener('change', () => {
    updateGardenFiltersConfig({ excludeMutations: filterRemainingInput.checked });
  });

  const filterRemainingLabel = document.createElement('span');
  filterRemainingLabel.textContent = t('feature.gardenFilters.filterRemaining');

  filterRemainingToggle.appendChild(filterRemainingInput);
  filterRemainingToggle.appendChild(filterRemainingLabel);

  mutationsHeader.appendChild(mutationsTitle);
  mutationsHeader.appendChild(filterRemainingToggle);
  mutationsSection.appendChild(mutationsHeader);

  function updateFilterRemainingVisibility(): void {
    const hasMutations = getGardenFiltersConfig().mutations.length > 0;
    filterRemainingToggle.style.display = hasMutations ? 'flex' : 'none';
  }

  // Get mutations from catalog — wait for catalogs first since the mutation catalog
  // may arrive slightly after the pet catalog (separate Object.keys() call from the game).
  await waitForCatalogs(8000).catch(() => {});
  let mutCatalog = getMutationCatalog();
  if (!mutCatalog) {
    for (let i = 0; i < 10 && !mutCatalog; i++) {
      await new Promise(r => setTimeout(r, 300));
      mutCatalog = getMutationCatalog();
    }
  }
  const mutations = mutCatalog ?? {};

  for (const [mutationId, mutationData] of Object.entries(mutations)) {
    const checkbox = document.createElement('label');
    checkbox.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.2s;
    `;
    checkbox.addEventListener('mouseenter', () => {
      checkbox.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    checkbox.addEventListener('mouseleave', () => {
      checkbox.style.background = 'transparent';
    });

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.mutations.includes(mutationId);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';

    input.addEventListener('change', () => {
      const current = getGardenFiltersConfig().mutations;
      const updated = input.checked
        ? [...current, mutationId]
        : current.filter(m => m !== mutationId);
      updateGardenFiltersConfig({ mutations: updated });
      updateFilterRemainingVisibility();
    });

    // Use sprite instead of emoji (VERIFIED working!)
    const spriteCanvas = getCropSpriteWithMutations('Sunflower', [mutationId]);
    const spriteEl = document.createElement('img');
    spriteEl.dataset.qpmSprite = `crop:Sunflower:${mutationId}`;
    spriteEl.title = (mutationData as any).name || mutationId;
    spriteEl.style.cssText = `
      width: 24px;
      height: 24px;
      object-fit: contain;
      image-rendering: pixelated;
      flex-shrink: 0;
    `;

    if (spriteCanvas) {
      spriteEl.src = canvasToDataUrl(spriteCanvas);
    }

    const label = document.createElement('span');
    label.textContent = (mutationData as any).name || mutationId;
    label.style.cssText = 'font-size: 13px; color: var(--qpm-text, #fff);';

    checkbox.appendChild(input);
    checkbox.appendChild(spriteEl);
    checkbox.appendChild(label);
    mutationsSection.appendChild(checkbox);
  }

  updateFilterRemainingVisibility();
  body.appendChild(mutationsSection);

  // === CROP SPECIES FILTERS ===
  const cropSection = document.createElement('div');
  cropSection.style.cssText = 'margin-bottom: 16px;';

  const cropTitle = document.createElement('h4');
  cropTitle.textContent = t('feature.gardenFilters.cropSpeciesFilters');
  cropTitle.style.cssText = `
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--qpm-accent, #4CAF50);
  `;
  cropSection.appendChild(cropTitle);

  // Get plant species from gardenFilters module
  const plantSpecies = getAllPlantSpecies();

  for (const species of plantSpecies) {
    const checkbox = document.createElement('label');
    checkbox.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.2s;
    `;
    checkbox.addEventListener('mouseenter', () => {
      checkbox.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    checkbox.addEventListener('mouseleave', () => {
      checkbox.style.background = 'transparent';
    });

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.cropSpecies.includes(species);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';

    input.addEventListener('change', () => {
      const current = getGardenFiltersConfig().cropSpecies;
      const updated = input.checked
        ? [...current, species]
        : current.filter(s => s !== species);
      updateGardenFiltersConfig({ cropSpecies: updated });
    });

    const spriteCanvas = spriteExtractor.getCropSprite(species);
    const spriteEl = document.createElement('img');
    spriteEl.dataset.qpmSprite = `crop:${species}`;
    spriteEl.title = species;
    spriteEl.style.cssText = `
      width: 24px;
      height: 24px;
      object-fit: contain;
      image-rendering: pixelated;
      flex-shrink: 0;
    `;

    if (spriteCanvas) {
      spriteEl.src = canvasToDataUrl(spriteCanvas);
    }

    const label = document.createElement('span');
    label.textContent = species;
    label.style.cssText = 'font-size: 13px; color: var(--qpm-text, #fff);';

    checkbox.appendChild(input);
    checkbox.appendChild(spriteEl);
    checkbox.appendChild(label);
    cropSection.appendChild(checkbox);
  }

  body.appendChild(cropSection);

  // === EGG TYPE FILTERS ===
  const eggSection = document.createElement('div');
  eggSection.style.cssText = 'margin-bottom: 16px;';

  const eggTitle = document.createElement('h4');
  eggTitle.textContent = t('feature.gardenFilters.eggTypeFilters');
  eggTitle.style.cssText = `
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--qpm-accent, #4CAF50);
  `;
  eggSection.appendChild(eggTitle);

  // Get egg types from catalog (future-proof!)
  const eggTypes = getAllEggTypes();

  for (const eggType of eggTypes) {
    const checkbox = document.createElement('label');
    checkbox.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.2s;
    `;
    checkbox.addEventListener('mouseenter', () => {
      checkbox.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    checkbox.addEventListener('mouseleave', () => {
      checkbox.style.background = 'transparent';
    });

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.eggTypes.includes(eggType);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';

    input.addEventListener('change', () => {
      const current = getGardenFiltersConfig().eggTypes;
      const updated = input.checked
        ? [...current, eggType]
        : current.filter(e => e !== eggType);
      updateGardenFiltersConfig({ eggTypes: updated });
    });

    // Get egg catalog data for display name
    const eggCatalog = getEggCatalog() ?? {};
    const eggData = eggCatalog[eggType];
    const displayName = eggData?.name || eggType;

    const label = document.createElement('span');
    label.textContent = displayName;
    label.style.cssText = 'font-size: 13px; color: var(--qpm-text, #fff);';

    checkbox.appendChild(input);
    checkbox.appendChild(label);
    eggSection.appendChild(checkbox);
  }

  body.appendChild(eggSection);

  // === GROWTH STATE FILTERS ===
  const growthSection = document.createElement('div');
  growthSection.style.cssText = 'margin-bottom: 16px;';

  const growthTitle = document.createElement('h4');
  growthTitle.textContent = t('feature.gardenFilters.growthStateFilters');
  growthTitle.style.cssText = `
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--qpm-accent, #4CAF50);
  `;
  growthSection.appendChild(growthTitle);

  const growthStates: Array<{id: 'mature' | 'growing'; label: string}> = [
    { id: 'mature', label: t('feature.gardenFilters.matureOnly') },
    { id: 'growing', label: t('feature.gardenFilters.growingOnly') },
  ];

  for (const state of growthStates) {
    const checkbox = document.createElement('label');
    checkbox.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.2s;
    `;
    checkbox.addEventListener('mouseenter', () => {
      checkbox.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    checkbox.addEventListener('mouseleave', () => {
      checkbox.style.background = 'transparent';
    });

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.growthStates.includes(state.id);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';

    input.addEventListener('change', () => {
      const current = getGardenFiltersConfig().growthStates;
      const updated = input.checked
        ? [...current, state.id]
        : current.filter(s => s !== state.id);
      updateGardenFiltersConfig({ growthStates: updated });
    });

    const label = document.createElement('span');
    label.textContent = state.label;
    label.style.cssText = 'font-size: 13px; color: var(--qpm-text, #fff);';

    checkbox.appendChild(input);
    checkbox.appendChild(label);
    growthSection.appendChild(checkbox);
  }

  body.appendChild(growthSection);

  // === ACTION BUTTONS ===
  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = 'display: flex; gap: 8px; margin-top: 16px;';

  const applyButton = document.createElement('button');
  applyButton.textContent = t('feature.gardenFilters.applyFilters');
  applyButton.className = 'qpm-button qpm-button--positive';
  applyButton.addEventListener('click', () => {
    applyGardenFiltersNow();
  });

  const resetButton = document.createElement('button');
  resetButton.textContent = t('feature.gardenFilters.resetAll');
  resetButton.className = 'qpm-button';
  resetButton.addEventListener('click', () => {
    resetGardenFiltersNow();
  });

  actionsRow.appendChild(applyButton);
  actionsRow.appendChild(resetButton);
  body.appendChild(actionsRow);

  return root;
}
