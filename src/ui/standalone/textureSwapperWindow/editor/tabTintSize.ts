import { t } from '../../../../i18n';
import {
  addRule, updateRule, deleteRule, parseAtlasKey, getTextureSwapperState,
  scopeKey,
  type TextureOverrideRule,
} from '../../../../features/standalone/textureSwapper';
import { createSliderRow } from '../../../components/sliderRow';
import { createColorPicker } from '../../../components/colorPicker';
import { createButton } from '../../../components/button';
import { createSectionHeader } from '../../../components/sectionHeader';
import { debounce } from '../../../../utils/scheduling/debounce';
import type { WindowState } from '../types';
import type { ToolPanelCallbacks } from '../toolPanel';
import { renderRemoveRuleFooter } from './removeRuleFooter';

export function renderTabTintSize(
  container: HTMLElement,
  state: WindowState,
  rules: TextureOverrideRule[],
  callbacks: ToolPanelCallbacks,
  refreshPreview: () => void,
  refresh: () => void,
): void {
  const activeSlot = state.advancedSlotIndex;
  const editorSk = scopeKey(state.editorScope);
  const matchSlot = (r: TextureOverrideRule): boolean => (r.slotIndex ?? null) === activeSlot;
  const matchScope = (r: TextureOverrideRule): boolean => scopeKey(r.scope) === editorSk;
  const existing = rules.find(r => matchSlot(r) && matchScope(r) && (r.params.tintColor != null || r.params.scaleX != null || r.params.scaleY != null));

  let tintColor = existing?.params.tintColor ?? '#ff8800';
  let tintStrength = existing?.params.tintAlpha ?? 0;
  let size = existing?.params.scaleX ?? 1;
  let hasTint = existing?.params.tintColor != null;

  const findRule = (): TextureOverrideRule | undefined =>
    getTextureSwapperState().rules.find(r =>
      r.targetSpriteKey === state.selectedSpriteKey && matchSlot(r) && matchScope(r) &&
      (r.params.tintColor != null || r.params.scaleX != null || r.params.scaleY != null),
    );

  const applyChange = (): void => {
    const noEffect = !hasTint && size === 1;
    const cur = findRule();
    if (cur) {
      if (noEffect) { deleteRule(cur.id); return; }
      const next: TextureOverrideRule['params'] = {};
      if (cur.params.alpha != null) next.alpha = cur.params.alpha;
      if (hasTint) { next.tintColor = tintColor; next.tintAlpha = tintStrength; }
      if (size !== 1) next.scaleX = size;
      updateRule({ ...cur, params: next }, { silent: true });
      return;
    }
    if (noEffect) return;
    const { category, id } = parseAtlasKey(state.selectedSpriteKey);
    const params: TextureOverrideRule['params'] = {};
    if (hasTint) { params.tintColor = tintColor; params.tintAlpha = tintStrength; }
    if (size !== 1) params.scaleX = size;
    const newRule: Omit<TextureOverrideRule, 'id'> = {
      enabled: true,
      targetSpriteKey: state.selectedSpriteKey,
      targetCategory: category,
      displayLabel: id,
      source: { type: 'library' },
      params,
      mutationBehavior: 'preserve',
      scope: state.editorScope,
    };
    if (activeSlot != null) newRule.slotIndex = activeSlot;
    addRule(newRule, { silent: true });
  };

  const debouncedApply = debounce(applyChange, 150);
  const debouncedPreview = debounce(refreshPreview, 60);
  const onChange = (): void => { debouncedApply(); debouncedPreview(); };

  container.appendChild(createSectionHeader(t('feature.gardenPainter.tint'), { size: 'compact' }).root);
  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const colorLabel = document.createElement('div');
  colorLabel.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);width:60px;flex-shrink:0;';
  colorLabel.textContent = t('feature.gardenPainter.color');
  colorRow.append(colorLabel, createColorPicker(tintColor, (v) => { tintColor = v; hasTint = true; onChange(); }));
  container.appendChild(colorRow);
  container.appendChild(createSliderRow({
    label: t('feature.gardenPainter.strength'),
    min: 0, max: 1, step: 0.05, value: tintStrength,
    onChange: (v) => { tintStrength = v; hasTint = true; onChange(); },
    formatFn: (v) => `${Math.round(v * 100)}%`,
  }));
  container.appendChild(createSectionHeader(t('feature.gardenPainter.size'), { size: 'compact' }).root);
  container.appendChild(createSliderRow({
    label: t('feature.gardenPainter.size'),
    min: 0.5, max: 2, step: 0.05, value: size,
    onChange: (v) => { size = v; onChange(); },
    formatFn: (v) => `${v.toFixed(2)}×`,
  }));
  if (existing) {
    container.appendChild(createButton(t('feature.gardenPainter.reset'), {
      variant: 'ghost',
      onClick: () => {
        tintColor = '#ff8800'; tintStrength = 0; size = 1; hasTint = false;
        applyChange();
        refresh();
      },
    }));
    renderRemoveRuleFooter(container, existing, callbacks);
  }
}
