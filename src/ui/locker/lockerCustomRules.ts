// src/ui/locker/lockerCustomRules.ts
// Custom plant+mutation rules card for the Locker.

import { createCard } from '../core/panelHelpers';
import { getLockerConfig, updateLockerConfig, type LockerConfig } from '../../features/locker/index';
import type { CustomRule } from '../../features/locker/types';
import { areCatalogsReady, getAllMutations, getMutation } from '../../catalogs/gameCatalogs';
import { getCropSpriteDataUrl, getCropSpriteDataUrlWithMutations } from '../../sprite-v2/compat';
import { findVariantBadge } from '../../features/mutations/data/variantBadges';
import {
  LABEL_CSS, UNLOCKED_BG, UNLOCKED_BORDER, TEXT_MUTED,
  makeHint, makeMutationTile, type EligibleData,
} from './lockerPrimitives';
import { buildPlantPicker } from './lockerPlantPicker';
import { t } from '../../i18n';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ruleKey(species: string, mutations: string[]): string {
  return `${species}\0${[...mutations].sort().join('\0')}`;
}

function renderMutationTiles(
  container: HTMLElement,
  mutationIds: string[],
  selectedMuts: Set<string>,
  onChange: () => void,
): void {
  container.innerHTML = '';
  if (mutationIds.length === 0) {
    container.appendChild(makeHint(t('feature.locker.noMutationsAvailable')));
    return;
  }
  for (const mutId of mutationIds) {
    container.appendChild(makeMutationTile(
      mutId,
      () => selectedMuts.has(mutId),
      () => {
        if (selectedMuts.has(mutId)) selectedMuts.delete(mutId);
        else selectedMuts.add(mutId);
        onChange();
      },
    ));
  }
}

function renderRuleRow(rule: CustomRule, index: number, onDelete: () => void): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:${UNLOCKED_BG};border:1px solid ${UNLOCKED_BORDER}`;

  const spriteUrl = getCropSpriteDataUrlWithMutations(rule.species, rule.mutations) || getCropSpriteDataUrl(rule.species);
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.alt = rule.species;
    img.style.cssText = 'width:24px;height:24px;image-rendering:pixelated;object-fit:contain;flex-shrink:0';
    row.appendChild(img);
  }

  const speciesLabel = document.createElement('span');
  speciesLabel.textContent = rule.species;
  speciesLabel.style.cssText = 'font-size:12px;color:var(--qpm-text,#fff);flex-shrink:0';
  row.appendChild(speciesLabel);

  const sep = document.createElement('span');
  sep.textContent = '\u00d7';
  sep.style.cssText = `font-size:12px;color:${TEXT_MUTED};flex-shrink:0`;
  row.appendChild(sep);

  const mutsWrap = document.createElement('div');
  mutsWrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;flex:1;min-width:0';
  for (let i = 0; i < rule.mutations.length; i++) {
    const mut = rule.mutations[i]!;
    const vb = findVariantBadge(mut);
    const dotColor = vb?.color ?? '#888';
    const dotGradient = vb?.gradient;

    if (i > 0) {
      const plus = document.createElement('span');
      plus.textContent = '+';
      plus.style.cssText = `font-size:10px;color:${TEXT_MUTED}`;
      mutsWrap.appendChild(plus);
    }

    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px';

    const dot = document.createElement('div');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${dotGradient ?? dotColor}`;
    chip.appendChild(dot);

    const name = document.createElement('span');
    name.textContent = getMutation(mut)?.name ?? mut;
    name.style.cssText = 'font-size:11px;color:var(--qpm-text,#fff);white-space:nowrap';
    chip.appendChild(name);

    mutsWrap.appendChild(chip);
  }
  row.appendChild(mutsWrap);

  const delBtn = document.createElement('button');
  delBtn.textContent = '\ud83d\uddd1\ufe0f';
  delBtn.title = t('feature.locker.removeRule');
  delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:0 2px;line-height:1;opacity:0.6;flex-shrink:0';
  delBtn.addEventListener('mouseenter', () => { delBtn.style.opacity = '1'; });
  delBtn.addEventListener('mouseleave', () => { delBtn.style.opacity = '0.6'; });
  delBtn.addEventListener('click', onDelete);
  row.appendChild(delBtn);

  return row;
}

// ── Main card builder ───────────────────────────────────────────────────────

export function buildCustomRulesCard(config: LockerConfig, eligible: EligibleData): HTMLElement {
  const { root, body } = createCard(t('feature.locker.customRules'), { collapsible: true });

  let selectedSpecies: string | null = null;
  const selectedMutations = new Set<string>();

  // ── Plant picker ──
  const plantLabel = document.createElement('div');
  plantLabel.textContent = t('feature.locker.plant');
  plantLabel.style.cssText = LABEL_CSS + ';font-size:12px;padding:2px 0';
  body.appendChild(plantLabel);

  const plantPicker = buildPlantPicker(null, eligible.species, (sp) => {
    selectedSpecies = sp;
    updateAddBtn();
  });
  body.appendChild(plantPicker);

  // ── Mutation picker ──
  const mutLabelEl = document.createElement('div');
  mutLabelEl.textContent = t('feature.locker.mutations');
  mutLabelEl.style.cssText = LABEL_CSS + ';font-size:12px;padding:6px 0 2px';
  body.appendChild(mutLabelEl);

  const mutGrid = document.createElement('div');
  mutGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:4px 0';

  function rebuildMutGrid(): void {
    if (!areCatalogsReady()) {
      mutGrid.innerHTML = '';
      mutGrid.appendChild(makeHint(t('feature.locker.mutationCatalogNotLoaded')));
      return;
    }
    renderMutationTiles(mutGrid, getAllMutations().sort(), selectedMutations, () => { updateAddBtn(); });
  }
  rebuildMutGrid();
  body.appendChild(mutGrid);

  // ── Add button ──
  const addBtn = document.createElement('button');
  addBtn.textContent = t('feature.locker.addRules');
  addBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid rgba(143,130,255,0.5);background:rgba(143,130,255,0.15);color:#8f82ff;font-size:11px;font-weight:600;cursor:pointer;align-self:flex-start;margin-top:2px';
  addBtn.disabled = true;
  addBtn.style.opacity = '0.5';

  const updateAddBtn = (): void => {
    if (!selectedSpecies || selectedMutations.size === 0) {
      addBtn.disabled = true;
      addBtn.style.opacity = '0.5';
      return;
    }
    const cur = getLockerConfig();
    const existing = new Set(cur.customRules.map(r => ruleKey(r.species, r.mutations)));
    const key = ruleKey(selectedSpecies, [...selectedMutations]);
    const isNew = !existing.has(key);
    addBtn.disabled = !isNew;
    addBtn.style.opacity = isNew ? '1' : '0.5';
  };

  addBtn.addEventListener('click', () => {
    if (!selectedSpecies || selectedMutations.size === 0) return;
    const cur = getLockerConfig();
    const existing = new Set(cur.customRules.map(r => ruleKey(r.species, r.mutations)));
    const muts = [...selectedMutations].sort();
    const key = ruleKey(selectedSpecies, muts);
    if (existing.has(key)) return;
    const newRules = [...cur.customRules, { species: selectedSpecies, mutations: muts }];
    updateLockerConfig({ customRules: newRules });
    selectedMutations.clear();
    rebuildMutGrid();
    refreshRuleList();
  });
  body.appendChild(addBtn);

  // ── Divider ──
  const divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 0';
  body.appendChild(divider);

  // ── Rule list ──
  const ruleListLabel = document.createElement('div');
  ruleListLabel.textContent = t('feature.locker.activeRules');
  ruleListLabel.style.cssText = LABEL_CSS + ';font-size:12px;padding:2px 0';
  body.appendChild(ruleListLabel);

  const ruleList = document.createElement('div');
  ruleList.style.cssText = 'display:flex;flex-direction:column;gap:4px';

  function refreshRuleList(): void {
    ruleList.innerHTML = '';
    const cur = getLockerConfig();
    if (cur.customRules.length === 0) {
      ruleList.appendChild(makeHint(t('feature.locker.noCustomRulesYet')));
    } else {
      for (let i = 0; i < cur.customRules.length; i++) {
        const index = i;
        ruleList.appendChild(renderRuleRow(cur.customRules[i]!, i, () => {
          const latest = getLockerConfig();
          const next = latest.customRules.filter((_, j) => j !== index);
          updateLockerConfig({ customRules: next });
          refreshRuleList();
        }));
      }
    }
    updateAddBtn();
  }

  body.appendChild(ruleList);
  refreshRuleList();

  if (!config.enabled) root.style.opacity = '0.55';
  return root;
}
