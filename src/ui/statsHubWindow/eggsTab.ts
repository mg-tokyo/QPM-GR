// src/ui/statsHubWindow/eggsTab.ts
// Eggs tab — hatch stats (session/lifetime), species cards, egg catalog.

import { storage } from '../../utils/storage';
import { t } from '../../i18n';
import {
  subscribeHatchStats,
  seedLifetimeFromPets,
  type HatchStatsState,
  type HatchEvent,
  type SpeciesCounts,
  type PetSeedInput,
} from '../../store/hatchStatsStore';
import { getAtomByLabel, readAtomValue } from '../../core/jotaiBridge';
import { areCatalogsReady } from '../../catalogs/gameCatalogs';
import { analyzeAllEggs, type EggAnalysis } from '../../features/eggEfficiency';
import { formatCoinsAbbreviated } from '../../features/valueCalculator';
import type { StatsHubFilters } from './types';
import { RAINBOW_GRADIENT, STATS_HUB_FILTERS_KEY } from './constants';
import { petSprite } from './spriteHelpers';
import { rarityBadgeStyle, timeAgo, pillBtnCss, appendEmptyNote, appendSectionHeader } from './styleHelpers';

// ---------------------------------------------------------------------------
// Filter persistence (shared with garden tab)
// ---------------------------------------------------------------------------

function loadStatsHubFilters(): StatsHubFilters {
  return storage.get<StatsHubFilters>(STATS_HUB_FILTERS_KEY, {}) ?? {};
}

function saveStatsHubFilters(patch: Partial<StatsHubFilters>): void {
  const current = loadStatsHubFilters();
  storage.set(STATS_HUB_FILTERS_KEY, { ...current, ...patch });
}

// ---------------------------------------------------------------------------
// Species card
// ---------------------------------------------------------------------------

function buildSpeciesCard(species: string, counts: SpeciesCounts): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:5px',
    'padding:10px 8px',
    'border-radius:10px',
    'border:1px solid rgba(143,130,255,0.14)',
    'background:rgba(255,255,255,0.03)',
    'width:100%',
    'text-align:center',
  ].join(';');

  card.appendChild(petSprite(species, 48));

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--qpm-text);word-break:break-word;';
  nameEl.textContent = species;
  card.appendChild(nameEl);

  const countEl = document.createElement('div');
  countEl.style.cssText = 'font-size:18px;font-weight:700;color:var(--qpm-text);line-height:1;';
  countEl.textContent = String(counts.total);
  card.appendChild(countEl);

  // Gold/rainbow mini-badges
  if (counts.gold > 0 || counts.rainbow > 0) {
    const badges = document.createElement('div');
    badges.style.cssText = 'display:flex;gap:4px;justify-content:center;';
    if (counts.gold > 0) {
      const g = document.createElement('span');
      g.style.cssText = 'background:#ffd600;color:#111;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700;';
      g.textContent = t('feature.statsHub.eggs.gold', { count: String(counts.gold) });
      badges.appendChild(g);
    }
    if (counts.rainbow > 0) {
      const r = document.createElement('span');
      r.style.cssText = `background:${RAINBOW_GRADIENT};color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700;`;
      r.textContent = `${t('feature.statsHub.eggs.rainbow', { count: String(counts.rainbow) })} 🌈`;
      badges.appendChild(r);
    }
    card.appendChild(badges);
  }

  return card;
}

// ---------------------------------------------------------------------------
// Event row (recent hatches)
// ---------------------------------------------------------------------------

function buildEventRow(event: HatchEvent): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:4px 0',
    'border-bottom:1px solid rgba(255,255,255,0.04)',
  ].join(';');

  row.appendChild(petSprite(event.species, 24));

  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'font-size:12px;color:var(--qpm-text);font-weight:600;min-width:60px;';
  nameEl.textContent = event.species;
  row.appendChild(nameEl);

  if (event.rarity !== 'normal') {
    const rarBadge = document.createElement('span');
    rarBadge.style.cssText = rarityBadgeStyle(event.rarity);
    rarBadge.textContent = event.rarity;
    row.appendChild(rarBadge);
  }

  const timeEl = document.createElement('span');
  timeEl.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.35);white-space:nowrap;margin-left:auto;flex-shrink:0;';
  timeEl.textContent = timeAgo(event.timestamp);
  row.appendChild(timeEl);

  return row;
}

// ---------------------------------------------------------------------------
// Egg catalog card
// ---------------------------------------------------------------------------

function buildEggCard(egg: EggAnalysis): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:4px',
    'padding:10px 8px 8px',
    'border-radius:10px',
    'border:1px solid rgba(143,130,255,0.14)',
    'background:rgba(255,255,255,0.03)',
    'text-align:center',
  ].join(';');

  // Egg name
  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--qpm-text);word-break:break-word;line-height:1.3;';
  nameEl.textContent = egg.eggName;
  card.appendChild(nameEl);

  // Top species sprites (up to 3)
  if (egg.speciesBreakdown.length > 0) {
    const sprites = document.createElement('div');
    sprites.style.cssText = 'display:flex;gap:2px;justify-content:center;';
    for (const sp of egg.speciesBreakdown.slice(0, 3)) {
      const wrap = petSprite(sp.species, 28);
      wrap.title = `${sp.species} ${(sp.probability * 100).toFixed(0)}%`;
      sprites.appendChild(wrap);
    }
    if (egg.speciesBreakdown.length > 3) {
      const more = document.createElement('span');
      more.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.35);align-self:center;';
      more.textContent = `+${egg.speciesBreakdown.length - 3}`;
      sprites.appendChild(more);
    }
    card.appendChild(sprites);
  }

  // Compact stats
  const stats = document.createElement('div');
  stats.style.cssText = 'display:flex;flex-direction:column;gap:1px;font-size:10px;color:rgba(224,224,224,0.55);line-height:1.4;';

  if (egg.eggCost > 0) {
    const costEl = document.createElement('div');
    costEl.style.cssText = 'color:#ffd600;font-weight:600;font-size:12px;';
    costEl.textContent = formatCoinsAbbreviated(egg.eggCost);
    stats.appendChild(costEl);
  }

  const hatchEl = document.createElement('div');
  hatchEl.textContent = egg.hatchHours >= 1
    ? t('feature.statsHub.eggs.hatchHours', { time: String(Math.round(egg.hatchHours)) })
    : t('feature.statsHub.eggs.hatchMinutes', { time: String(Math.round(egg.hatchHours * 60)) });
  stats.appendChild(hatchEl);

  if (egg.weightedFeedCost > 0) {
    const feedEl = document.createElement('div');
    feedEl.textContent = t('feature.statsHub.eggs.feed', { cost: formatCoinsAbbreviated(Math.round(egg.weightedFeedCost)) });
    stats.appendChild(feedEl);
  }

  card.appendChild(stats);

  return card;
}

// ---------------------------------------------------------------------------
// Main eggs tab builder
// ---------------------------------------------------------------------------

export function buildEggsTab(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

  // --- Filter bar (same pattern as Garden tab's filter bar) ---
  const filterBar = document.createElement('div');
  filterBar.style.cssText = [
    'display:flex',
    'flex-wrap:wrap',
    'gap:5px',
    'padding:8px 14px',
    'border-bottom:1px solid rgba(143,130,255,0.12)',
    'flex-shrink:0',
    'align-items:center',
  ].join(';');

  const eggsViewSaved = loadStatsHubFilters().eggsView;
  let activeView: 'session' | 'lifetime' = eggsViewSaved === 'lifetime' ? 'lifetime' : 'session';

  const sessionBtn = document.createElement('button');
  sessionBtn.type = 'button';
  sessionBtn.textContent = t('feature.statsHub.eggs.session');
  const lifetimeBtn = document.createElement('button');
  lifetimeBtn.type = 'button';
  lifetimeBtn.textContent = t('feature.statsHub.eggs.lifetime');

  const updateToggle = () => {
    sessionBtn.style.cssText = pillBtnCss(activeView === 'session');
    lifetimeBtn.style.cssText = pillBtnCss(activeView === 'lifetime');
  };
  updateToggle();

  sessionBtn.addEventListener('click', () => { activeView = 'session'; saveStatsHubFilters({ eggsView: 'session' }); updateToggle(); renderAll(); });
  lifetimeBtn.addEventListener('click', () => { activeView = 'lifetime'; saveStatsHubFilters({ eggsView: 'lifetime' }); updateToggle(); renderAll(); });
  filterBar.append(sessionBtn, lifetimeBtn);

  // Separator
  const sep = document.createElement('span');
  sep.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.12);align-self:center;margin:0 2px;flex-shrink:0;';
  filterBar.appendChild(sep);

  // Seed button
  const seedBtn = document.createElement('button');
  seedBtn.type = 'button';
  seedBtn.textContent = `⬆ ${t('feature.statsHub.eggs.seed')}`;
  seedBtn.title = t('feature.statsHub.eggs.seedTooltip');
  seedBtn.style.cssText = pillBtnCss(false);
  seedBtn.addEventListener('click', () => {
    seedBtn.disabled = true;
    seedBtn.textContent = '⏳';
    try {
      const allPets: PetSeedInput[] = [];
      for (const label of ['myPetInventoryAtom', 'myPetHutchPetItemsAtom']) {
        try {
          const atom = getAtomByLabel(label);
          if (atom) {
            const items = readAtomValue<unknown[]>(atom);
            if (Array.isArray(items)) allPets.push(...(items as PetSeedInput[]));
          }
        } catch { /* atom not ready */ }
      }
      const { added } = seedLifetimeFromPets(allPets);
      activeView = 'lifetime';
      updateToggle();
      renderAll();
      seedBtn.textContent = added > 0 ? `+${added}` : '✓';
      setTimeout(() => { seedBtn.disabled = false; seedBtn.textContent = `⬆ ${t('feature.statsHub.eggs.seed')}`; }, 2000);
    } catch {
      seedBtn.disabled = false;
      seedBtn.textContent = `⬆ ${t('feature.statsHub.eggs.seed')}`;
    }
  });
  filterBar.appendChild(seedBtn);

  container.appendChild(filterBar);

  // --- Scrollable content ---
  const content = document.createElement('div');
  content.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:16px;';
  container.appendChild(content);

  let currentStats: HatchStatsState | null = null;

  function renderAll(): void {
    content.innerHTML = '';

    // Section 1: Hatch stats
    renderHatchStats();

    // Section 2: Egg catalog (always, even without hatch data)
    renderEggCatalog();
  }

  function renderHatchStats(): void {
    if (!currentStats) return;

    const bucket = activeView === 'session' ? currentStats.session : currentStats.lifetime;
    if (bucket.totalHatched === 0) {
      appendEmptyNote(content, activeView === 'session' ? t('feature.statsHub.eggs.noHatches') : t('feature.statsHub.eggs.noLifetime'));
      return;
    }

    const goldTotal    = Object.values(bucket.bySpecies).reduce((s, c) => s + c.gold, 0);
    const rainbowTotal = Object.values(bucket.bySpecies).reduce((s, c) => s + c.rainbow, 0);

    // Section header with inline totals
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:baseline;gap:10px;font-size:14px;font-weight:700;color:rgba(224,224,224,0.85);';
    hdr.textContent = t('feature.statsHub.eggs.hatched', { count: String(bucket.totalHatched) });
    if (goldTotal > 0) {
      const g = document.createElement('span');
      g.style.cssText = 'background:#ffd600;color:#111;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;';
      g.textContent = t('feature.statsHub.eggs.gold', { count: String(goldTotal) });
      hdr.appendChild(g);
    }
    if (rainbowTotal > 0) {
      const r = document.createElement('span');
      r.style.cssText = `background:${RAINBOW_GRADIENT};color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;`;
      r.textContent = t('feature.statsHub.eggs.rainbow', { count: String(rainbowTotal) });
      hdr.appendChild(r);
    }
    content.appendChild(hdr);

    // Species grid (same pattern as Garden tab's tile grid)
    const speciesEntries = Object.entries(bucket.bySpecies)
      .filter(([sp]) => sp !== 'Unknown' && sp !== 'unknown')
      .sort((a, b) => b[1].total - a[1].total);

    if (speciesEntries.length > 0) {
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;';
      for (const [sp, counts] of speciesEntries) grid.appendChild(buildSpeciesCard(sp, counts));
      content.appendChild(grid);
    }

    // Recent hatches (compact list, last 20)
    const events = (currentStats.recentEvents ?? []).slice(0, 20);
    if (events.length > 0) {
      appendSectionHeader(content, t('feature.statsHub.eggs.recent'));
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;';
      for (const ev of events) list.appendChild(buildEventRow(ev));
      content.appendChild(list);
    }
  }

  function renderEggCatalog(): void {
    if (!areCatalogsReady()) return;

    const allEggs = analyzeAllEggs();
    if (allEggs.length === 0) return;

    appendSectionHeader(content, t('feature.statsHub.eggs.catalog'));

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;';

    for (const egg of allEggs) {
      grid.appendChild(buildEggCard(egg));
    }
    content.appendChild(grid);
  }

  const unsubscribe = subscribeHatchStats((s) => {
    currentStats = s;
    renderAll();
  });

  // Initial render (catalog may already be ready)
  renderAll();

  return () => {
    unsubscribe();
  };
}
