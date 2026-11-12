import { onActivePetInfos, type ActivePetInfo } from '../../../store/pets';
import { findAbilityHistoryForIdentifiers, onAbilityHistoryUpdate } from '../../../store/abilityLogs';
import { formatCoinsAbbreviated } from '../../../features/economy/valueCalculator';
import { throttle } from '../../../utils/scheduling/scheduling';
import { buildAbilityValuationContext, type AbilityValuationContext } from '../../../features/pets/abilityValuation';
import { onGardenSnapshot } from '../../../features/garden/bridge';
import { getWeatherSnapshot, onWeatherSnapshot } from '../../../store/weatherHub';
import { arePetAbilitiesCaptured, onPetAbilitiesCaptured } from '../../../utils/game/catalogHelpers';
import { visibleInterval } from '../../../utils/scheduling/timerManager';
import { getAbilityRateContext } from '../../../features/pets/data/petAbilities';
import { onDayCycleChange } from '../../../catalogs/logic/dayCycleCatalog';
import { isGameStateReady, subscribe } from '../../../core/gameState';
import { t } from '../../../i18n';
import { getTotals } from './abilities';
import { buildPetCard, getCardPetKey } from './petCard';
import { updateTimerCell } from './timing';

const TICKER_INTERVAL_MS = 1000;

/**
 * Builds ability tracker content inside the given container.
 * Sets up subscriptions for live updates and returns an idempotent cleanup function.
 */
export function renderAbilityTrackerContent(container: HTMLElement): () => void {
  let cleaned = false;
  const cleanups: Array<() => void> = [];

  // -- DOM structure --
  // Summary strip
  const summaryStrip = document.createElement('div');
  summaryStrip.style.cssText = [
    'padding:6px 12px',
    'font-size:12px',
    'color:var(--qpm-text-muted)',
    'border-bottom:1px solid var(--qpm-border)',
    'flex-shrink:0',
  ].join(';');
  summaryStrip.dataset.tour = 'ability-summary';
  const summaryMain = document.createElement('div');
  summaryMain.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  summaryMain.textContent = t('common.loading');
  const summaryDayAverage = document.createElement('div');
  summaryDayAverage.style.cssText = 'font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none;';
  summaryStrip.append(summaryMain, summaryDayAverage);
  container.appendChild(summaryStrip);

  // Scroll container
  const scrollContent = document.createElement('div');
  scrollContent.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';

  const contentWrap = document.createElement('div');
  contentWrap.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:8px;';

  const cardsContainer = document.createElement('div');
  cardsContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  cardsContainer.dataset.tour = 'ability-cards';
  contentWrap.appendChild(cardsContainer);
  scrollContent.appendChild(contentWrap);
  container.appendChild(scrollContent);

  // Footer hint
  const footerHint = document.createElement('div');
  footerHint.textContent = t('feature.abilityTracker.footerHint');
  footerHint.style.cssText = [
    'padding:4px 12px',
    'font-size:10px',
    'color:var(--qpm-text-muted)',
    'text-align:center',
    'border-top:1px solid var(--qpm-border)',
    'flex-shrink:0',
    'user-select:none',
  ].join(';');
  footerHint.dataset.tour = 'ability-hint';
  container.appendChild(footerHint);

  // -- Internal state --
  let latestPets: ActivePetInfo[] = [];
  let timerCells: HTMLElement[] = [];
  let lastRenderSig: string | null = null;

  const buildRenderSignature = (pets: ActivePetInfo[]): string => {
    const rateContext = getAbilityRateContext(null);
    const parts: string[] = [
      String(pets.length),
      getWeatherSnapshot().kind,
      String(arePetAbilitiesCaptured()),
      rateContext.stage ?? '',
      String(rateContext.strengthBonus),
    ];
    for (const pet of pets) {
      const petKey = getCardPetKey(pet);
      const abilities = (pet.abilities ?? []).join(',');
      const strBucket = pet.strength != null ? Math.floor(pet.strength / 5) : 'x';
      let procsSig = '';
      for (const raw of pet.abilities ?? []) {
        if (!raw) continue;
        const h = findAbilityHistoryForIdentifiers(raw, {
          petId: pet.petId,
          slotId: pet.slotId,
          slotIndex: pet.slotIndex,
        });
        procsSig += `${raw}:${h?.lastPerformedAt ?? 0};`;
      }
      parts.push(`${petKey}|${pet.species ?? ''}|${abilities}|${strBucket}|${pet.targetScale ?? ''}|${(pet.mutations ?? []).join(',')}|${procsSig}`);
    }
    return parts.join('\n');
  };

  // -- Render function --
  const render = () => {
    const activePets = latestPets;
    const sig = buildRenderSignature(activePets);
    if (sig === lastRenderSig) return;
    lastRenderSig = sig;

    let gardenCtx: AbilityValuationContext | undefined;
    try { gardenCtx = buildAbilityValuationContext(); } catch { /* not ready yet */ }

    const totals = getTotals(activePets, gardenCtx);
    const summaryParts: string[] = [
      totals.petCount !== 1 ? t('feature.abilityTracker.summaryPets', { count: String(totals.petCount) }) : t('feature.abilityTracker.summaryPet', { count: String(totals.petCount) }),
      totals.abilityCount !== 1 ? t('feature.abilityTracker.summaryAbilities', { count: String(totals.abilityCount) }) : t('feature.abilityTracker.summaryAbility', { count: String(totals.abilityCount) }),
      t('feature.abilityTracker.summaryProcs', { rate: totals.procsPerHour.toFixed(1) }),
    ];
    const coinsText = totals.coinsPerHour > 0 ? formatCoinsAbbreviated(totals.coinsPerHour) : '';
    if (coinsText) {
      summaryParts.push(t('feature.abilityTracker.summaryCoins', { rate: coinsText }));
    }
    summaryMain.textContent = summaryParts.join(' · ');

    const avgProcsText = totals.dayAverageProcsPerHour.toFixed(1);
    const avgCoinsText = totals.dayAverageCoinsPerHour > 0 ? formatCoinsAbbreviated(totals.dayAverageCoinsPerHour) : '';
    const averageDiffers = avgProcsText !== totals.procsPerHour.toFixed(1) || avgCoinsText !== coinsText;
    summaryDayAverage.textContent = !averageDiffers ? '' : avgCoinsText
      ? t('feature.abilityTracker.summaryDayAverage', { procs: avgProcsText, coins: avgCoinsText })
      : t('feature.abilityTracker.summaryDayAverageProcs', { procs: avgProcsText });
    summaryDayAverage.style.display = averageDiffers ? '' : 'none';

    cardsContainer.innerHTML = '';

    if (!activePets.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:24px;text-align:center;color:var(--qpm-text-muted);font-size:12px;';
      empty.textContent = t('feature.abilityTracker.noPets');
      cardsContainer.appendChild(empty);
      return;
    }

    let hasCards = false;
    for (const pet of activePets) {
      const card = buildPetCard(pet, gardenCtx);
      if (card) {
        cardsContainer.appendChild(card);
        hasCards = true;
      }
    }

    if (!hasCards) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:24px;text-align:center;color:var(--qpm-text-muted);font-size:12px;';
      empty.textContent = arePetAbilitiesCaptured() ? t('feature.abilityTracker.noAbilities') : t('common.abilityDataLoading');
      cardsContainer.appendChild(empty);
    }

    timerCells = Array.from(cardsContainer.querySelectorAll<HTMLElement>('[data-timer-cell]'));
  };

  // -- Subscriptions --
  const throttledRender = throttle((pets: ActivePetInfo[]) => {
    latestPets = pets;
    render();
  }, 400);
  const unsubPets = onActivePetInfos(throttledRender);
  cleanups.push(unsubPets);

  const throttledHistoryRender = throttle(() => { render(); }, 400);
  const unsubHistory = onAbilityHistoryUpdate(() => { throttledHistoryRender(); });
  cleanups.push(unsubHistory);
  cleanups.push(onWeatherSnapshot(() => { throttledHistoryRender(); }, false));
  cleanups.push(onPetAbilitiesCaptured(() => { throttledHistoryRender(); }));

  // Parsed cycle parts are not in the signature, so a parse forces a fresh render.
  cleanups.push(onDayCycleChange(() => { lastRenderSig = null; throttledHistoryRender(); }));
  if (isGameStateReady()) cleanups.push(subscribe('dayNightStage', () => { throttledHistoryRender(); }));

  const throttledGardenRender = throttle(() => { render(); }, 2000);
  const unsubGarden = onGardenSnapshot(() => { throttledGardenRender(); });
  cleanups.push(unsubGarden);

  // -- Ticker (1s timer updates) --
  // polling-justified: countdown/"ago" text follows the wall clock between procs; no game event fires while time passes.
  const tickerCleanup = visibleInterval('ability-tracker-tick', () => {
    for (const el of timerCells) {
      updateTimerCell(el);
    }
  }, TICKER_INTERVAL_MS);
  cleanups.push(tickerCleanup);

  // Tour system: check for first-time tour and inject replay button
  import('../../tour').then(({ checkTour, injectReplayButton }) => {
    checkTour('trackers-v2-ability', container);
    injectReplayButton('trackers-v2-ability');
  });

  // -- Idempotent cleanup --
  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  };
}
