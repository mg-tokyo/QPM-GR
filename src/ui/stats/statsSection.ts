import { subscribeToStats, type StatsSnapshot } from '../../store/stats';
import { formatCoins } from '../../features/economy/valueCalculator';
import { formatSince } from '../../utils/helpers';
import { btn, formatWeatherLabel, formatDuration } from '../core/panelHelpers';
import { t } from '../../i18n';

let statsUnsubscribe: (() => void) | null = null;

export function destroyStatsSection(): void {
  if (statsUnsubscribe) {
    statsUnsubscribe();
    statsUnsubscribe = null;
  }
}

export function createStatsSection(resetAllStats: () => void): HTMLElement {
  if (statsUnsubscribe) {
    statsUnsubscribe();
    statsUnsubscribe = null;
  }

  const section = document.createElement('div');
  section.className = 'qpm-card';
  section.dataset.qpmSection = 'stats';
  section.style.cssText = 'background: linear-gradient(135deg, rgba(100,181,246,0.08), rgba(100,181,246,0.03)); border: 1px solid rgba(100,181,246,0.15);';

  const header = document.createElement('div');
  header.className = 'qpm-card__header';
  header.style.cssText = 'cursor: pointer; padding: 12px 14px; border-radius: 8px; transition: all 0.2s ease; user-select: none;';

  const headerLabel = document.createElement('div');
  headerLabel.className = 'qpm-card__title';
  headerLabel.textContent = `📊 ${t('feature.stats.title')}`;
  headerLabel.style.cssText = 'font-size: 14px; font-weight: 700; letter-spacing: 0.3px; color: #64b5f6;';

  const caret = document.createElement('span');
  caret.style.cssText = 'font-size: 14px; color: #64b5f6; transition: transform 0.2s ease;';
  caret.textContent = '▼';

  const expandHint = document.createElement('span');
  expandHint.style.cssText = 'font-size: 10px; color: #90a4ae; margin-left: 8px; font-weight: 400;';
  expandHint.textContent = t('feature.stats.clickToExpand');

  header.append(headerLabel, caret, expandHint);

  const content = document.createElement('div');
  content.style.cssText = 'display:block;margin-top:12px;font-size:11px;color:#dbe1ff;line-height:1.6;';

  header.addEventListener('click', () => {
    const hidden = content.style.display === 'none';
    content.style.display = hidden ? 'block' : 'none';
    caret.textContent = hidden ? '▼' : '▲';
    caret.style.transform = hidden ? 'rotate(0deg)' : 'rotate(180deg)';
    expandHint.textContent = hidden ? t('feature.stats.clickToExpand') : t('feature.stats.clickToCollapse');
    header.style.background = hidden ? 'transparent' : 'rgba(100,181,246,0.08)';
  });

  header.addEventListener('mouseenter', () => {
    if (content.style.display !== 'none') return;
    header.style.background = 'rgba(100,181,246,0.05)';
  });

  header.addEventListener('mouseleave', () => {
    if (content.style.display !== 'none') return;
    header.style.background = 'transparent';
  });

  const weatherTitle = document.createElement('div');
  weatherTitle.textContent = `☀️ ${t('feature.stats.weatherUptime')}`;
  weatherTitle.style.cssText = 'font-weight:700;color:#80deea;font-size:12px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;';

  const weatherDetail = document.createElement('div');
  weatherDetail.style.cssText = 'color:#c0c0c0;font-size:10px;margin-bottom:10px;line-height:1.5;';

  const shopTitle = document.createElement('div');
  shopTitle.textContent = `🛒 ${t('feature.stats.shopStats')}`;
  shopTitle.style.cssText = 'font-weight:700;color:#ffab91;font-size:12px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;';

  const shopSummary = document.createElement('div');
  shopSummary.style.cssText = 'color:#f0f0f0;margin-bottom:3px;font-size:11px;line-height:1.5;';

  const shopDetail = document.createElement('div');
  shopDetail.style.cssText = 'color:#c0c0c0;font-size:10px;margin-bottom:8px;line-height:1.5;';

  const historyTitle = document.createElement('div');
  historyTitle.textContent = t('feature.stats.recentPurchases');
  historyTitle.style.cssText = 'font-weight:700;font-size:11px;color:#d0d0d0;margin-top:8px;margin-bottom:4px;letter-spacing:0.5px;text-transform:uppercase;';

  const historyList = document.createElement('div');
  historyList.style.cssText = 'display:flex;flex-direction:column;gap:3px;font-size:10px;color:#b0b0b0;line-height:1.5;';

  const resetRow = document.createElement('div');
  resetRow.style.cssText = 'margin-top:14px;display:flex;justify-content:flex-end;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);';

  const resetButton = btn(`♻ ${t('feature.stats.resetStats')}`, resetAllStats);
  resetButton.classList.add('qpm-button--accent');
  resetButton.style.cssText = 'font-size:11px;font-weight:600;';

  resetRow.append(resetButton);

  content.append(
    weatherTitle,
    weatherDetail,
    shopTitle,
    shopSummary,
    shopDetail,
    historyTitle,
    historyList,
    resetRow,
  );

  section.append(header, content);

  const renderStats = (snapshot: StatsSnapshot): void => {
    const { weather, shop } = snapshot;

    // Weather uptime display (time spent in each weather type)
    const uptimeEntries = Object.entries(weather.timeByKind)
      .filter(([, value]) => value > 0)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 3)
      .map(([kind, value]) => `${formatWeatherLabel(kind)} ${formatDuration(value)}`);
    weatherDetail.textContent = uptimeEntries.length > 0 ? uptimeEntries.join(' • ') : t('feature.stats.noUptimeYet');

    const shopParts: string[] = [];
    shopParts.push(t('feature.stats.itemsCount', { count: String(shop.totalPurchases) }));
    if (shop.totalSpentCoins > 0) {
      shopParts.push(`🪙 ${formatCoins(shop.totalSpentCoins)}`);
    }
    if (shop.totalSpentCredits > 0) {
      shopParts.push(`🍩 ${shop.totalSpentCredits.toLocaleString()}`);
    }
    shopSummary.textContent = shopParts.join(' • ');

    const categoryEntries = Object.entries(shop.purchasesByCategory)
      .filter(([, value]) => value > 0)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([category, value]) => `${category}: ${value}`);
    shopDetail.textContent = categoryEntries.length > 0 ? categoryEntries.join(' • ') : t('feature.stats.noPurchasesYet');

    historyList.innerHTML = '';
    const historyItems = shop.history.slice(-5).reverse();
    if (historyItems.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = t('feature.stats.noRecentPurchases');
      historyList.appendChild(empty);
    } else {
      for (const entry of historyItems) {
        const itemRow = document.createElement('div');
        const spendParts: string[] = [];
        if (entry.coins > 0) spendParts.push(`🪙 ${formatCoins(entry.coins)}`);
        if (entry.credits > 0) spendParts.push(`🍩 ${entry.credits.toLocaleString()}`);
        const spendText = spendParts.length ? ` (${spendParts.join(' • ')})` : '';
        itemRow.textContent = `${entry.itemName} ×${entry.count}${spendText} — ${formatSince(entry.timestamp)}`;
        historyList.appendChild(itemRow);
      }
    }
  };

  statsUnsubscribe = subscribeToStats(renderStats);

  return section;
}
