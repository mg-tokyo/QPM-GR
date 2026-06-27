import { t } from '../../../../i18n';
import { deleteRule, type TextureOverrideRule } from '../../../../features/standalone/textureSwapper';
import { createButton } from '../../../components/button';
import type { ToolPanelCallbacks } from '../toolPanel';

export function renderRemoveRuleFooter(
  container: HTMLElement,
  rule: TextureOverrideRule,
  callbacks: ToolPanelCallbacks,
): void {
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:auto;padding-top:8px;display:flex;justify-content:flex-end;';
  let armed = false;
  let armTimer: number | null = null;
  const btn = createButton(t('feature.gardenPainter.removeRule'), {
    variant: 'ghost', size: 'sm',
    onClick: () => {
      if (!armed) {
        armed = true;
        btn.textContent = t('feature.gardenPainter.removeRuleConfirm');
        btn.style.color = 'var(--qpm-danger)';
        armTimer = window.setTimeout(() => {
          armed = false;
          btn.textContent = t('feature.gardenPainter.removeRule');
          btn.style.color = '';
        }, 3000);
        return;
      }
      if (armTimer) clearTimeout(armTimer);
      deleteRule(rule.id);
      callbacks.onRulesChanged();
    },
  });
  footer.appendChild(btn);
  container.appendChild(footer);
}
