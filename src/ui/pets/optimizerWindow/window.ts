import { getOptimizerAnalysis } from '../../../features/pets/optimizer';
import { t } from '../../../i18n';
import { createSpinner } from '../../components';
import { toggleWindow } from '../../core/modalWindow';
import { renderFamilyNav } from './familyNav';
import { renderFilters } from './filters';
import { renderResults } from './results';
import { renderSummary } from './summary';
import {
  clearFiltersCleanup,
  getGlobalState,
  setGlobalState,
} from './windowState';

/** Monotonically increasing sequence to detect stale analysis results. */
let refreshSeq = 0;

function updateFamilyNav(): void {
  const globalState = getGlobalState();
  if (!globalState?.currentAnalysis || !globalState.navContainer) return;
  globalState.navContainer.innerHTML = '';
  const nav = renderFamilyNav(globalState.currentAnalysis, globalState.resultsContainer);
  globalState.navContainer.appendChild(nav);
}

function renderCurrentAnalysis(): void {
  const globalState = getGlobalState();
  if (!globalState?.currentAnalysis) return;
  const savedScroll = globalState.root.scrollTop;
  renderResults(
    globalState.currentAnalysis,
    () => void refreshAnalysis(true),
    () => renderCurrentAnalysis(),
  );
  updateFamilyNav();
  globalState.root.scrollTop = savedScroll;
}

async function refreshAnalysis(forceRefresh = false): Promise<void> {
  const globalState = getGlobalState();
  if (!globalState) return;

  const seq = ++refreshSeq;
  const savedScroll = globalState.root.scrollTop;

  globalState.summaryContainer.innerHTML = '';
  globalState.summaryContainer.appendChild(
    createSpinner(t('feature.petOptimizer.loadingPets'))
  );
  globalState.resultsContainer.innerHTML = '';

  try {
    const progressDiv = document.createElement('div');
    progressDiv.style.cssText = 'color: var(--qpm-text-muted); display: flex; align-items: center; gap: 10px;';
    const label = document.createElement('div');
    label.textContent = t('feature.petOptimizer.analyzingPets');
    const progressEl = document.createElement('div');
    progressEl.style.cssText = 'font-weight: bold; color: var(--qpm-accent, #8f82ff);';
    progressEl.textContent = '0%';
    progressDiv.append(label, progressEl);

    globalState.summaryContainer.innerHTML = '';
    globalState.summaryContainer.appendChild(progressDiv);

    const analysis = await getOptimizerAnalysis(forceRefresh, (percent) => {
      progressEl.textContent = `${percent}%`;
    });

    // A newer refresh was started while this one was running — discard stale results.
    if (seq !== refreshSeq) return;

    if (!analysis || analysis.totalPets === 0) {
      globalState.summaryContainer.innerHTML = '';
      const noPetsDiv = document.createElement('div');
      noPetsDiv.style.cssText = 'color: var(--qpm-warning); padding: 20px; text-align: center;';
      const noPetsTitle = document.createElement('div');
      noPetsTitle.style.cssText = 'font-size: 18px; margin-bottom: 8px;';
      noPetsTitle.textContent = `⚠️ ${t('feature.petOptimizer.noPetsFound')}`;
      const noPetsBody = document.createElement('div');
      noPetsBody.style.cssText = 'font-size: 12px; color: #aaa;';
      noPetsBody.textContent = `${t('feature.petOptimizer.noPetsFoundDesc')} ${t('feature.petOptimizer.noPetsFoundHint')}`;
      noPetsDiv.append(noPetsTitle, noPetsBody);
      globalState.summaryContainer.appendChild(noPetsDiv);
      globalState.resultsContainer.innerHTML = '';
      return;
    }

    globalState.currentAnalysis = analysis;
    renderSummary(analysis);
    renderResults(
      analysis,
      () => void refreshAnalysis(true),
      () => renderCurrentAnalysis(),
    );
    updateFamilyNav();
    // Restore scroll after content is rebuilt. Re-read state in case window
    // was torn down and rebuilt during the async fetch.
    const stateAfter = getGlobalState();
    if (stateAfter) stateAfter.root.scrollTop = savedScroll;
  } catch (error) {
    if (seq !== refreshSeq) return;
    console.error('[Pet Optimizer] Error:', error);
    globalState.summaryContainer.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'color: var(--qpm-danger, #f44336); padding: 20px;';
    const errorTitle = document.createElement('div');
    errorTitle.style.cssText = 'font-size: 18px; margin-bottom: 8px;';
    errorTitle.textContent = `❌ ${t('feature.petOptimizer.analysisFailed')}`;
    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'font-size: 12px; color: #aaa;';
    errorMsg.textContent = error instanceof Error ? error.message : 'Unknown error';
    const errorHint = document.createElement('div');
    errorHint.style.cssText = 'font-size: 12px; color: #666; margin-top: 8px;';
    errorHint.textContent = t('feature.petOptimizer.checkConsole');
    errorDiv.append(errorTitle, errorMsg, errorHint);
    globalState.summaryContainer.appendChild(errorDiv);
  }
}

export function openPetOptimizerWindow(): void {
  toggleWindow(
    'pet-optimizer',
    `🎯 ${t('feature.petOptimizer.title')}`,
    renderPetOptimizerWindow,
    '900px',
    '85vh',
  );
}

export function renderPetOptimizerWindow(body: HTMLElement): void {
  clearFiltersCleanup();
  body.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'qpm-pet-optimizer-root';
  root.style.cssText = `
    color: #fff;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'margin-bottom: 10px;';
  header.innerHTML = `
    <div style="font-size: 18px; font-weight: 700;">
      🎯 ${t('feature.petOptimizer.title')}
    </div>
  `;
  root.appendChild(header);

  const summaryContainer = document.createElement('div');
  summaryContainer.dataset.tour = 'optimizer-summary';
  summaryContainer.style.cssText = `
    background: rgba(0, 0, 0, 0.22);
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 10px;
    border: 1px solid var(--qpm-border, #444);
  `;
  root.appendChild(summaryContainer);

  const filtersContainer = document.createElement('div');
  filtersContainer.dataset.tour = 'optimizer-filters';
  filtersContainer.style.cssText = `
    background: rgba(0, 0, 0, 0.22);
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 12px;
    border: 1px solid var(--qpm-border, #444);
  `;
  root.appendChild(filtersContainer);

  const navContainer = document.createElement('div');
  navContainer.dataset.tour = 'optimizer-nav';
  navContainer.style.cssText = 'margin-bottom:8px;position:sticky;top:0;z-index:10;background:rgba(18,20,26,0.97);padding:4px 0;';
  root.appendChild(navContainer);

  const resultsContainer = document.createElement('div');
  resultsContainer.dataset.tour = 'optimizer-results';
  resultsContainer.style.cssText = 'min-height: 200px;';
  root.appendChild(resultsContainer);

  body.appendChild(root);

  setGlobalState({
    root,
    summaryContainer,
    filtersContainer,
    navContainer,
    resultsContainer,
    currentAnalysis: null,
  });

  renderFilters(
    () => renderCurrentAnalysis(),
    (forceRefresh) => {
      void refreshAnalysis(!!forceRefresh);
    },
  );
  void refreshAnalysis();

}
