import { computeMutationMultiplier } from '../../../utils/game/cropMultipliers';
import { findVariantBadge } from '../../../features/mutations/data/variantBadges';
import { t } from '../../../i18n';
import { ACCENT, BORDER_SUBTLE, TEXT, MUTED, CARD_BG, PRICE_COLOR, DUST_COLOR, FRIEND_OPTIONS } from './constants';
import { el, fullFmt, makeCoinIcon, makeDustIcon } from './domHelpers';
import {
  buildPetOptions,
  groupMutations,
  strengthToTargetScale,
  computePetCalcPrice,
  computePetDustValue,
  getMutationDisplayName,
} from './pricing';
import { buildPillRow, buildMutationToggleRow } from './inputs';
import { buildPetSelector } from './selectors';
import { buildPetSpriteDisplay } from './spriteDisplay';
import type { PetOption, PetCalcState, MutationTileOption } from './types';

export function renderPetTab(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

  const pets = buildPetOptions();
  const mutGroups = groupMutations();

  if (pets.length === 0) {
    container.appendChild(
      el('div', `text-align:center;color:${MUTED};font-size:12px;padding:24px 16px;`, t('feature.cropCalc.noPetData')),
    );
    return () => {};
  }

  const state: PetCalcState = {
    pet: pets[0] ?? null,
    maxStrength: 100,
    currentStrength: 100,
    colorMutation: null,
    playerCount: 1,
  };

  const spriteDisplay = buildPetSpriteDisplay();

  let priceEl: HTMLElement;
  let priceCoinEl: HTMLElement;
  let dustRow: HTMLElement;
  let dustPriceEl: HTMLElement;
  let dustIconEl: HTMLElement;
  let rangeEl: HTMLElement;
  let scaleEl: HTMLElement;
  let maxSliderInput: HTMLInputElement;
  let maxSliderValueEl: HTMLElement;
  let curSliderInput: HTMLInputElement;
  let curSliderValueEl: HTMLElement;
  let formulaEl: HTMLElement;
  let dustFormulaEl: HTMLElement;

  function getActiveMutations(): string[] {
    return state.colorMutation ? [state.colorMutation] : [];
  }

  function updateDisplay(): void {
    const { sellPrice, scale, mutMult, friendBonus } = computePetCalcPrice(state);

    priceCoinEl.innerHTML = '';
    priceCoinEl.appendChild(makeCoinIcon(28));
    priceEl.textContent = fullFmt.format(sellPrice);

    // Range: newborn → fully mature at current maxStrength
    if (state.pet) {
      const ts = strengthToTargetScale(state.maxStrength, state.pet.maxScale);
      const mutations = getActiveMutations();
      const { totalMultiplier } = computeMutationMultiplier(mutations);
      const fb = 1 + (state.playerCount - 1) * 0.1;

      const floorStr = state.maxStrength - 30;
      const floorScale = state.maxStrength > 0 ? (floorStr / state.maxStrength) * ts : 0;
      const ceilScale = ts;

      const floorPrice = Math.round(Math.round(state.pet.maturitySellPrice * floorScale * totalMultiplier) * fb);
      const ceilPrice = Math.round(Math.round(state.pet.maturitySellPrice * ceilScale * totalMultiplier) * fb);

      rangeEl.textContent = `${fullFmt.format(floorPrice)} — ${fullFmt.format(ceilPrice)}`;
      rangeEl.style.display = '';
    } else {
      rangeEl.textContent = '';
      rangeEl.style.display = 'none';
    }

    // Dust value
    const dust = computePetDustValue(state);
    dustIconEl.innerHTML = '';
    dustIconEl.appendChild(makeDustIcon(20));
    dustPriceEl.textContent = fullFmt.format(dust.dustValue);
    dustRow.style.display = dust.dustValue > 0 ? 'flex' : 'none';

    // Scale display
    scaleEl.textContent = t('feature.cropCalc.scale', { scale: scale.toFixed(2) });

    // Slider value labels
    maxSliderValueEl.textContent = `${state.maxStrength}`;
    curSliderValueEl.textContent = `${state.currentStrength}`;

    // Sprite
    spriteDisplay.update(state.pet, getActiveMutations(), state.currentStrength, state.maxStrength);

    // Formula breakdown
    if (state.pet) {
      const basePart = fullFmt.format(state.pet.maturitySellPrice);
      const scalePart = scale.toFixed(2);
      const mutPart = mutMult === 1 ? '1' : `${mutMult}`;
      const friendPart = friendBonus === 1 ? '1' : friendBonus.toFixed(1);
      formulaEl.innerHTML = '';
      formulaEl.appendChild(
        el(
          'span',
          `color:${MUTED};font-size:12px;font-family:monospace;`,
          `${basePart} × ${scalePart} × ${mutPart} × ${friendPart} = ${fullFmt.format(sellPrice)}`,
        ),
      );
      formulaEl.appendChild(
        el(
          'span',
          `color:${MUTED};font-size:10px;opacity:0.6;display:block;margin-top:2px;font-family:monospace;`,
          t('feature.cropCalc.formulaLabels'),
        ),
      );

      // Dust formula breakdown
      dustFormulaEl.innerHTML = '';
      if (dust.dustValue > 0) {
        dustFormulaEl.appendChild(
          el(
            'span',
            `color:${DUST_COLOR};font-size:12px;font-family:monospace;opacity:0.85;`,
            `100 × ${dust.rarityMult} × ${dust.pullRateMult} × ${dust.dustMutMult} × ${dust.scale.toFixed(2)} = ${fullFmt.format(dust.dustValue)}`,
          ),
        );
        dustFormulaEl.appendChild(
          el(
            'span',
            `color:${DUST_COLOR};font-size:10px;opacity:0.5;display:block;margin-top:2px;font-family:monospace;`,
            t('feature.cropCalc.dustFormulaLabels'),
          ),
        );
      }
    } else {
      formulaEl.innerHTML = '';
      dustFormulaEl.innerHTML = '';
    }
  }

  function onPetChange(pet: PetOption): void {
    state.pet = pet;
    state.maxStrength = 100;
    state.currentStrength = 100;
    maxSliderInput.value = '100';
    curSliderInput.min = String(100 - 30);
    curSliderInput.max = '100';
    curSliderInput.value = '100';
    updateDisplay();
  }

  // --- Pet selector ---
  const { container: selectorContainer } = buildPetSelector(pets, state.pet, onPetChange);
  container.appendChild(selectorContainer);

  // --- Result card ---
  const resultCard = el(
    'div',
    [
      `border:1px solid ${BORDER_SUBTLE}`,
      `background:${CARD_BG}`,
      'border-radius:12px',
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
  priceEl = el('span', `font-size:24px;font-weight:700;color:${PRICE_COLOR};`);
  priceRow.append(priceCoinEl, priceEl);
  resultCard.appendChild(priceRow);

  dustRow = el('div', 'display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:4px;');
  dustIconEl = el('span', '');
  dustPriceEl = el('span', `font-size:18px;font-weight:600;color:${DUST_COLOR};`);
  dustRow.append(dustIconEl, dustPriceEl);
  resultCard.appendChild(dustRow);

  rangeEl = el('div', `font-size:12px;color:${MUTED};`);
  resultCard.appendChild(rangeEl);

  container.appendChild(resultCard);

  // --- Max Strength slider ---
  const maxStrSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  const maxStrHeader = el('div', 'display:flex;align-items:center;gap:8px;');
  maxStrHeader.appendChild(el('span', `font-size:14px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.maxStrength')));

  maxSliderInput = document.createElement('input');
  maxSliderInput.type = 'range';
  maxSliderInput.min = '80';
  maxSliderInput.max = '100';
  maxSliderInput.step = '1';
  maxSliderInput.value = String(state.maxStrength);
  maxSliderInput.style.cssText = `flex:1;accent-color:${ACCENT};cursor:pointer;`;

  maxSliderValueEl = el('span', `font-size:12px;color:${TEXT};min-width:28px;text-align:right;`);

  maxStrHeader.append(maxSliderInput, maxSliderValueEl);
  maxStrSection.appendChild(maxStrHeader);
  container.appendChild(maxStrSection);

  // --- Current Strength slider ---
  const curStrSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  const curStrHeader = el('div', 'display:flex;align-items:center;gap:8px;');
  curStrHeader.appendChild(el('span', `font-size:14px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.currentStrength')));

  curSliderInput = document.createElement('input');
  curSliderInput.type = 'range';
  curSliderInput.min = String(state.maxStrength - 30);
  curSliderInput.max = String(state.maxStrength);
  curSliderInput.step = '1';
  curSliderInput.value = String(state.currentStrength);
  curSliderInput.style.cssText = `flex:1;accent-color:${ACCENT};cursor:pointer;`;

  curSliderValueEl = el('span', `font-size:12px;color:${TEXT};min-width:28px;text-align:right;`);

  curStrHeader.append(curSliderInput, curSliderValueEl);
  curStrSection.appendChild(curStrHeader);

  // Scale label
  scaleEl = el('div', `font-size:12px;color:${MUTED};`);
  curStrSection.appendChild(scaleEl);

  container.appendChild(curStrSection);

  // Max strength slider handler
  maxSliderInput.addEventListener('input', () => {
    state.maxStrength = parseInt(maxSliderInput.value, 10);
    const newMin = state.maxStrength - 30;
    curSliderInput.min = String(newMin);
    curSliderInput.max = String(state.maxStrength);
    // Clamp current strength to valid range
    if (state.currentStrength > state.maxStrength) {
      state.currentStrength = state.maxStrength;
      curSliderInput.value = String(state.currentStrength);
    } else if (state.currentStrength < newMin) {
      state.currentStrength = newMin;
      curSliderInput.value = String(state.currentStrength);
    }
    updateDisplay();
  });

  // Current strength slider handler
  curSliderInput.addEventListener('input', () => {
    state.currentStrength = parseInt(curSliderInput.value, 10);
    updateDisplay();
  });

  // --- Color mutations only ---
  const colorDefs = mutGroups.color;
  if (colorDefs.length > 0) {
    const colorSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
    colorSection.appendChild(el('span', `font-size:14px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.color')));

    const tileOptions: MutationTileOption[] = colorDefs.map((d) => {
      const vb = findVariantBadge(d.name);
      const displayName = getMutationDisplayName(d.name);
      return {
        value: d.name,
        displayName,
        multiplier: d.multiplier,
        color: vb?.color ?? 'var(--qpm-text-muted)',
        gradient: vb?.gradient,
      };
    });

    const { container: tileContainer } = buildMutationToggleRow(tileOptions, (value) => {
      state.colorMutation = value;
      updateDisplay();
    });
    colorSection.appendChild(tileContainer);
    container.appendChild(colorSection);
  }

  // --- Friends ---
  const friendSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  friendSection.appendChild(el('span', `font-size:14px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.friends')));

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

  dustFormulaEl = el('div', 'text-align:center;margin-top:4px;');
  container.appendChild(dustFormulaEl);

  updateDisplay();
  return updateDisplay;
}
