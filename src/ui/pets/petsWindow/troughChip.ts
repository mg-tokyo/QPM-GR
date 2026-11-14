import { getTroughIconUrl, onTroughChange, type TroughSnapshot } from '../../../features/pets/troughAlarm';
import { t } from '../../../i18n';

/** "Trough n/cap" pill in the Pets tab bar; amber at the alarm level, hidden without a trough. */
export function createTroughChip(): { el: HTMLDivElement; destroy: () => void } {
  const el = document.createElement('div');
  el.className = 'qpm-pets__stage-badge qpm-pets__stage-badge--hidden';
  el.dataset.qpmTroughChip = '';
  Object.assign(el.style, { alignItems: 'center', gap: '4px' });
  const icon = document.createElement('img');
  icon.alt = '';
  icon.decoding = 'async';
  Object.assign(icon.style, { width: '14px', height: '14px', objectFit: 'contain', display: 'none' });
  const label = document.createElement('span');
  el.append(icon, label);

  const render = (s: TroughSnapshot): void => {
    const hidden = s.capacity === null;
    el.classList.toggle('qpm-pets__stage-badge--hidden', hidden);
    // Inline display would beat the --hidden class, so it is set only while shown.
    el.style.display = hidden ? '' : 'inline-flex';
    if (s.capacity === null) return;
    label.textContent = t('feature.troughAlarm.chip', { count: s.count, capacity: s.capacity });
    el.title = t('feature.troughAlarm.chipTitle', { count: s.count, capacity: s.capacity, lowAt: s.lowAt });
    el.style.borderColor = s.low ? 'var(--qpm-warning)' : '';
    el.style.color = s.low ? 'var(--qpm-warning)' : '';
    if (!icon.src) {
      const url = getTroughIconUrl();
      if (url) {
        icon.src = url;
        icon.style.display = '';
      }
    }
  };

  const off = onTroughChange(render);
  return { el, destroy: off };
}
