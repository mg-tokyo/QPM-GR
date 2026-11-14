// Outside src/ui like diagnostics/configCard.ts: the tile contract needs an emoji icon and an rgba tint.
import type { LauncherCardConfig } from '../../ui/hub/cards/types';
import { openAlertCentre } from '../../ui/alertCentre';
import { t } from '../../i18n';

export function getAlertCentreCard(): LauncherCardConfig {
  return {
    key: 'alert-centre',
    label: t('feature.alertCentre.card.label'),
    description: t('feature.alertCentre.card.description'),
    icon: { kind: 'emoji', value: '📣' },
    tier: 'launcher',
    tile: {
      icon: '📣',
      color: 'rgba(143, 130, 255, 0.28)',
      defaultStatus: t('feature.alertCentre.card.summary'),
    },
    renderSummary: (el) => {
      el.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);margin-top:2px;';
      el.textContent = t('feature.alertCentre.card.summary');
    },
    onOpen: openAlertCentre,
  };
}
