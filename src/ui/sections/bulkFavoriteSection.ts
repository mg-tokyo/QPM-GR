import { createCard } from '../panelHelpers';
import { isBulkFavoriteEnabled, setBulkFavoriteEnabled } from '../../features/standalone/bulkFavorite';
import { t } from '../../i18n';

export function createBulkFavoriteSection(opts?: { startExpanded?: boolean }): HTMLElement {
  const statusChip = document.createElement('span');
  statusChip.className = 'qpm-chip';
  statusChip.textContent = isBulkFavoriteEnabled() ? t('common.enabled') : t('common.disabled');

  const { root, body } = createCard(`❤️ ${t('feature.bulkFav.title')}`, {
    collapsible: true,
    startCollapsed: !opts?.startExpanded,
    subtitleElement: statusChip,
  });
  root.dataset.qpmSection = 'bulk-favorite';

  const status = document.createElement('div');
  status.className = 'qpm-section-muted';
  status.style.marginBottom = '8px';
  status.textContent = t('feature.bulkFav.description');
  body.appendChild(status);

  const toggleRow = document.createElement('div');
  toggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;';

  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = t('feature.bulkFav.title');
  toggleLabel.style.cssText = 'font-size:12px;color:#e0e0e0;font-weight:600;';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', t('feature.bulkFav.enableAriaLabel'));
  toggle.style.cssText = [
    'width:36px',
    'height:22px',
    'border-radius:999px',
    'border:1px solid rgba(255,255,255,0.24)',
    'background:rgba(255,255,255,0.12)',
    'cursor:pointer',
    'position:relative',
    'outline:none',
    'padding:0',
    'display:inline-flex',
    'align-items:center',
    'justify-content:flex-start',
    'transition:background 0.15s,border-color 0.15s',
  ].join(';');

  const toggleKnob = document.createElement('span');
  toggleKnob.style.cssText = [
    'position:absolute',
    'top:1px',
    'left:1px',
    'width:18px',
    'height:18px',
    'border-radius:999px',
    'background:#ffffff',
    'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
    'transition:transform 0.15s',
    'pointer-events:none',
  ].join(';');
  toggle.appendChild(toggleKnob);

  const syncToggleVisual = () => {
    const enabled = isBulkFavoriteEnabled();
    toggle.setAttribute('aria-checked', String(enabled));
    if (enabled) {
      toggle.style.background = 'rgba(143,130,255,0.45)';
      toggle.style.borderColor = 'rgba(143,130,255,0.7)';
      toggleKnob.style.transform = 'translateX(14px)';
    } else {
      toggle.style.background = 'rgba(255,255,255,0.12)';
      toggle.style.borderColor = 'rgba(255,255,255,0.24)';
      toggleKnob.style.transform = 'translateX(0)';
    }
  };

  const applyToggleState = (nextEnabled: boolean) => {
    setBulkFavoriteEnabled(nextEnabled);
    statusChip.textContent = nextEnabled ? t('common.enabled') : t('common.disabled');
    status.textContent = nextEnabled
      ? t('feature.bulkFav.description')
      : t('feature.bulkFav.statusDisabled');
    syncToggleVisual();
  };

  toggle.addEventListener('click', () => {
    applyToggleState(!isBulkFavoriteEnabled());
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      applyToggleState(!isBulkFavoriteEnabled());
    }
  });
  syncToggleVisual();

  toggleRow.append(toggleLabel, toggle);
  body.appendChild(toggleRow);

  const infoBox = document.createElement('div');
  const infoHeader = document.createElement('strong');
  infoHeader.textContent = `💡 ${t('feature.bulkFav.howItWorks')}`;
  infoBox.appendChild(infoHeader);
  infoBox.appendChild(document.createElement('br'));
  for (const key of [
    'feature.bulkFav.infoBullet1',
    'feature.bulkFav.infoBullet2',
    'feature.bulkFav.infoBullet3',
    'feature.bulkFav.infoBullet4',
  ] as const) {
    infoBox.appendChild(document.createTextNode(`• ${t(key)}`));
    infoBox.appendChild(document.createElement('br'));
  }
  infoBox.style.cssText = 'background:#333;padding:8px;border-radius:4px;margin-bottom:8px;font-size:10px;line-height:1.5;border-left:3px solid #FFCA28';
  body.appendChild(infoBox);

  const getHelperText = () => isBulkFavoriteEnabled()
    ? t('feature.bulkFav.helperEnabled')
    : t('feature.bulkFav.helperDisabled');

  const helper = document.createElement('div');
  helper.textContent = getHelperText();
  helper.style.cssText = 'font-size:10px;color:#A5D6A7;line-height:1.4;margin-top:8px;';
  body.appendChild(helper);

  toggle.addEventListener('click', () => {
    helper.textContent = getHelperText();
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    helper.textContent = getHelperText();
  });

  return root;
}
