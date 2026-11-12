import {
  isGameUpdateRefreshEnabled, onGameUpdateRefreshSettingChange, setGameUpdateRefreshEnabled,
} from '../../features/standalone/gameUpdateRefresh';
import { t } from '../../i18n';
import { createToggle } from '../components';
import type { CardIcon, ExpandableCardConfig } from '../hub/cards/types';
import { muted, toggleDetachedSection, type SectionHandle } from './sectionLayout';

const DETACH_ID = 'config-auto-reconnect';

// eslint-disable-next-line qpm/no-emoji-in-ui -- CardConfig.icon renders via renderIcon; kind:'emoji' as the spectator card beside it (spectatorSection.ts:16-17); the sprites skill lists no refresh key.
const AUTO_RECONNECT_ICON: CardIcon = { kind: 'emoji', value: '🔄' };

export function createGameUpdateRefreshSection(): SectionHandle {
  const root = document.createElement('div');
  root.dataset.qpmSection = 'autoReconnect';
  root.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  const enable = createToggle({
    checked: isGameUpdateRefreshEnabled(),
    label: t('feature.autoReconnect.enable'),
    onChange: (v) => { setGameUpdateRefreshEnabled(v); },
  });
  root.append(enable.root, muted(t('feature.autoReconnect.captionWeb')), muted(t('feature.autoReconnect.captionDiscord')));

  const off = onGameUpdateRefreshSettingChange((v) => { enable.setChecked(v); });
  return { root, destroy: off };
}

export function getGameUpdateRefreshCard(): ExpandableCardConfig {
  return {
    key: 'auto-reconnect',
    label: t('feature.autoReconnect.settingTitle'),
    description: t('feature.autoReconnect.settingCaption'),
    icon: AUTO_RECONNECT_ICON,
    tier: 'expandable',
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);margin-top:2px;';
      const paint = (on: boolean): void => { el.textContent = on ? t('common.enabled') : t('common.disabled'); };
      paint(isGameUpdateRefreshEnabled());
      return onGameUpdateRefreshSettingChange(paint);
    },
    renderExpanded: (container) => {
      const section = createGameUpdateRefreshSection();
      container.appendChild(section.root);
      return section.destroy;
    },
    detachWindowId: DETACH_ID,
    onDetach: () => {
      toggleDetachedSection(DETACH_ID, t('feature.autoReconnect.settingTitle'), createGameUpdateRefreshSection, 'autoReconnectDetach');
    },
  };
}
