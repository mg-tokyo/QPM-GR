import { t } from '../../../../i18n';
import { updateRule, type TextureOverrideRule } from '../../../../features/standalone/textureSwapper';
import { createButton } from '../../../components/button';
import type { ToolPanelCallbacks } from '../toolPanel';

export function renderMoreDisclosure(
  container: HTMLElement,
  rule: TextureOverrideRule,
  callbacks: ToolPanelCallbacks,
): void {
  const details = document.createElement('details');
  details.style.cssText = 'margin-top:4px;';
  const summary = document.createElement('summary');
  summary.style.cssText = 'font-size:11px;color:var(--qpm-text-muted);cursor:pointer;user-select:none;padding:4px 0;';
  summary.textContent = t('feature.gardenPainter.moreLabel');
  details.appendChild(summary);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;gap:4px;padding:6px 0;';
  const cur = rule.mutationBehavior ?? 'preserve';
  for (const opt of ['preserve', 'replace'] as const) {
    const active = cur === opt;
    const pill = createButton(
      opt === 'preserve' ? t('feature.gardenPainter.keepMutationsOnSwap') : t('feature.gardenPainter.replaceMutationsOnSwap'),
      {
        variant: active ? 'secondary' : 'ghost',
        size: 'sm', pill: true,
        onClick: () => {
          if (cur !== opt) {
            updateRule({ ...rule, mutationBehavior: opt });
            callbacks.onRulesChanged();
          }
        },
      },
    );
    pill.style.fontSize = '10px';
    pill.style.padding = '2px 8px';
    body.appendChild(pill);
  }
  details.appendChild(body);
  container.appendChild(details);
}
