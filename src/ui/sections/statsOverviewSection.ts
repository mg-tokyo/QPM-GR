import { subscribeToStats, getStatsSnapshot, resetStats } from '../../store/stats';
import { getMutationValueSnapshot, subscribeToMutationValueTracking, resetMutationValueTracking } from '../../features/mutations/valueTracking';
import { getWeatherMutationSnapshot, subscribeToWeatherMutationTracking } from '../../features/mutations/weatherTracking';
import { getAbilityDefinition } from '../../features/pets/data/petAbilities';
import { createCard, btn } from '../panelHelpers';
import { log } from '../../utils/logger';
import { t } from '../../i18n';

// Value-generating abilities only
const VALUE_ABILITIES = new Set([
  'GoldGranter', 'RainbowGranter',
  'ProduceScaleBoost', 'ProduceScaleBoostII',
  'ProduceRefund', 'DoubleHarvest',
  'SellBoostI', 'SellBoostII', 'SellBoostIII', 'SellBoostIV',
  'CoinFinderI', 'CoinFinderII', 'CoinFinderIII',
  'PetRefund', 'PetRefundII'
]);

export function createStatsOverviewSection(): HTMLElement {
  const { root, body } = createCard(`📊 ${t('feature.statsOverview.title')}`, {
    subtitle: t('feature.statsOverview.subtitle'),
  });
  root.dataset.qpmSection = 'stats-overview';

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const formatDurationLocal = (ms: number): string => {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const createStatRow = (label: string, value: string, icon: string = '•') => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2a2a;font-size:11px;';
    const labelSpan = document.createElement('span');
    labelSpan.style.color = '#888';
    labelSpan.textContent = `${icon} ${label}`;
    const valueSpan = document.createElement('span');
    valueSpan.style.cssText = 'color:#FFD700;font-weight:bold;';
    valueSpan.textContent = value;
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    return row;
  };

  const createCategoryHeader = (title: string, icon: string) => {
    const header = document.createElement('div');
    header.style.cssText = 'font-weight:bold;font-size:13px;color:#FFD700;margin:16px 0 8px 0;padding-bottom:4px;border-bottom:2px solid #FFD700;';
    header.textContent = `${icon} ${title}`;
    return header;
  };

  const coins = t('feature.statsOverview.unitCoins');
  const coinsHr = t('feature.statsOverview.unitCoinsPerHour');
  const perHr = t('feature.statsOverview.unitPerHour');
  const coinsSess = t('feature.statsOverview.unitCoinsPerSession');

  const updateStats = () => {
    body.innerHTML = '';

    // Get mutation value tracking data
    const mutationData = getMutationValueSnapshot();
    const qpmStats = getStatsSnapshot();
    const weatherData = getWeatherMutationSnapshot();

    // Session Stats
    body.appendChild(createCategoryHeader(t('feature.statsOverview.currentSession'), '⏱️'));
    const sessionDuration = Date.now() - mutationData.stats.sessionStart;
    body.appendChild(createStatRow(t('feature.statsOverview.sessionDuration'), formatDurationLocal(sessionDuration), '⏱️'));
    body.appendChild(createStatRow(t('feature.statsOverview.sessionValue'), formatNumber(mutationData.stats.sessionValue) + ' ' + coins, '💰'));

    const valuePerHour = sessionDuration > 0
      ? Math.round((mutationData.stats.sessionValue / sessionDuration) * (60 * 60 * 1000))
      : 0;
    body.appendChild(createStatRow(t('feature.statsOverview.valuePerHour'), formatNumber(valuePerHour) + ' ' + coinsHr, '📊'));

    // Mutation Value Tracking
    body.appendChild(createCategoryHeader(t('feature.statsOverview.mutationValue'), '💎'));
    body.appendChild(createStatRow(t('feature.statsOverview.goldProcs'), mutationData.stats.goldProcs + ' (' + mutationData.stats.goldPerHour.toFixed(1) + perHr + ')', '🟡'));
    body.appendChild(createStatRow(t('feature.statsOverview.goldValue'), formatNumber(mutationData.stats.goldTotalValue) + ' ' + coins, '💰'));
    body.appendChild(createStatRow(t('feature.statsOverview.rainbowProcs'), mutationData.stats.rainbowProcs + ' (' + mutationData.stats.rainbowPerHour.toFixed(1) + perHr + ')', '🌈'));
    body.appendChild(createStatRow(t('feature.statsOverview.rainbowValue'), formatNumber(mutationData.stats.rainbowTotalValue) + ' ' + coins, '💰'));
    body.appendChild(createStatRow(t('feature.statsOverview.cropBoostProcs'), mutationData.stats.cropBoostProcs + ' (' + mutationData.stats.cropBoostPerHour.toFixed(1) + perHr + ')', '📈'));
    body.appendChild(createStatRow(t('feature.statsOverview.boostValue'), formatNumber(mutationData.stats.cropBoostTotalValue) + ' ' + coins, '💰'));

    // Personal Records
    body.appendChild(createCategoryHeader(t('feature.statsOverview.personalRecords'), '🏆'));
    if (mutationData.stats.bestHourValue > 0) {
      body.appendChild(createStatRow(t('feature.statsOverview.bestHour'), formatNumber(mutationData.stats.bestHourValue) + ' ' + coins, '⭐'));
      if (mutationData.stats.bestHourTime) {
        const date = new Date(mutationData.stats.bestHourTime);
        body.appendChild(createStatRow(t('feature.statsOverview.bestHourDate'), date.toLocaleDateString(), '📅'));
      }
    }
    if (mutationData.stats.bestSessionValue > 0) {
      body.appendChild(createStatRow(t('feature.statsOverview.bestSession'), formatNumber(mutationData.stats.bestSessionValue) + ' ' + coins, '🌟'));
      if (mutationData.stats.bestSessionTime) {
        const date = new Date(mutationData.stats.bestSessionTime);
        body.appendChild(createStatRow(t('feature.statsOverview.bestSessionDate'), date.toLocaleDateString(), '📅'));
      }
    }
    if (mutationData.stats.bestHourValue === 0 && mutationData.stats.bestSessionValue === 0) {
      const recordsNote = document.createElement('div');
      recordsNote.style.cssText = 'padding:8px;background:rgba(139,195,74,0.1);border-radius:4px;font-size:10px;color:#8BC34A;margin-top:4px;';
      recordsNote.textContent = `ℹ️ ${t('feature.statsOverview.recordsNote')}`;
      body.appendChild(recordsNote);
    }

    // Weather Mutation Stats
    const totalWeatherProcs =
      weatherData.stats.wetCount +
      weatherData.stats.chilledCount +
      weatherData.stats.frozenCount +
      weatherData.stats.dawnlitCount +
      weatherData.stats.dawnboundCount +
      weatherData.stats.amberlitCount +
      weatherData.stats.amberboundCount;

    const totalWeatherProcsPerHour =
      weatherData.stats.wetPerHour +
      weatherData.stats.chilledPerHour +
      weatherData.stats.frozenPerHour +
      weatherData.stats.dawnlitPerHour +
      weatherData.stats.dawnboundPerHour +
      weatherData.stats.amberlitPerHour +
      weatherData.stats.amberboundPerHour;

    const totalWeatherValue =
      weatherData.stats.wetTotalValue +
      weatherData.stats.chilledTotalValue +
      weatherData.stats.frozenTotalValue +
      weatherData.stats.dawnlitTotalValue +
      weatherData.stats.dawnboundTotalValue +
      weatherData.stats.amberlitTotalValue +
      weatherData.stats.amberboundTotalValue;

    if (totalWeatherProcs > 0) {
      body.appendChild(createCategoryHeader(t('feature.statsOverview.weatherMutations'), '🌤️'));
      body.appendChild(createStatRow(t('feature.statsOverview.totalWeatherProcs'), formatNumber(totalWeatherProcs), '🌤️'));
      body.appendChild(createStatRow(t('feature.statsOverview.procsPerHour'), totalWeatherProcsPerHour.toFixed(1), '⚡'));
      body.appendChild(createStatRow(t('feature.statsOverview.totalValue'), formatNumber(totalWeatherValue) + ' ' + coins, '💰'));
    }

    // Ability Performance by Value
    body.appendChild(createCategoryHeader(t('feature.statsOverview.topAbilities'), '⚡'));
    const valueAbilities = Object.entries(qpmStats.abilities.valueByAbility)
      .filter(([abilityId]) => VALUE_ABILITIES.has(abilityId))
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5);

    if (valueAbilities.length > 0) {
      valueAbilities.forEach(([abilityId, value]) => {
        const def = getAbilityDefinition(abilityId);
        const name = def?.name || abilityId;
        const procs = (qpmStats.abilities.procsByAbility as Record<string, number>)[abilityId] || 0;
        const labelText = name + " (" + String(procs) + "x)";
        const valueDisplay = formatNumber(value as number) + " " + coins;
        body.appendChild(createStatRow(labelText, valueDisplay, "▸"));
      });
    } else {
      const abilityNote = document.createElement('div');
      abilityNote.style.cssText = 'padding:8px;background:rgba(139,195,74,0.1);border-radius:4px;font-size:10px;color:#8BC34A;margin-top:4px;';
      abilityNote.textContent = `ℹ️ ${t('feature.statsOverview.abilityNote')}`;
      body.appendChild(abilityNote);
    }

    // Week-over-week trends (if we have session history)
    if (mutationData.sessions && mutationData.sessions.length > 0) {
      body.appendChild(createCategoryHeader(t('feature.statsOverview.sessionHistory'), '📈'));

      const last7Days = mutationData.sessions.slice(-7);
      const totalValue = last7Days.reduce((sum, s) => sum + s.value, 0);
      const avgValue = totalValue / last7Days.length;

      body.appendChild(createStatRow(t('feature.statsOverview.sessionsLogged'), mutationData.sessions.length.toString(), '📝'));
      const avgLabel = formatNumber(Math.round(avgValue)) + " " + coinsSess;
      body.appendChild(createStatRow(t('feature.statsOverview.last7DaysAvg'), avgLabel, "📊"));

      // Trend indicator
      if (last7Days.length >= 2) {
        const recent = last7Days.slice(-3).reduce((sum, s) => sum + s.value, 0) / Math.min(3, last7Days.length);
        const older = last7Days.slice(0, -3).reduce((sum, s) => sum + s.value, 0) / Math.max(1, last7Days.length - 3);
        const trend = recent > older
          ? `📈 ${t('feature.statsOverview.trendImproving')}`
          : recent < older
            ? `📉 ${t('feature.statsOverview.trendDeclining')}`
            : `➡️ ${t('feature.statsOverview.trendStable')}`;
        body.appendChild(createStatRow(t('feature.statsOverview.trend'), trend, '📉'));
      }
    }

    // Garden Insights (only show if there's data)
    if (qpmStats.garden.totalHarvested > 0) {
      body.appendChild(createCategoryHeader(t('feature.statsOverview.gardenInsights'), '🌱'));
      body.appendChild(createStatRow(t('feature.statsOverview.totalHarvested'), formatNumber(qpmStats.garden.totalHarvested), '🌾'));

      const harvestRate = sessionDuration > 0
        ? Math.round((qpmStats.garden.totalHarvested / sessionDuration) * (60 * 60 * 1000))
        : 0;
      body.appendChild(createStatRow(t('feature.statsOverview.harvestRate'), harvestRate + perHr, '⚡'));

      if (qpmStats.garden.totalWateringCans > 0) {
        body.appendChild(createStatRow(t('feature.statsOverview.wateringCansUsed'), formatNumber(qpmStats.garden.totalWateringCans), '💧'));
      }
    }

    // Reset stats button
    const resetButton = btn(`🗑️ ${t('feature.statsOverview.resetAllStats')}`, async () => {
      if (!confirm(`⚠️ ${t('feature.statsOverview.resetConfirm')}`)) {
        return;
      }

      resetButton.disabled = true;
      resetButton.textContent = `⏳ ${t('feature.statsOverview.resetting')}`;

      try {
        const { resetPetHatchingTracker } = await import('../../store/petHatchingTracker');
        resetStats();
        resetPetHatchingTracker();
        resetMutationValueTracking();

        resetButton.textContent = `✅ ${t('feature.statsOverview.resetComplete')}`;
        setTimeout(() => {
          resetButton.textContent = `🗑️ ${t('feature.statsOverview.resetAllStats')}`;
          resetButton.disabled = false;
          updateStats();
        }, 2000);
      } catch (error) {
        log('Error resetting stats:', error);
        resetButton.textContent = `❌ ${t('feature.statsOverview.resetError')}`;
        setTimeout(() => {
          resetButton.textContent = `🗑️ ${t('feature.statsOverview.resetAllStats')}`;
          resetButton.disabled = false;
        }, 2000);
      }
    });
    resetButton.style.cssText = 'width:100%;margin-top:16px;background:#d32f2f;';
    resetButton.title = t('feature.statsOverview.resetTooltip');
    body.appendChild(resetButton);
  };

  // Initial update
  updateStats();

  // Subscribe to all relevant data sources for live updates
  const unsubscribe1 = subscribeToStats(() => updateStats());
  const unsubscribe2 = subscribeToMutationValueTracking(() => updateStats());
  const unsubscribe3 = subscribeToWeatherMutationTracking(() => updateStats());

  // Cleanup on element removal
  const observer = new MutationObserver(() => {
    if (!document.contains(root)) {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
      observer.disconnect();
    }
  });
  queueMicrotask(() => {
    observer.observe(root.parentElement ?? document.body, { childList: true, subtree: true });
  });

  return root;
}
