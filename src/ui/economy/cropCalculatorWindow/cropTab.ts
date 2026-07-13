import {
  computeMutationMultiplier,
  type MutationCategory,
} from '../../../utils/game/cropMultipliers';
import { findVariantBadge } from '../../../features/mutations/data/variantBadges';
import { t } from '../../../i18n';
import { ACCENT, BORDER_SUBTLE, TEXT, MUTED, CARD_BG, PRICE_COLOR, FRIEND_OPTIONS } from './constants';
import { el, fullFmt, makeCoinIcon } from './domHelpers';
import {
  buildPlantOptions,
  groupMutations,
  percentToScale,
  computeCropPrice,
  getMutationDisplayName,
} from './pricing';
import { buildPillRow, buildMutationToggleRow } from './inputs';
import { buildPlantSelector } from './selectors';
import { buildCropSpriteDisplay } from './spriteDisplay';
import type { PlantOption, CropCalcState, MutationTileOption } from './types';

export function renderCropTab(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

  const plants = buildPlantOptions();
  const mutGroups = groupMutations();

  const state: CropCalcState = {
    plant: plants[0] ?? null,
    sizePercent: 100,
    colorMutation: null,
    weatherMutation: null,
    timeMutation: null,
    playerCount: 1,
  };

  const spriteDisplay = buildCropSpriteDisplay();

  let priceEl: HTMLElement;
  let priceCoinEl: HTMLElement;
  let rangeEl: HTMLElement;
  let weightEl: HTMLElement;
  let sliderValueEl: HTMLElement;
  let sliderInput: HTMLInputElement;
  let formulaEl: HTMLElement;

  function getActiveMutations(): string[] {
    return [state.colorMutation, state.weatherMutation, state.timeMutation].filter(
      (m): m is string => m !== null,
    );
  }

  function updateDisplay(): void {
    const { sellPrice, scale, mutMult, friendBonus } = computeCropPrice(state);

    priceCoinEl.innerHTML = '';
    priceCoinEl.appendChild(makeCoinIcon(28));
    priceEl.textContent = fullFmt.format(sellPrice);

    if (state.plant) {
      const mutations = getActiveMutations();
      const { totalMultiplier } = computeMutationMultiplier(mutations);
      const fb = 1 + (state.playerCount - 1) * 0.1;
      const floorScale = percentToScale(50, state.plant.maxScale);
      const ceilScale = percentToScale(100, state.plant.maxScale);
      const floorPrice = Math.round(state.plant.baseSellPrice * floorScale * totalMultiplier * fb);
      const ceilPrice = Math.round(state.plant.baseSellPrice * ceilScale * totalMultiplier * fb);
      rangeEl.textContent = `${fullFmt.format(floorPrice)} — ${fullFmt.format(ceilPrice)}`;
      rangeEl.style.display = '';
    } else {
      rangeEl.textContent = '';
      rangeEl.style.display = 'none';
    }

    if (state.plant) {
      const weight = state.plant.baseWeight * scale;
      weightEl.textContent = t('feature.cropCalc.weight', { weight: weight.toFixed(2) });
    } else {
      weightEl.textContent = '';
    }

    sliderValueEl.textContent = `${state.sizePercent}%`;
    spriteDisplay.update(state.plant, getActiveMutations(), state.sizePercent);

    if (state.plant) {
      const basePart = fullFmt.format(state.plant.baseSellPrice);
      const scalePart = scale.toFixed(2);
      const mutPart = mutMult === 1 ? '1' : `${mutMult}`;
      const friendPart = friendBonus === 1 ? '1' : friendBonus.toFixed(1);
      formulaEl.innerHTML = '';
      formulaEl.appendChild(
        el(
          'span',
          `color:${MUTED};font-size:11px;font-family:monospace;`,
          `${basePart} × ${scalePart} × ${mutPart} × ${friendPart} = ${fullFmt.format(sellPrice)}`,
        ),
      );
      const labels = el(
        'span',
        `color:${MUTED};font-size:10px;opacity:0.6;display:block;margin-top:2px;font-family:monospace;`,
        t('feature.cropCalc.formulaLabels'),
      );
      formulaEl.appendChild(labels);
    } else {
      formulaEl.innerHTML = '';
    }
  }

  function onPlantChange(plant: PlantOption): void {
    state.plant = plant;
    state.sizePercent = 100;
    sliderInput.value = '100';
    updateDisplay();
  }

  // --- Plant selector ---
  const { container: selectorContainer } = buildPlantSelector(plants, state.plant, onPlantChange);
  container.appendChild(selectorContainer);

  // --- Result card ---
  const resultCard = el(
    'div',
    [
      `border:1px solid ${BORDER_SUBTLE}`,
      `background:${CARD_BG}`,
      'border-radius:10px',
      'padding:16px',
      'text-align:center',
      'overflow:visible',
    ].join(';'),
  );

  const spriteWrap = el('div', 'margin-bottom:8px;overflow:visible;padding-top:16px;');
  spriteWrap.appendChild(spriteDisplay.wrapper);
  resultCard.appendChild(spriteWrap);

  const priceRow = el('div', 'display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:4px;');
  priceCoinEl = el('span', '');
  priceEl = el('span', `font-size:28px;font-weight:700;color:${PRICE_COLOR};`);
  priceRow.append(priceCoinEl, priceEl);
  resultCard.appendChild(priceRow);

  rangeEl = el('div', `font-size:13px;color:${MUTED};`);
  resultCard.appendChild(rangeEl);

  container.appendChild(resultCard);

  // --- Size slider ---
  const sizeSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  const sizeHeader = el('div', 'display:flex;align-items:center;gap:8px;');
  sizeHeader.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.size')));

  sliderInput = document.createElement('input');
  sliderInput.type = 'range';
  sliderInput.min = '50';
  sliderInput.max = '100';
  sliderInput.step = '1';
  sliderInput.value = String(state.sizePercent);
  sliderInput.style.cssText = `flex:1;accent-color:${ACCENT};cursor:pointer;`;

  sliderValueEl = el('span', `font-size:13px;color:${TEXT};min-width:36px;text-align:right;`);

  sizeHeader.append(sliderInput, sliderValueEl);
  sizeSection.appendChild(sizeHeader);

  weightEl = el('div', `font-size:12px;color:${MUTED};`);
  sizeSection.appendChild(weightEl);

  sliderInput.addEventListener('input', () => {
    state.sizePercent = parseInt(sliderInput.value, 10);
    updateDisplay();
  });

  container.appendChild(sizeSection);

  // --- Mutation toggle groups ---
  const mutSections: { category: MutationCategory; label: string; stateKey: 'colorMutation' | 'weatherMutation' | 'timeMutation' }[] = [
    { category: 'color', label: t('feature.cropCalc.color'), stateKey: 'colorMutation' },
    { category: 'weather', label: t('feature.cropCalc.weather'), stateKey: 'weatherMutation' },
    { category: 'time', label: t('feature.cropCalc.lunar'), stateKey: 'timeMutation' },
  ];

  for (const sec of mutSections) {
    const defs = mutGroups[sec.category];
    if (defs.length === 0) continue;

    const section = el('div', 'display:flex;flex-direction:column;gap:4px;');
    section.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, sec.label));

    const tileOptions: MutationTileOption[] = defs.map((d) => {
      const vb = findVariantBadge(d.name);
      const displayName = getMutationDisplayName(d.name);
      return {
        value: d.name,
        displayName,
        multiplier: d.multiplier,
        color: vb?.color ?? '#888',
        gradient: vb?.gradient,
      };
    });

    const { container: tileContainer } = buildMutationToggleRow(tileOptions, (value) => {
      state[sec.stateKey] = value;
      updateDisplay();
    });
    section.appendChild(tileContainer);
    container.appendChild(section);
  }

  // --- Friends ---
  const friendSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  friendSection.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.friends')));

  const { container: friendContainer } = buildPillRow(FRIEND_OPTIONS, '1', (value) => {
    state.playerCount = parseInt(value ?? '1', 10);
    updateDisplay();
  });
  friendSection.appendChild(friendContainer);
  container.appendChild(friendSection);

  // --- Divider ---
  container.appendChild(el('div', `height:1px;background:${BORDER_SUBTLE};`));

  // --- Formula ---
  formulaEl = el('div', 'text-align:center;');
  container.appendChild(formulaEl);

  updateDisplay();
  return updateDisplay;
}
