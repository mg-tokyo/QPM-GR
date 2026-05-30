import { createTabBar } from '../components/tabBar';
import { createToggle } from '../components/toggle';
import { createButton } from '../components/button';
import { createSpinner } from '../components/spinner';
import { createEmptyState } from '../components/emptyState';
import { getPlantCatalog, getMutationCatalog, getPetCatalog } from '../../catalogs/gameCatalogs';
import { getCropSizeIndicatorConfig, setCropSizeIndicatorConfig } from '../../features/standalone/tooltipInjection';
import { t } from '../../i18n';
import { COLOR_PRODUCE, COLOR_PETS, COLOR_TIPS } from './constants';
import { injectJournalStyles } from './styles';
import { renderProduceTab } from './tabProduce';
import { renderPetsTab } from './tabPets';
import { renderRecommendationsTab } from './tabRecommendations';

// ── Stat box helper ─────────────────────────────────────────────────────────

function createStatBox(
  icon: string,
  label: string,
  value: string,
  color: string,
  bgGradient: string,
): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText =
    `background:linear-gradient(135deg, ${bgGradient});` +
    'border-radius:var(--qpm-radius-md);padding:10px 8px;text-align:center;' +
    `border:2px solid ${color}22;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);` +
    'cursor:pointer;position:relative;overflow:hidden;min-width:0;';

  const content = document.createElement('div');
  content.style.cssText = 'position:relative;z-index:1;';
  content.innerHTML =
    `<div style="font-size:var(--qpm-font-display);margin-bottom:4px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));line-height:1;">${icon}</div>` +
    `<div class="stat-value" style="color:${color};font-size:var(--qpm-font-title);font-weight:var(--qpm-weight-bold);margin-bottom:3px;font-family:var(--qpm-font);text-shadow:0 2px 8px rgba(0,0,0,0.4);line-height:1.1;">${value}</div>` +
    `<div style="color:var(--qpm-text-muted);font-size:var(--qpm-font-caption);font-weight:var(--qpm-weight-semibold);text-transform:uppercase;letter-spacing:0.6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>`;
  box.appendChild(content);

  box.addEventListener('mouseenter', () => {
    box.style.transform = 'translateY(-2px)';
    box.style.borderColor = `${color}55`;
    box.style.boxShadow = `0 6px 12px ${color}22`;
  });
  box.addEventListener('mouseleave', () => {
    box.style.transform = 'translateY(0)';
    box.style.borderColor = `${color}22`;
    box.style.boxShadow = 'none';
  });

  return box;
}

function updateStat(box: HTMLElement, text: string): void {
  const el = box.querySelector('.stat-value');
  if (el) {
    el.textContent = text;
    el.animate(
      [{ transform: 'scale(1.2)', opacity: 0.5 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 300, easing: 'ease-out' },
    );
  }
}

// ── Main section ────────────────────────────────────────────────────────────

export function createJournalCheckerSection(): HTMLElement {
  const cleanups: Array<() => void> = [];
  let catalogRetries = 0;
  let retryTimeoutId: number | undefined;
  cleanups.push(() => { if (retryTimeoutId !== undefined) clearTimeout(retryTimeoutId); });

  // ── Root ────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.dataset.qpmSection = 'journal-checker';
  root.style.cssText =
    'display:flex;flex-direction:column;flex:1;height:100%;min-height:0;' +
    'overflow:hidden;box-sizing:border-box;background:var(--qpm-surface-window);' +
    'border-radius:var(--qpm-radius-md);padding:16px;color:var(--qpm-text);';

  injectJournalStyles(root);

  // ── Header ──────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText =
    'margin-bottom:12px;border-bottom:2px solid var(--qpm-border);padding-bottom:8px;';

  const headerTitle = document.createElement('div');
  headerTitle.style.cssText =
    'font-size:var(--qpm-font-title);font-weight:var(--qpm-weight-bold);' +
    'color:var(--qpm-text);margin-bottom:4px;';
  headerTitle.textContent = `📔 ${t('feature.journal.title')}`;

  const headerSub = document.createElement('div');
  headerSub.style.cssText = 'font-size:var(--qpm-font-body);color:var(--qpm-text-muted);';
  headerSub.textContent = t('feature.journal.subtitle');

  header.appendChild(headerTitle);
  header.appendChild(headerSub);
  root.appendChild(header);

  // ── Stats ───────────────────────────────────────────────────────────────
  const statsGrid = document.createElement('div');
  statsGrid.style.cssText =
    'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px;';

  const produceStatBox = createStatBox('🌾', t('feature.journal.produce'), '...', COLOR_PRODUCE, '#1e2a1e, #1a1a1a');
  const petStatBox = createStatBox('🐾', t('feature.journal.petVariants'), '...', COLOR_PETS, '#1a212a, #1a1a1a');
  const overallStatBox = createStatBox('✨', t('feature.journal.overall'), '...', COLOR_TIPS, '#241a2a, #1a1a1a');

  statsGrid.appendChild(produceStatBox);
  statsGrid.appendChild(petStatBox);
  statsGrid.appendChild(overallStatBox);
  root.appendChild(statsGrid);

  // ── Tab bar ─────────────────────────────────────────────────────────────
  const tabBar = createTabBar(
    [
      { id: 'produce', label: `🌾 ${t('feature.journal.produce')}` },
      { id: 'pets', label: `🐾 ${t('feature.journal.pets')}` },
      { id: 'recommendations', label: `💡 ${t('feature.journal.smartTips')}` },
    ],
    {
      persistKey: 'qpm.journal.tab',
      onChange: () => updateDisplay(),
    },
  );
  tabBar.root.style.marginBottom = '8px';
  root.appendChild(tabBar.root);

  // ── Missing-only filter ─────────────────────────────────────────────────
  let showMissingOnly = false;
  const missingToggle = createToggle({
    label: `📋 ${t('feature.journal.missing')}`,
    size: 'compact',
    checked: false,
    onChange: (checked) => {
      showMissingOnly = checked;
      updateDisplay();
    },
  });
  missingToggle.root.style.marginBottom = '8px';
  root.appendChild(missingToggle.root);

  // ── Tooltip helper toggle ───────────────────────────────────────────────
  const helperCard = document.createElement('div');
  helperCard.style.cssText =
    'margin:0 0 10px;padding:10px 12px;border-radius:var(--qpm-radius-md);' +
    'border:1px solid var(--qpm-border);background:var(--qpm-accent-tint);' +
    'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;';

  const helperText = document.createElement('div');
  const helperTitle = document.createElement('div');
  helperTitle.style.cssText =
    'font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);color:var(--qpm-text);';
  helperTitle.textContent = t('feature.journal.tooltipHelper');
  const helperDesc = document.createElement('div');
  helperDesc.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);';
  helperDesc.textContent = t('feature.journal.tooltipHelperDesc');
  helperText.appendChild(helperTitle);
  helperText.appendChild(helperDesc);
  helperCard.appendChild(helperText);

  const tooltipEnabled = getCropSizeIndicatorConfig().showJournalIndicators !== false;
  const helperToggle = createToggle({
    size: 'compact',
    checked: tooltipEnabled,
    onChange: (checked) => {
      setCropSizeIndicatorConfig({ showJournalIndicators: checked });
    },
  });
  helperCard.appendChild(helperToggle.root);
  root.appendChild(helperCard);

  // ── Results container ───────────────────────────────────────────────────
  const resultsContainer = document.createElement('div');
  resultsContainer.style.cssText =
    'flex:1;min-height:0;max-height:none;overflow-y:auto;padding-right:4px;';
  root.appendChild(resultsContainer);

  // ── Refresh button ──────────────────────────────────────────────────────
  const refreshBtn = createButton(`🔄 ${t('feature.journal.refresh')}`, {
    variant: 'secondary',
    onClick: () => {
      refreshBtn.textContent = t('common.loading');
      refreshBtn.disabled = true;
      import('../../features/journal/checker').then(m => {
        m.refreshJournalCache();
        updateDisplay().then(() => {
          refreshBtn.textContent = `🔄 ${t('feature.journal.refresh')}`;
          refreshBtn.disabled = false;
        });
      });
    },
  });
  refreshBtn.style.width = '100%';
  refreshBtn.style.flexShrink = '0';
  refreshBtn.style.marginTop = '10px';
  root.appendChild(refreshBtn);

  // ── Update display ──────────────────────────────────────────────────────
  const updateDisplay = async (): Promise<void> => {
    if (!getPlantCatalog() || !getMutationCatalog() || !getPetCatalog()) {
      if (catalogRetries < 10) {
        catalogRetries++;
        resultsContainer.innerHTML = '';
        resultsContainer.appendChild(createSpinner(t('feature.journal.loadingData')));
        retryTimeoutId = window.setTimeout(updateDisplay, 1500);
        return;
      }
      resultsContainer.innerHTML = '';
      resultsContainer.appendChild(createEmptyState(t('feature.journal.catalogsNotLoaded')));
      return;
    }
    catalogRetries = 0;

    const [summary, stats] = await Promise.all([
      import('../../features/journal/checker').then(m => m.getJournalSummary()),
      import('../../features/journal/checker').then(m => m.getJournalStats()),
    ]);

    if (!summary || !stats) {
      resultsContainer.innerHTML = '';
      resultsContainer.appendChild(createEmptyState(t('feature.journal.unableToLoad')));
      return;
    }

    updateStat(produceStatBox, `${stats.produce.collected}/${stats.produce.total}`);
    updateStat(petStatBox, `${stats.petVariants.collected}/${stats.petVariants.total}`);
    updateStat(overallStatBox, `${Math.round(stats.overall.percentage)}%`);

    resultsContainer.innerHTML = '';

    const activeTab = tabBar.getActive();
    if (activeTab === 'produce') {
      renderProduceTab(summary.produce, showMissingOnly, resultsContainer);
    } else if (activeTab === 'pets') {
      renderPetsTab(summary.pets, showMissingOnly, resultsContainer);
    } else if (activeTab === 'recommendations') {
      await renderRecommendationsTab(resultsContainer);
    }
  };

  // ── Cleanup handle ──────────────────────────────────────────────────────
  (root as unknown as { __journalCleanup: () => void }).__journalCleanup = () => {
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
  };

  updateDisplay();

  return root;
}
