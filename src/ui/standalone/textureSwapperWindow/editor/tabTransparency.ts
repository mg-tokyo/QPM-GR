import { t } from '../../../../i18n';
import {
  addRule, updateRule, deleteRule, parseAtlasKey, scopeKey,
  type TextureOverrideRule,
} from '../../../../features/standalone/textureSwapper';
import { createSliderRow } from '../../../components/sliderRow';
import type { WindowState } from '../types';
import type { ToolPanelCallbacks } from '../toolPanel';
import { renderRemoveRuleFooter } from './removeRuleFooter';

export function renderTabTransparency(
  container: HTMLElement,
  state: WindowState,
  rules: TextureOverrideRule[],
  callbacks: ToolPanelCallbacks,
  refreshPreview: () => void,
): void {
  const editorSk = scopeKey(state.editorScope);
  const activeSlot = state.advancedSlotIndex;
  const matchSlot = (r: TextureOverrideRule): boolean => (r.slotIndex ?? null) === activeSlot;
  const matchScope = (r: TextureOverrideRule): boolean => scopeKey(r.scope) === editorSk;
  const tRule = rules.find(r => r.params.alpha != null && r.params.alpha !== 1 && matchScope(r) && matchSlot(r));
  const initialAlpha = tRule?.params.alpha ?? 0.5;
  const slider = createSliderRow({
    label: t('feature.gardenPainter.transparency'),
    min: 0, max: 1, step: 0.01,
    value: initialAlpha,
    onChange: (v) => {
      const existing = rules.find(r => r.params.alpha != null && r.params.alpha !== 1 && matchScope(r) && matchSlot(r));
      if (existing) {
        if (v === 1) {
          deleteRule(existing.id);
        } else {
          updateRule({ ...existing, params: { ...existing.params, alpha: v } }, { silent: true });
        }
      } else if (v !== 1) {
        const { category, id } = parseAtlasKey(state.selectedSpriteKey);
        const newRule: Omit<TextureOverrideRule, 'id'> = {
          enabled: true,
          targetSpriteKey: state.selectedSpriteKey,
          targetCategory: category,
          displayLabel: id,
          source: { type: 'library' },
          params: { alpha: v },
          scope: state.editorScope,
        };
        if (activeSlot != null) newRule.slotIndex = activeSlot;
        addRule(newRule, { silent: true });
      }
      refreshPreview();
      callbacks.onRulesChanged();
    },
  });
  container.appendChild(slider);
  if (tRule) renderRemoveRuleFooter(container, tRule, callbacks);
}
