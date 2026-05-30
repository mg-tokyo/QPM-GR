// src/ui/sections/autoFavoriteSection.ts — Auto-Favorite settings section
import { createCard } from '../core/panelHelpers';
import { createToggle } from '../components/toggle';
import { createSectionHeader } from '../components/sectionHeader';
import { t } from '../../i18n';
import { getAutoFavoriteConfig, updateAutoFavoriteConfig, subscribeToAutoFavoriteConfig } from '../../features/standalone/autoFavorite';
import { getAbilityColor } from '../../utils/petCardRenderer';
import { renderPetSpeciesIcon } from '../../utils/petCardRenderer';
import { areCatalogsReady, getAllPetSpecies } from '../../catalogs/gameCatalogs';
import { getAllPlantSpecies, getMutationCatalog } from '../../catalogs/gameCatalogs';
import { getCropSpriteWithMutations, getCropSpriteCanvas } from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/canvasHelpers';

function getMutatedCropSpriteUrl(species: string, mutations: string[]): string {
  const speciesStr = String(species || '').trim().toLowerCase();
  if (!speciesStr) {
    return '';
  }
  const mutated = canvasToDataUrl(getCropSpriteWithMutations(speciesStr, mutations));
  if (mutated) return mutated;
  return canvasToDataUrl(getCropSpriteCanvas(speciesStr));
}

function createCollapsibleSection(
  title: string,
  defaultOpen = false,
): { wrapper: HTMLElement; contentContainer: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-bottom:16px;';

  const contentContainer = document.createElement('div');
  contentContainer.style.cssText = defaultOpen ? 'display:block;margin-top:8px;' : 'display:none;margin-top:8px;';

  const { root: headerRoot } = createSectionHeader(title, {
    collapsible: true,
    collapsed: !defaultOpen,
    onToggle: (collapsed) => { contentContainer.style.display = collapsed ? 'none' : 'block'; },
  });

  wrapper.append(headerRoot, contentContainer);
  return { wrapper, contentContainer };
}

export async function createAutoFavoriteSection(): Promise<HTMLElement> {
  const { root, body } = createCard(`⭐ ${t('feature.autoFav.title')}`, {
    subtitle: t('feature.autoFav.subtitle'),
  });
  root.dataset.qpmSection = 'auto-favorite';

  const config = getAutoFavoriteConfig();

  // Main toggle
  const { root: enableToggle, setChecked: setEnableChecked } = createToggle({
    checked: config.enabled,
    label: t('feature.autoFav.enableToggle'),
    onChange: (checked) => updateAutoFavoriteConfig({ enabled: checked }),
  });
  enableToggle.style.cssText += 'padding:12px;background:var(--qpm-surface-1, #1a1a1a);border-radius:8px;margin-bottom:16px;';
  body.appendChild(enableToggle);

  // Info box
  const infoBox = document.createElement('div');
  infoBox.style.cssText = `
    padding: 12px;
    background: var(--qpm-accent-tint);
    border-left: 3px solid var(--qpm-accent, #8f82ff);
    border-radius: 4px;
    margin-bottom: 16px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--qpm-text-muted, #aaa);
  `;
  const infoHeader = document.createElement('strong');
  infoHeader.textContent = `💡 ${t('feature.autoFav.howItWorks')}`;
  infoBox.appendChild(infoHeader);
  infoBox.appendChild(document.createElement('br'));
  for (const key of [
    'feature.autoFav.infoBullet1',
    'feature.autoFav.infoBullet2',
    'feature.autoFav.infoBullet3',
    'feature.autoFav.infoBullet4',
  ] as const) {
    const line = document.createTextNode(`• ${t(key)}`);
    infoBox.appendChild(line);
    infoBox.appendChild(document.createElement('br'));
  }
  body.appendChild(infoBox);

  // ── Pet Abilities section (collapsible) ──
  const petAbilities = createCollapsibleSection(`\u{1F43E} ${t('feature.autoFav.petAbilities')}`);
  const petAbilitiesContent = petAbilities.contentContainer;

  const petAbilityOptions = [
    { id: 'Gold Granter', label: 'Gold Granter' },
    { id: 'Rainbow Granter', label: 'Rainbow Granter' },
  ];

  petAbilityOptions.forEach(option => {
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
    input.checked = config.petAbilities?.includes(option.id) ?? false;
    input.style.cssText = `width: 16px; height: 16px; cursor: pointer;`;

    input.addEventListener('change', () => {
      const current = getAutoFavoriteConfig().petAbilities || [];
      const updated = input.checked
        ? [...current, option.id]
        : current.filter(m => m !== option.id);
      updateAutoFavoriteConfig({ petAbilities: updated });

      // Immediately favorite existing items with this ability
      if (input.checked) {
        (window as any).qpm_favoritePetAbility?.(option.id);
      }
    });

    // Create ability pill badge
    const abilityColor = getAbilityColor(option.id);
    const abilityPill = document.createElement('span');
    abilityPill.style.cssText = `
      display:inline-block;
      padding:2px 8px;
      border-radius:4px;
      font-size:12px;
      font-weight:500;
      color:${abilityColor.text};
      background:${abilityColor.base};
      box-shadow: 0 0 6px ${abilityColor.glow}, 0 1px 3px rgba(0,0,0,0.3);
    `;
    abilityPill.textContent = option.label;

    checkbox.appendChild(input);
    checkbox.appendChild(abilityPill);
    petAbilitiesContent.appendChild(checkbox);
  });

  body.appendChild(petAbilities.wrapper);

  // ── Crop Mutations section (collapsible) ──
  const mutations = createCollapsibleSection(`\u2728 ${t('feature.autoFav.cropMutations')}`);
  const mutationsContent = mutations.contentContainer;

  // Get mutations from catalog (future-proof — auto-discovers new mutations from game manifest)
  const autoFavMutationCatalog = getMutationCatalog() ?? {};

  for (const [mutationId, mutationData] of Object.entries(autoFavMutationCatalog)) {
    const mutationLabel = (mutationData as any).name || mutationId;

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
    input.style.cssText = `width: 16px; height: 16px; cursor: pointer;`;

    input.addEventListener('change', () => {
      const current = getAutoFavoriteConfig().mutations;
      const updated = input.checked
        ? [...current, mutationId]
        : current.filter(m => m !== mutationId);
      updateAutoFavoriteConfig({ mutations: updated });

      // Immediately favorite existing items with this mutation
      if (input.checked) {
        (window as any).qpm_favoriteMutation?.(mutationId);
      }
    });

    // Use mutated sunflower sprite instead of color dot
    const mutationSprite = getMutatedCropSpriteUrl('Sunflower', [mutationId]);
    const spriteEl = document.createElement('img');
    spriteEl.dataset.qpmSprite = `crop:Sunflower:${mutationId}`;
    spriteEl.title = mutationLabel;
    spriteEl.style.cssText = `
      width: 24px;
      height: 24px;
      object-fit: contain;
      image-rendering: pixelated;
      flex-shrink: 0;
    `;
    if (mutationSprite) {
      spriteEl.src = mutationSprite;
    }
    // No placeholder - sprite will load when ready via data-qpm-sprite

    const label = document.createElement('span');
    label.textContent = mutationLabel;
    label.style.cssText = `font-size: 12px; color: var(--qpm-text, #fff);`;

    checkbox.appendChild(input);
    checkbox.appendChild(spriteEl);
    checkbox.appendChild(label);
    mutationsContent.appendChild(checkbox);
  }

  body.appendChild(mutations.wrapper);

  // ── Advanced Filters section (collapsible) ──
  const advanced = createCollapsibleSection(`\u2699\uFE0F ${t('feature.autoFav.advancedFilters')}`);
  const advancedContent = advanced.contentContainer;

  // Add border-top styling to the wrapper
  advanced.wrapper.style.cssText += 'margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);';

  const advancedNote = document.createElement('div');
  advancedNote.style.cssText = `
    font-size: 12px;
    color: var(--qpm-text-muted);
    margin-bottom: 12px;
    padding: 8px;
    background: rgba(255, 179, 71, 0.1);
    border-left: 2px solid var(--qpm-warning, #ffb347);
    border-radius: 4px;
  `;
  advancedNote.textContent = `\u{1F4A1} ${t('feature.autoFav.advancedHint')}`;
  advancedContent.appendChild(advancedNote);

  // ── Filter by Abilities sub-section (collapsible) ──
  const abilityFilter = createCollapsibleSection(t('feature.autoFav.filterByAbilities'));
  const abilityFilterContent = abilityFilter.contentContainer;

  const abilityCheckboxContainer = document.createElement('div');
  abilityCheckboxContainer.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;';

  // Dynamically import all abilities from petAbilities.ts
  const { getAllAbilityDefinitions } = await import('../../features/pets/data/petAbilities');
  const allAbilityDefinitions = getAllAbilityDefinitions();

  // Group abilities by base name (remove tier numbers for cleaner display)
  const abilityGroups = new Map<string, { id: string; name: string }[]>();

  allAbilityDefinitions
    .filter(def => def.id !== 'Copycat')
    .forEach(def => {
      // Extract base name (e.g., "Crop Size Boost" from "Crop Size Boost I")
      const baseName = def.name.replace(/\s+(I{1,4}|\d+)$/, '');
      if (!abilityGroups.has(baseName)) {
        abilityGroups.set(baseName, []);
      }
      abilityGroups.get(baseName)!.push({ id: def.id, name: def.name });
    });

  // Create options with single checkbox per base ability (groups all tiers)
  const abilityOptions: Array<{ value: string[]; label: string }> = [];

  Array.from(abilityGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([baseName, abilities]) => {
      // Group all tier IDs together for matching
      const abilityIds = abilities.map(a => a.id);
      abilityOptions.push({ value: abilityIds, label: baseName });
    });

  abilityOptions.forEach(option => {
    const checkbox = document.createElement('label');
    checkbox.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;border-radius:4px;transition:background 0.2s;font-size:12px;min-width:0;';
    checkbox.addEventListener('mouseenter', () => checkbox.style.background = 'rgba(255, 255, 255, 0.05)');
    checkbox.addEventListener('mouseleave', () => checkbox.style.background = 'transparent');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.abilityValue = option.value.join(',');
    // Check if ANY tier of this ability is selected
    const currentFilters = config.filterByAbilities || [];
    input.checked = option.value.some(id => currentFilters.includes(id));
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;';

    input.addEventListener('change', () => {
      const current = getAutoFavoriteConfig().filterByAbilities || [];
      if (input.checked) {
        // Add all tiers of this ability
        const newIds = option.value.filter(id => !current.includes(id));
        updateAutoFavoriteConfig({ filterByAbilities: [...current, ...newIds] });
      } else {
        // Remove all tiers of this ability
        const updated = current.filter(id => !option.value.includes(id));
        updateAutoFavoriteConfig({ filterByAbilities: updated });
      }
    });

    // Full ability badge pill
    const color = getAbilityColor(option.label);
    const pill = document.createElement('span');
    pill.textContent = option.label;
    pill.title = option.label;
    pill.style.cssText = `
      display:inline-block;
      padding:2px 8px;
      border-radius:4px;
      font-size:12px;
      font-weight:500;
      color:${color.text};
      background:${color.base};
      box-shadow:0 0 4px ${color.glow};
      flex-shrink:0;
      white-space:nowrap;
    `;

    checkbox.appendChild(input);
    checkbox.appendChild(pill);
    abilityCheckboxContainer.appendChild(checkbox);
  });

  abilityFilterContent.appendChild(abilityCheckboxContainer);
  advancedContent.appendChild(abilityFilter.wrapper);

  // ── Filter by Ability Count sub-section (collapsible) ──
  const abilityCountFilter = createCollapsibleSection(t('feature.autoFav.filterByAbilityCount'));

  const abilityCountSelect = document.createElement('select');
  abilityCountSelect.style.cssText = `
    width: 100%;
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
  `;

  [
    { value: '', label: t('feature.autoFav.anyCount') },
    { value: '1', label: t('feature.autoFav.oneAbility') },
    { value: '2', label: t('feature.autoFav.nAbilities', { count: 2 }) },
    { value: '3', label: t('feature.autoFav.nAbilities', { count: 3 }) },
    { value: '4', label: t('feature.autoFav.nAbilities', { count: 4 }) },
  ].forEach(option => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    abilityCountSelect.appendChild(opt);
  });

  abilityCountSelect.value = config.filterByAbilityCount != null ? String(config.filterByAbilityCount) : '';
  abilityCountSelect.addEventListener('change', () => {
    const value = abilityCountSelect.value ? parseInt(abilityCountSelect.value) : null;
    updateAutoFavoriteConfig({ filterByAbilityCount: value });
  });

  abilityCountFilter.contentContainer.appendChild(abilityCountSelect);
  advancedContent.appendChild(abilityCountFilter.wrapper);

  // ── Filter by Pet Species sub-section (collapsible) ──
  const speciesFilter = createCollapsibleSection(t('feature.autoFav.filterBySpecies'));

  const speciesCheckboxContainer = document.createElement('div');
  speciesCheckboxContainer.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;';

  // Get pet species dynamically from catalog (FUTUREPROOF!)
  const speciesOptions = areCatalogsReady() ? getAllPetSpecies() : [
    // Fallback list if catalogs not loaded yet
    'Worm', 'Snail', 'Bee', 'Chicken', 'Bunny', 'Dragonfly',
    'Pig', 'Cow', 'Turkey', 'Squirrel', 'Turtle', 'Goat',
    'Butterfly', 'Peacock', 'Capybara',
  ];

  speciesOptions.forEach(species => {
    const checkbox = document.createElement('label');
    checkbox.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;transition:background 0.2s;font-size:12px;min-width:0;';
    checkbox.addEventListener('mouseenter', () => checkbox.style.background = 'rgba(255, 255, 255, 0.05)');
    checkbox.addEventListener('mouseleave', () => checkbox.style.background = 'transparent');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.speciesValue = species;
    input.checked = (config.filterBySpecies || []).includes(species);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;';

    input.addEventListener('change', () => {
      const current = getAutoFavoriteConfig().filterBySpecies || [];
      const updated = input.checked ? [...current, species] : current.filter(s => s !== species);
      updateAutoFavoriteConfig({ filterBySpecies: updated });
    });

    // Use pet species icon (no STR label)
    const petIcon = renderPetSpeciesIcon(species);
    const iconContainer = document.createElement('div');
    iconContainer.innerHTML = petIcon;
    iconContainer.style.cssText = 'flex-shrink: 0;';

    checkbox.appendChild(input);
    checkbox.appendChild(iconContainer);
    speciesCheckboxContainer.appendChild(checkbox);
  });

  speciesFilter.contentContainer.appendChild(speciesCheckboxContainer);
  advancedContent.appendChild(speciesFilter.wrapper);

  // ── Filter by Crop Type sub-section (collapsible) ──
  const cropTypeFilter = createCollapsibleSection(t('feature.autoFav.filterByCropTypes'));

  const cropTypeCheckboxContainer = document.createElement('div');
  cropTypeCheckboxContainer.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;';

  // Get plant species dynamically from catalog (FUTUREPROOF!)
  // Fallback to hardcoded list if catalogs not ready
  let cropTypeOptions: string[];
  if (areCatalogsReady()) {
    cropTypeOptions = getAllPlantSpecies();
  } else {
    const { getAllCropNames } = await import('../../features/garden/data/cropBaseStats');
    cropTypeOptions = getAllCropNames();
  }

  cropTypeOptions.forEach(cropName => {
    const checkbox = document.createElement('label');
    checkbox.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;transition:background 0.2s;font-size:12px;min-width:0;';
    checkbox.addEventListener('mouseenter', () => checkbox.style.background = 'rgba(255, 255, 255, 0.05)');
    checkbox.addEventListener('mouseleave', () => checkbox.style.background = 'transparent');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.cropValue = cropName;
    input.checked = (config.filterByCropTypes || []).includes(cropName);
    input.style.cssText = 'width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;';

    input.addEventListener('change', () => {
      const current = getAutoFavoriteConfig().filterByCropTypes || [];
      const updated = input.checked ? [...current, cropName] : current.filter(ct => ct !== cropName);
      updateAutoFavoriteConfig({ filterByCropTypes: updated });
    });

    // Use crop sprite with data attribute for lazy loading
    const cropSprite = getMutatedCropSpriteUrl(cropName, []);
    const spriteImg = document.createElement('img');
    spriteImg.dataset.qpmSprite = `crop:${cropName}`;
    spriteImg.alt = cropName;
    spriteImg.style.cssText = 'width: 24px; height: 24px; object-fit: contain; image-rendering: pixelated; flex-shrink: 0;';
    if (cropSprite) {
      spriteImg.src = cropSprite;
    }
    // No placeholder - sprite will load when ready via data-qpm-sprite

    const label = document.createElement('span');
    label.textContent = cropName;
    label.style.cssText = 'color:var(--qpm-text, #fff);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;';
    label.title = cropName;

    checkbox.appendChild(input);
    checkbox.appendChild(spriteImg);
    checkbox.appendChild(label);
    cropTypeCheckboxContainer.appendChild(checkbox);
  });

  cropTypeFilter.contentContainer.appendChild(cropTypeCheckboxContainer);
  advancedContent.appendChild(cropTypeFilter.wrapper);

  body.appendChild(advanced.wrapper);

  // Subscribe to config changes to update UI
  subscribeToAutoFavoriteConfig((newConfig) => {
    setEnableChecked(newConfig.enabled);
    abilityCountSelect.value = newConfig.filterByAbilityCount != null ? String(newConfig.filterByAbilityCount) : '';
    // Update checkboxes based on config (use data attributes to avoid index-order assumptions)
    abilityCheckboxContainer.querySelectorAll('input[type="checkbox"]').forEach((rawInput) => {
      const input = rawInput as HTMLInputElement;
      const ids = (input.dataset.abilityValue ?? '').split(',').filter(Boolean);
      input.checked = ids.some(id => (newConfig.filterByAbilities || []).includes(id));
    });
    speciesCheckboxContainer.querySelectorAll('input[type="checkbox"]').forEach((rawInput) => {
      const input = rawInput as HTMLInputElement;
      const val = input.dataset.speciesValue ?? '';
      input.checked = (newConfig.filterBySpecies || []).includes(val);
    });
    cropTypeCheckboxContainer.querySelectorAll('input[type="checkbox"]').forEach((rawInput) => {
      const input = rawInput as HTMLInputElement;
      const val = input.dataset.cropValue ?? '';
      input.checked = (newConfig.filterByCropTypes || []).includes(val);
    });
  });

  return root;
}
