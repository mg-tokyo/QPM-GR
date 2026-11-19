import { listKeybindActions, onKeybindsChange } from '../../../features/input/keybinds';
import { t } from '../../../i18n';
import type { LauncherCardConfig } from '../../hub';
import { getCurrentVersion, setStatusText } from '../../panel/tileStatuses';
import type { PerTileStatusProvider } from '../../panel/tileStatusTypes';
import { KEYBINDS_SPRITE, openKeybindsWindow } from './index';

function boundCount(): number {
  return listKeybindActions().filter(a => a.combo).length;
}

const startKeybindsTileStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  if (version !== getCurrentVersion()) return;
  const render = (): void => setStatusText(el, t('feature.keybinds.cardSummary', { count: boundCount() }), 'positive');
  render();
  addLiveCleanup(version, onKeybindsChange(render));
};

/** Config's one Keybinds card; replaces the Panel Shortcut and Shop Keybinds cards (INP-1 D1). */
export function getKeybindsCard(): LauncherCardConfig {
  return {
    key: 'keybinds',
    label: t('feature.keybinds.title'),
    description: t('feature.keybinds.cardCaption'),
    // eslint-disable-next-line qpm/no-emoji-in-ui -- CardIcon fallback while sprites load, as the other keybind cards.
    icon: { kind: 'sprite', value: '⌨️', spriteKey: KEYBINDS_SPRITE, fallback: '⌨️' },
    tier: 'launcher',
    tile: {
      // eslint-disable-next-line qpm/no-emoji-in-ui -- TileMeta.icon renders via textContent (src/ui/panel/tileGrid.ts:146); no sprite path for tiles yet.
      icon: '⌨️',
      // eslint-disable-next-line qpm/no-hardcoded-colors -- TileMeta.color is a per-feature rgba tint (src/ui/panel/tileGrid.ts:127-129); no token for tile tints.
      color: 'rgba(167, 139, 250, 0.28)',
      defaultStatus: '—',
      statusProvider: startKeybindsTileStatus,
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);margin-top:2px;';
      const paint = (): void => { el.textContent = t('feature.keybinds.cardSummary', { count: boundCount() }); };
      paint();
      return onKeybindsChange(paint);
    },
    onOpen: openKeybindsWindow,
  };
}
