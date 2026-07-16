import { getGardenFiltersConfig, updateGardenFiltersConfig, getAllPlantSpecies, getAllEggTypes, applyGardenFiltersNow, resetGardenFiltersNow } from '../../features/garden/filters';
import { getMutationCatalog, getEggCatalog, waitForCatalogs } from '../../catalogs/gameCatalogs';
import { getCropSpriteCanvas, getCropSpriteWithMutations } from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/dom/canvasHelpers';
import { createCard } from '../core/panelHelpers';
import { createToggle } from '../components/toggle';
import { createSectionHeader } from '../components/sectionHeader';
import { createButton } from '../components/button';
import { t } from '../../i18n';

export async function createGardenFiltersSection(): Promise<HTMLElement> {
  const { root, body } = createCard(t('feature.gardenFilters.title'), {
    subtitle: t('feature.gardenFilters.subtitle'),
  });
  root.dataset.qpmSection = 'garden-filters';

  const config = getGardenFiltersConfig();

  const { root: enableRow, setChecked: setEnableChecked } = createToggle({
    checked: config.enabled,
    onChange: (checked) => updateGardenFiltersConfig({ enabled: checked }),
    label: t('feature.gardenFilters.enableToggle'),
  });
  enableRow.style.cssText += 'padding:12px;background:var(--qpm-surface-1);border-radius:8px;margin-bottom:16px;gap:12px;';
  body.appendChild(enableRow);

  const infoBox = document.createElement('div');
  infoBox.style.cssText = `
    padding: 12px;
    background: var(--qpm-accent-tint);
    border-left: 3px solid var(--qpm-accent-border);
    border-radius: 4px;
    margin-bottom: 16px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--qpm-text-muted);
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

  const mutationsSection = document.createElement('div');
  mutationsSection.style.cssText = 'margin-bottom: 16px;';

  const mutationsHeader = document.createElement('div');
  mutationsHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  `;

  const { root: mutTitle } = createSectionHeader(t('feature.gardenFilters.mutationFilters'));
  mutTitle.style.borderBottom = 'none';
  mutTitle.style.padding = '0';

  const { root: filterRemainRow, setChecked: setExcludeMutChecked } = createToggle({
    size: 'compact',
    checked: config.excludeMutations,
    onChange: (checked) => updateGardenFiltersConfig({ excludeMutations: checked }),
    label: t('feature.gardenFilters.filterRemaining'),
  });
  filterRemainRow.style.display = 'none';

  mutationsHeader.appendChild(mutTitle);
  mutationsHeader.appendChild(filterRemainRow);
  mutationsSection.appendChild(mutationsHeader);

  // Track all filter checkbox inputs so Reset All can uncheck them
  const allFilterInputs: HTMLInputElement[] = [];

  function updateFilterRemainingVisibility(): void {
    const hasMutations = getGardenFiltersConfig().mutations.length > 0;
    filterRemainRow.style.display = hasMutations ? 'inline-flex' : 'none';
  }

  // Get mutations from catalog — wait for catalogs first since the mutation catalog
  // may arrive slightly after the pet catalog (separate Object.keys() call from the game).
  // Timeout swallowed: catalogs subsystem owns CATALOG-001 on watchdog; retry loop below covers late arrivals.
  await waitForCatalogs(8000).catch(() => { /* handled by catalogs subsystem + local retry */ });
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
      checkbox.style.background = 'var(--qpm-accent-tint)';
    });
    checkbox.addEventListener('mouseleave', () => {
      checkbox.style.background = 'transparent';
    });

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.mutations.includes(mutationId);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer; accent-color: var(--qpm-accent);';

    allFilterInputs.push(input);
    input.addEventListener('change', () => {
      const current = getGardenFiltersConfig().mutations;
      const updated = input.checked
        ? [...current, mutationId]
        : current.filter(m => m !== mutationId);
      updateGardenFiltersConfig({ mutations: updated });
      updateFilterRemainingVisibility();
    });

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
    label.style.cssText = 'font-size: 12px; color: var(--qpm-text);';

    checkbox.appendChild(input);
    checkbox.appendChild(spriteEl);
    checkbox.appendChild(label);
    mutationsSection.appendChild(checkbox);
  }

  updateFilterRemainingVisibility();
  body.appendChild(mutationsSection);

  const cropSection = document.createElement('div');
  cropSection.style.cssText = 'margin-bottom: 16px;';

  const { root: cropTitle } = createSectionHeader(t('feature.gardenFilters.cropSpeciesFilters'));
  cropTitle.style.borderBottom = 'none';
  cropTitle.style.padding = '0 0 8px 0';
  cropSection.appendChild(cropTitle);

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
      checkbox.style.background = 'var(--qpm-accent-tint)';
    });
    checkbox.addEventListener('mouseleave', () => {
      checkbox.style.background = 'transparent';
    });

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.cropSpecies.includes(species);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer; accent-color: var(--qpm-accent);';

    allFilterInputs.push(input);
    input.addEventListener('change', () => {
      const current = getGardenFiltersConfig().cropSpecies;
      const updated = input.checked
        ? [...current, species]
        : current.filter(s => s !== species);
      updateGardenFiltersConfig({ cropSpecies: updated });
    });

    const spriteCanvas = getCropSpriteCanvas(species);
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
    label.style.cssText = 'font-size: 12px; color: var(--qpm-text);';

    checkbox.appendChild(input);
    checkbox.appendChild(spriteEl);
    checkbox.appendChild(label);
    cropSection.appendChild(checkbox);
  }

  body.appendChild(cropSection);

  const eggSection = document.createElement('div');
  eggSection.style.cssText = 'margin-bottom: 16px;';

  const { root: eggTitle } = createSectionHeader(t('feature.gardenFilters.eggTypeFilters'));
  eggTitle.style.borderBottom = 'none';
  eggTitle.style.padding = '0 0 8px 0';
  eggSection.appendChild(eggTitle);

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
      checkbox.style.background = 'var(--qpm-accent-tint)';
    });
    checkbox.addEventListener('mouseleave', () => {
      checkbox.style.background = 'transparent';
    });

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.eggTypes.includes(eggType);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer; accent-color: var(--qpm-accent);';

    allFilterInputs.push(input);
    input.addEventListener('change', () => {
      const current = getGardenFiltersConfig().eggTypes;
      const updated = input.checked
        ? [...current, eggType]
        : current.filter(e => e !== eggType);
      updateGardenFiltersConfig({ eggTypes: updated });
    });

    const eggCatalog = getEggCatalog() ?? {};
    const eggData = eggCatalog[eggType];
    const displayName = eggData?.name || eggType;

    const label = document.createElement('span');
    label.textContent = displayName;
    label.style.cssText = 'font-size: 12px; color: var(--qpm-text);';

    checkbox.appendChild(input);
    checkbox.appendChild(label);
    eggSection.appendChild(checkbox);
  }

  body.appendChild(eggSection);

  const growthSection = document.createElement('div');
  growthSection.style.cssText = 'margin-bottom: 16px;';

  const { root: growthTitle } = createSectionHeader(t('feature.gardenFilters.growthStateFilters'));
  growthTitle.style.borderBottom = 'none';
  growthTitle.style.padding = '0 0 8px 0';
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
      checkbox.style.background = 'var(--qpm-accent-tint)';
    });
    checkbox.addEventListener('mouseleave', () => {
      checkbox.style.background = 'transparent';
    });

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.growthStates.includes(state.id);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer; accent-color: var(--qpm-accent);';

    allFilterInputs.push(input);
    input.addEventListener('change', () => {
      const current = getGardenFiltersConfig().growthStates;
      const updated = input.checked
        ? [...current, state.id]
        : current.filter(s => s !== state.id);
      updateGardenFiltersConfig({ growthStates: updated });
    });

    const label = document.createElement('span');
    label.textContent = state.label;
    label.style.cssText = 'font-size: 12px; color: var(--qpm-text);';

    checkbox.appendChild(input);
    checkbox.appendChild(label);
    growthSection.appendChild(checkbox);
  }

  body.appendChild(growthSection);

  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = 'display: flex; gap: 8px; margin-top: 16px;';

  const applyButton = createButton(t('feature.gardenFilters.applyFilters'), {
    variant: 'primary',
    onClick: () => applyGardenFiltersNow(),
  });

  const resetButton = createButton(t('feature.gardenFilters.resetAll'), {
    variant: 'secondary',
    onClick: () => {
      resetGardenFiltersNow();
      setEnableChecked(false);
      setExcludeMutChecked(false);
      for (const cb of allFilterInputs) cb.checked = false;
      updateFilterRemainingVisibility();
    },
  });

  actionsRow.appendChild(applyButton);
  actionsRow.appendChild(resetButton);
  body.appendChild(actionsRow);

  return root;
}
