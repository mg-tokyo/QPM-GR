import { getMutationValueSnapshot, subscribeToMutationValueTracking } from '../../features/mutations/valueTracking';
import { getWeatherMutationSnapshot, subscribeToWeatherMutationTracking } from '../../features/mutations/weatherTracking';
import { createCard, btn } from '../core/panelHelpers';
import { windowLog } from '../core/modalWindow';
import { t } from '../../i18n';
import { watchDetach } from '../../utils/dom/dom';
import type { UIState } from '../core/panelState';

export function createMutationValueSection(cfg: any, saveCfg: () => void): HTMLElement {
  const { root, body } = createCard(`💎 ${t('feature.mutationValue.title')}`, {
    subtitle: t('feature.mutationValue.subtitle'),
    collapsible: true,
  });
  root.dataset.qpmSection = 'mutation-value';

  const info = document.createElement('div');
  info.style.cssText = 'padding:10px;background:#1a1a2a;border-radius:6px;font-size:11px;line-height:1.5;margin-bottom:12px;';
  const infoStrong = document.createElement('strong');
  infoStrong.textContent = `💰 ${t('feature.mutationValue.trackingInfo')}`;
  info.appendChild(infoStrong);
  body.appendChild(info);

  const reminderSection = document.createElement('div');
  reminderSection.style.cssText = 'margin-bottom:16px;padding:12px;background:#2a1a3a;border-radius:6px;border-left:3px solid #9C27B0;';

  const reminderHeader = document.createElement('div');
  reminderHeader.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:8px;color:#9C27B0;';
  reminderHeader.textContent = `🧬 ${t('feature.mutationValue.reminderHeader')}`;
  reminderSection.appendChild(reminderHeader);

  const reminderInfo = document.createElement('div');
  reminderInfo.textContent = `💡 ${t('feature.mutationValue.reminderInfo')}`;
  reminderInfo.style.cssText = 'font-size:10px;line-height:1.5;color:#aaa;margin-bottom:8px;';
  reminderSection.appendChild(reminderInfo);

  const reminderToggleLabel = (on: boolean) => on ? `✓ ${t('feature.mutationValue.remindersEnabled')}` : `✗ ${t('feature.mutationValue.remindersDisabled')}`;
  const reminderToggle = btn(reminderToggleLabel(!!cfg.mutationReminder?.enabled), async () => {
    if (!cfg.mutationReminder) return;
    cfg.mutationReminder.enabled = !cfg.mutationReminder.enabled;
    reminderToggle.textContent = reminderToggleLabel(cfg.mutationReminder.enabled);
    reminderToggle.classList.toggle('qpm-button--positive', cfg.mutationReminder.enabled);
    reminderToggle.classList.toggle('qpm-button--accent', cfg.mutationReminder.enabled);
    try {
      const { setMutationReminderEnabled } = await import('../../features/mutations/reminder');
      setMutationReminderEnabled(cfg.mutationReminder.enabled);
      saveCfg();
    } catch (err) {
      // Revert optimistic UI toggle on failure
      cfg.mutationReminder.enabled = !cfg.mutationReminder.enabled;
      reminderToggle.textContent = reminderToggleLabel(cfg.mutationReminder.enabled);
      reminderToggle.classList.toggle('qpm-button--positive', cfg.mutationReminder.enabled);
      reminderToggle.classList.toggle('qpm-button--accent', cfg.mutationReminder.enabled);
    }
  });
  reminderToggle.style.cssText = 'width:100%;margin-bottom:6px;';
  if (cfg.mutationReminder?.enabled) {
    reminderToggle.classList.add('qpm-button--positive', 'qpm-button--accent');
  }
  reminderSection.appendChild(reminderToggle);

  const checkNowLabel = `🔍 ${t('feature.mutationValue.checkNow')}`;
  const checkBtn = btn(checkNowLabel, async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = `⏳ ${t('feature.mutationValue.checking')}`;
    try {
      const { checkForMutations } = await import('../../features/mutations/reminder');
      await checkForMutations();
      checkBtn.textContent = `✅ ${t('feature.mutationValue.done')}`;
      setTimeout(() => {
        checkBtn.textContent = checkNowLabel;
        checkBtn.disabled = false;
      }, 2000);
    } catch (error) {
      checkBtn.textContent = `❌ ${t('feature.mutationValue.error')}`;
      windowLog.warn('QPM-UI-002', { what: 'mutationValue:checkNow' }, error);
      setTimeout(() => {
        checkBtn.textContent = checkNowLabel;
        checkBtn.disabled = false;
      }, 2000);
    }
  });
  checkBtn.style.cssText = 'width:100%;background:#9C27B0;';
  checkBtn.title = t('feature.mutationValue.checkTooltip');
  reminderSection.appendChild(checkBtn);

  body.appendChild(reminderSection);


  const valueContainer = document.createElement('div');
  valueContainer.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
  body.appendChild(valueContainer);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const formatTimeAgo = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return t('feature.mutationValue.timeAgoHours', { hours: String(hours), minutes: String(minutes % 60) });
    return t('feature.mutationValue.timeAgoMinutes', { minutes: String(minutes) });
  };

  const render = () => {
    const snapshot = getMutationValueSnapshot();
    const weatherSnapshot = getWeatherMutationSnapshot();
    valueContainer.innerHTML = '';

    const stats = snapshot.stats;
    const weatherStats = weatherSnapshot.stats;

    const totalWeatherProcs =
      weatherStats.wetCount +
      weatherStats.chilledCount +
      weatherStats.frozenCount +
      weatherStats.dawnlitCount +
      weatherStats.dawnboundCount +
      weatherStats.amberlitCount +
      weatherStats.amberboundCount;

    const totalWeatherProcsPerHour =
      weatherStats.wetPerHour +
      weatherStats.chilledPerHour +
      weatherStats.frozenPerHour +
      weatherStats.dawnlitPerHour +
      weatherStats.dawnboundPerHour +
      weatherStats.amberlitPerHour +
      weatherStats.amberboundPerHour;

    const sessionCard = document.createElement('div');
    sessionCard.style.cssText = 'padding:12px;background:linear-gradient(135deg,rgba(255,215,0,0.1),rgba(139,69,19,0.1));border-radius:6px;border-left:3px solid #FFD700;';
    sessionCard.innerHTML = `
      <div style="font-weight:bold;font-size:12px;margin-bottom:8px;">💰 ${t('feature.mutationValue.sessionValue')}</div>
      <div style="font-size:20px;font-weight:bold;color:#FFD700;">${formatNumber(stats.sessionValue)}</div>
      <div style="font-size:10px;color:#888;margin-top:4px;">${t('feature.mutationValue.sessionStarted', { time: formatTimeAgo(stats.sessionStart) })}</div>
    `;
    valueContainer.appendChild(sessionCard);

    const ratesGrid = document.createElement('div');
    ratesGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';

    ratesGrid.innerHTML = `
      <div style="padding:10px;background:#1a1a2a;border-radius:6px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">🟡</div>
        <div style="font-size:14px;font-weight:bold;color:#FFD700;">${stats.goldProcs}</div>
        <div style="font-size:9px;color:#888;margin-top:2px;">${t('feature.mutationValue.goldProcs')}</div>
        <div style="font-size:10px;color:#4CAF50;margin-top:4px;">${stats.goldPerHour.toFixed(1)}/hr</div>
      </div>
      <div style="padding:10px;background:#1a1a2a;border-radius:6px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">🌈</div>
        <div style="font-size:14px;font-weight:bold;color:#FFD700;">${stats.rainbowProcs}</div>
        <div style="font-size:9px;color:#888;margin-top:2px;">${t('feature.mutationValue.rainbowProcs')}</div>
        <div style="font-size:10px;color:#4CAF50;margin-top:4px;">${stats.rainbowPerHour.toFixed(1)}/hr</div>
      </div>
      <div style="padding:10px;background:#1a1a2a;border-radius:6px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">📈</div>
        <div style="font-size:14px;font-weight:bold;color:#FFD700;">${stats.cropBoostProcs}</div>
        <div style="font-size:9px;color:#888;margin-top:2px;">${t('feature.mutationValue.cropBoosts')}</div>
        <div style="font-size:10px;color:#4CAF50;margin-top:4px;">${stats.cropBoostPerHour.toFixed(1)}/hr</div>
      </div>
      <div style="padding:10px;background:#1a1a2a;border-radius:6px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">☁️</div>
        <div style="font-size:14px;font-weight:bold;color:#FFD700;">${totalWeatherProcs}</div>
        <div style="font-size:9px;color:#888;margin-top:2px;">${t('feature.mutationValue.weatherProcs')}</div>
        <div style="font-size:10px;color:#4CAF50;margin-top:4px;">${totalWeatherProcsPerHour.toFixed(1)}/hr</div>
      </div>
    `;
    valueContainer.appendChild(ratesGrid);

    if (stats.bestSessionValue > 0 || stats.bestHourValue > 0) {
      const recordsCard = document.createElement('div');
      recordsCard.style.cssText = 'padding:10px;background:#1a1a2a;border-radius:6px;';
      recordsCard.innerHTML = `
        <div style="font-weight:bold;font-size:11px;margin-bottom:8px;">🏆 ${t('feature.mutationValue.bestRecords')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px;">
          <div><span style="color:#888;">${t('feature.mutationValue.bestHour')}</span> <strong style="color:#FFD700;">${formatNumber(stats.bestHourValue)}</strong></div>
          <div><span style="color:#888;">${t('feature.mutationValue.bestSession')}</span> <strong style="color:#FFD700;">${formatNumber(stats.bestSessionValue)}</strong></div>
        </div>
      `;
      valueContainer.appendChild(recordsCard);
    }
  };

  render();
  const unsubscribe = subscribeToMutationValueTracking(render);
  const weatherUnsubscribe = subscribeToWeatherMutationTracking(render);

  watchDetach(root, () => {
    unsubscribe();
    weatherUnsubscribe();
  });

  return root;
}

export function createMutationSection(uiState: UIState, cfg: any, saveCfg: () => void, opts?: { startExpanded?: boolean }): HTMLElement {
  const statusChip = document.createElement('span');
  statusChip.className = 'qpm-chip';
  statusChip.textContent = cfg.mutationReminder?.enabled ? t('common.enabled') : t('common.disabled');

  const { root, body } = createCard(`🧬 ${t('feature.mutationValue.reminderHeader')}`, {
    collapsible: true,
    startCollapsed: !opts?.startExpanded,
    subtitleElement: statusChip,
  });
  root.dataset.qpmSection = 'mutation-reminder';

  const mStatus = document.createElement('div');
  mStatus.textContent = t('feature.mutationValue.monitoringWeather');
  mStatus.className = 'qpm-section-muted';
  body.appendChild(mStatus);

  const infoBox = document.createElement('div');
  const infoIcon = document.createTextNode('💡 ');
  const infoTitle = document.createElement('strong');
  infoTitle.textContent = t('feature.mutationValue.howItWorks');
  infoBox.appendChild(infoIcon);
  infoBox.appendChild(infoTitle);
  for (const key of [
    'feature.mutationValue.howItWorksBullet1',
    'feature.mutationValue.howItWorksBullet2',
    'feature.mutationValue.howItWorksBullet3',
    'feature.mutationValue.howItWorksBullet4',
  ] as const) {
    infoBox.appendChild(document.createElement('br'));
    infoBox.appendChild(document.createTextNode(`• ${t(key)}`));
  }
  infoBox.style.cssText = 'background:#333;padding:8px;border-radius:4px;font-size:10px;line-height:1.5;border-left:3px solid #9C27B0';
  body.appendChild(infoBox);

  const mToggleLabel = (on: boolean) => on ? `✓ ${t('feature.mutationValue.remindersEnabled')}` : `✗ ${t('feature.mutationValue.remindersDisabled')}`;
  const mToggle = btn(mToggleLabel(!!cfg.mutationReminder?.enabled), async () => {
    if (!cfg.mutationReminder) return;
    cfg.mutationReminder.enabled = !cfg.mutationReminder.enabled;
    mToggle.textContent = mToggleLabel(cfg.mutationReminder.enabled);
    mToggle.classList.toggle('qpm-button--positive', cfg.mutationReminder.enabled);
    mToggle.classList.toggle('qpm-button--accent', cfg.mutationReminder.enabled);
    statusChip.textContent = cfg.mutationReminder.enabled ? t('common.enabled') : t('common.disabled');
    try {
      const { setMutationReminderEnabled } = await import('../../features/mutations/reminder');
      setMutationReminderEnabled(cfg.mutationReminder.enabled);
      saveCfg();
    } catch (err) {
      // Revert optimistic UI toggle on failure
      cfg.mutationReminder.enabled = !cfg.mutationReminder.enabled;
      mToggle.textContent = mToggleLabel(cfg.mutationReminder.enabled);
      mToggle.classList.toggle('qpm-button--positive', cfg.mutationReminder.enabled);
      mToggle.classList.toggle('qpm-button--accent', cfg.mutationReminder.enabled);
      statusChip.textContent = cfg.mutationReminder.enabled ? t('common.enabled') : t('common.disabled');
    }
  });
  mToggle.style.width = '100%';
  if (cfg.mutationReminder?.enabled) {
    mToggle.classList.add('qpm-button--positive', 'qpm-button--accent');
  }
  body.appendChild(mToggle);

  const checkNowLabel2 = `🔍 ${t('feature.mutationValue.checkNow')}`;
  const checkBtn = btn(checkNowLabel2, async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = `⏳ ${t('feature.mutationValue.checking')}`;
    try {
      const { checkForMutations } = await import('../../features/mutations/reminder');
      await checkForMutations();
      checkBtn.textContent = `✅ ${t('feature.mutationValue.done')}`;
      setTimeout(() => {
        checkBtn.textContent = checkNowLabel2;
        checkBtn.disabled = false;
      }, 2000);
    } catch (error) {
      checkBtn.textContent = `❌ ${t('feature.mutationValue.error')}`;
      windowLog.warn('QPM-UI-002', { what: 'mutationReminder:checkNow' }, error);
      setTimeout(() => {
        checkBtn.textContent = checkNowLabel2;
        checkBtn.disabled = false;
      }, 2000);
    }
  });
  checkBtn.style.width = '100%';
  checkBtn.style.background = '#9C27B0';
  checkBtn.title = t('feature.mutationValue.checkTooltip');
  body.appendChild(checkBtn);

  uiState.mutationStatus = mStatus;

  return root;
}
