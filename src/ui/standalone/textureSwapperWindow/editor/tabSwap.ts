import { t } from '../../../../i18n';
import type { TextureOverrideRule } from '../../../../features/standalone/textureSwapper';
import { createButton } from '../../../components/button';
import { createEmptyState } from '../../../components/emptyState';
import type { WindowState } from '../types';
import type { ToolPanelCallbacks } from '../toolPanel';
import { displaySpriteName } from '../displayName';
import { renderRemoveRuleFooter } from './removeRuleFooter';
import { renderMoreDisclosure } from './moreDisclosure';

export function renderTabSwap(
  container: HTMLElement,
  state: WindowState,
  rules: TextureOverrideRule[],
  callbacks: ToolPanelCallbacks,
): void {
  const swapRule = rules.find(r => r.source.librarySpriteKey || r.source.uploadAssetId);
  if (!swapRule) {
    const empty = createEmptyState(t('feature.gardenPainter.swapEmpty'));
    container.appendChild(empty);
    const cta = createButton(t('feature.gardenPainter.swapEmpty'), {
      variant: 'tonal',
      onClick: () => callbacks.onEnterSwapPick(state.selectedSpriteKey, null),
    });
    container.appendChild(cta);
    return;
  }

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid var(--qpm-accent-subtle);';
  const thumb = document.createElement('div');
  thumb.style.cssText = 'width:32px;height:32px;border-radius:6px;background:rgba(100,200,255,0.18);flex-shrink:0;';
  const desc = document.createElement('div');
  desc.style.cssText = 'flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--qpm-text);';
  if (swapRule.source.librarySpriteKey) {
    desc.textContent = displaySpriteName(swapRule.source.librarySpriteKey);
  } else {
    desc.textContent = t('feature.gardenPainter.upload');
  }
  const changeBtn = createButton(t('feature.gardenPainter.swapChange'), {
    variant: 'ghost', size: 'sm',
    onClick: () => callbacks.onEnterSwapPick(state.selectedSpriteKey, swapRule.id),
  });
  row.append(thumb, desc, changeBtn);
  container.appendChild(row);

  renderMoreDisclosure(container, swapRule, callbacks);

  renderRemoveRuleFooter(container, swapRule, callbacks);
}
