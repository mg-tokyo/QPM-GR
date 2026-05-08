import { t } from '../../i18n';
import { createCard } from '../panelHelpers';
import {
  getActivityLogEnhancerStatus,
  isActivityLogEnhancerEnabled,
  setActivityLogEnhancerEnabled,
} from '../../features/activityLogNativeEnhancer';

function getStatusText(enabled: boolean): string {
  if (!enabled) {
    return t('feature.activityLog.statusDisabled');
  }
  const status = getActivityLogEnhancerStatus();
  return t('feature.activityLog.statusEnabled', {
    historyCount: String(status.historyCount),
    replaySafeCount: String(status.replaySafeCount),
  });
}

function getHelperText(enabled: boolean): string {
  if (!enabled) {
    return t('feature.activityLog.helperDisabled');
  }
  return t('feature.activityLog.helperEnabled');
}

export function createActivityLogSection(): HTMLElement {
  const statusChip = document.createElement('span');
  statusChip.className = 'qpm-chip';
  statusChip.textContent = isActivityLogEnhancerEnabled() ? t('common.enabled') : t('common.disabled');

  const { root, body } = createCard(t('hub.trackers.activityLog.label'), {
    collapsible: true,
    startCollapsed: true,
    subtitleElement: statusChip,
  });
  root.dataset.qpmSection = 'activity-log';

  const status = document.createElement('div');
  status.className = 'qpm-section-muted';
  status.style.marginBottom = '8px';
  status.textContent = getStatusText(isActivityLogEnhancerEnabled());

  const toggleRow = document.createElement('div');
  toggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;';

  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = t('hub.trackers.activityLog.label');
  toggleLabel.style.cssText = 'font-size:12px;color:#e0e0e0;font-weight:600;';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', t('feature.activityLog.enableAriaLabel'));
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
    'transition:background 0.15s,border-color 0.15s,opacity 0.15s',
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

  const helper = document.createElement('div');
  helper.style.cssText = 'font-size:10px;color:#A5D6A7;line-height:1.4;margin-top:8px;';

  const infoBox = document.createElement('div');
  infoBox.style.cssText = 'background:#333;padding:8px;border-radius:4px;margin-bottom:8px;font-size:10px;line-height:1.5;border-left:3px solid #64B5F6';
  const infoTitle = document.createElement('strong');
  infoTitle.textContent = t('feature.activityLog.infoTitle');
  infoBox.appendChild(infoTitle);
  const bullets = [
    t('feature.activityLog.infoBullet1'),
    t('feature.activityLog.infoBullet2'),
    t('feature.activityLog.infoBullet3'),
    t('feature.activityLog.infoBullet4'),
  ];
  for (const bullet of bullets) {
    infoBox.appendChild(document.createElement('br'));
    infoBox.appendChild(document.createTextNode(`- ${bullet}`));
  }
  body.appendChild(infoBox);

  const syncToggleVisual = () => {
    const enabled = isActivityLogEnhancerEnabled();
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
    statusChip.textContent = enabled ? t('common.enabled') : t('common.disabled');
    status.textContent = getStatusText(enabled);
    helper.textContent = getHelperText(enabled);
  };

  const applyToggleState = async (nextEnabled: boolean) => {
    toggle.disabled = true;
    toggle.style.opacity = '0.65';
    try {
      await setActivityLogEnhancerEnabled(nextEnabled);
    } catch {
      // Keep UI in sync with the current persisted state even if start failed.
    } finally {
      toggle.disabled = false;
      toggle.style.opacity = '1';
      syncToggleVisual();
    }
  };

  toggle.addEventListener('click', () => {
    void applyToggleState(!isActivityLogEnhancerEnabled());
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void applyToggleState(!isActivityLogEnhancerEnabled());
  });

  toggleRow.append(toggleLabel, toggle);
  body.appendChild(toggleRow);
  body.appendChild(status);
  body.appendChild(helper);

  syncToggleVisual();
  return root;
}

