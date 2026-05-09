import type { PlayerView } from '../../types/publicRooms';
import { storage } from '../../utils/storage';
import {
  safeArray,
  friendlyName,
  formatDuration,
  formatLargeNumber,
  setPaneContent,
} from './helpers';
import {
  getEggSpriteUrl,
  getMutatedCropSpriteUrl,
} from './spriteHelpers';
import { t } from '../../i18n';

export function renderGardenPane(view: PlayerView, _isFriend: boolean, _privacy: PlayerView['privacy']): void {
  const garden = (view as any).garden || (view as any).state?.garden;
  const stats = (view as any).stats || (view as any).state?.stats;

  type GridTile = { tileId: number; species: string | null; mutations: unknown[]; isMultiHarvest: boolean; slots: Record<string, unknown>[]; exists: boolean; objectType?: string | undefined; eggId?: string | undefined; maturedAt?: number | undefined; plantedAt?: number | undefined };
  const leftPlot: GridTile[][] = [];
  const rightPlot: GridTile[][] = [];

  for (let row = 0; row < 10; row++) {
    leftPlot[row] = [];
    rightPlot[row] = [];
    for (let col = 0; col < 10; col++) {
      leftPlot[row]![col] = { tileId: -1, species: null, mutations: [], isMultiHarvest: false, slots: [], exists: false };
      rightPlot[row]![col] = { tileId: -1, species: null, mutations: [], isMultiHarvest: false, slots: [], exists: false };
    }
  }

  const gardenObj = garden as Record<string, unknown> | null;
  const tileObjects = gardenObj?.tileObjects && typeof gardenObj.tileObjects === 'object' ? gardenObj.tileObjects as Record<string, unknown> : null;
  if (tileObjects) {
    Object.entries(tileObjects).forEach(([tileIdStr, payload]) => {
      const tileId = parseInt(tileIdStr, 10);
      const tilePayload = payload as Record<string, unknown>;
      const objectType = tilePayload?.objectType;

      if (objectType === 'egg') {
        const tile: GridTile = {
          tileId,
          species: null,
          mutations: [],
          isMultiHarvest: false,
          slots: [],
          exists: true,
          objectType: 'egg',
          eggId: tilePayload.eggId as string | undefined,
          maturedAt: tilePayload.maturedAt as number | undefined,
          plantedAt: tilePayload.plantedAt as number | undefined,
        };

        const row = Math.floor(tileId / 20);
        const col = tileId % 20;

        if (row >= 0 && row < 10) {
          if (col >= 0 && col < 10 && leftPlot[row]) {
            leftPlot[row]![col] = tile;
          } else if (col >= 10 && col < 20 && rightPlot[row]) {
            rightPlot[row]![col - 10] = tile;
          }
        }
        return;
      }

      const slotArr = safeArray(tilePayload?.slots) as Record<string, unknown>[];
      const primarySlot = slotArr[0];
      const species = (primarySlot?.species ?? primarySlot?.plant ?? null) as string | null;
      const tile: GridTile = {
        tileId,
        species,
        mutations: safeArray(primarySlot?.mutations),
        isMultiHarvest: slotArr.length > 1,
        slots: slotArr,
        exists: true,
      };

      const TILES_PER_ROW = 20;
      const row = Math.floor(tileId / TILES_PER_ROW);
      const col = tileId % TILES_PER_ROW;

      if (row >= 0 && row < 10) {
        if (col >= 0 && col < 10 && leftPlot[row]) {
          leftPlot[row]![col] = tile;
        } else if (col >= 10 && col < 20 && rightPlot[row]) {
          rightPlot[row]![col - 10] = tile;
        }
      }
    });
  }

  const renderPlot = (plot: GridTile[][]): string => {
    return plot.map(row => row.map(tile => {
      if (!tile.exists) {
        return `<div class="pr-garden-tile pr-garden-tile-empty" title="${t('feature.publicRooms.emptyTile')}"></div>`;
      }

      const isEgg = tile.objectType === 'egg';
      if (isEgg && tile.eggId) {
        const eggSprite = getEggSpriteUrl(tile.eggId);
        const eggName = friendlyName(tile.eggId);
        const maturedAt = tile.maturedAt ? new Date(tile.maturedAt).toLocaleString() : t('feature.publicRooms.unknown');
        const plantedAt = tile.plantedAt ? new Date(tile.plantedAt).toLocaleString() : t('feature.publicRooms.unknown');
        const timeLeft = tile.maturedAt ? formatDuration(Math.max(0, tile.maturedAt - Date.now())) : t('feature.publicRooms.na');
        const tooltipText = `${t('feature.publicRooms.tileLabel', { id: String(tile.tileId), name: eggName })}\n${t('feature.publicRooms.plantedAt', { time: plantedAt })}\n${t('feature.publicRooms.maturedAt', { time: maturedAt })}\n${t('feature.publicRooms.timeLeft', { time: timeLeft })}`;
        return `
          <div class="pr-garden-tile pr-garden-tile-egg" title="${tooltipText.replace(/\n/g, '&#10;')}">
            ${eggSprite ? `<img src="${eggSprite}" alt="${eggName}" class="pr-garden-sprite" />` : '<div class="pr-garden-placeholder">🥚</div>'}
          </div>
        `;
      }

      if (!tile.species) {
        return `<div class="pr-garden-tile pr-garden-tile-empty" title="${t('feature.publicRooms.tileEmpty', { id: String(tile.tileId) })}"></div>`;
      }

      const sprite = getMutatedCropSpriteUrl(String(tile.species).toLowerCase(), tile.mutations);
      const mutNames = tile.mutations.length > 0 ? tile.mutations.map(m => friendlyName(String(m))).join(', ') : t('feature.publicRooms.mutationsNone');
      const multiIcon = tile.isMultiHarvest ? `<span class="pr-multi-icon" title="${t('feature.publicRooms.multiHarvestTooltip', { count: String(tile.slots.length) })}">×${tile.slots.length}</span>` : '';
      const primarySlot = tile.slots[0] || {};
      const startTime = primarySlot.startTime ? new Date(primarySlot.startTime as number).toLocaleString() : t('feature.publicRooms.unknown');
      const endTime = primarySlot.endTime ? new Date(primarySlot.endTime as number).toLocaleString() : t('feature.publicRooms.unknown');
      const timeLeft = primarySlot.endTime ? formatDuration(Math.max(0, (primarySlot.endTime as number) - Date.now())) : t('feature.publicRooms.na');
      const tooltipText = `${t('feature.publicRooms.tileLabel', { id: String(tile.tileId), name: friendlyName(tile.species) })}\n${t('feature.publicRooms.mutationsLabel', { names: mutNames })}\n${tile.isMultiHarvest ? `${t('feature.publicRooms.multiHarvestLine', { count: String(tile.slots.length) })}\n` : ''}${t('feature.publicRooms.startedAt', { time: startTime })}\n${t('feature.publicRooms.readyAt', { time: endTime })}\n${t('feature.publicRooms.timeLeft', { time: timeLeft })}`;
      return `
        <div class="pr-garden-tile" title="${tooltipText.replace(/\n/g, '&#10;')}">
          ${sprite ? `<img src="${sprite}" alt="${tile.species}" class="pr-garden-sprite" />` : '<div class="pr-garden-placeholder">🌱</div>'}
          ${multiIcon}
        </div>
      `;
    }).join('')).join('');
  };

  const leftHtml = renderPlot(leftPlot);
  const rightHtml = renderPlot(rightPlot);

  const gardenHtml = `
    <div class="pr-garden-plots">
      <div class="pr-garden-plot">
        <div class="pr-garden-plot-label">${t('feature.publicRooms.leftPlot')}</div>
        <div class="pr-garden-grid pr-garden-grid-10x10">${leftHtml}</div>
      </div>
      <div class="pr-garden-plot">
        <div class="pr-garden-plot-label">${t('feature.publicRooms.rightPlot')}</div>
        <div class="pr-garden-grid pr-garden-grid-10x10">${rightHtml}</div>
      </div>
    </div>
  `;

  const playerStats = stats ? ((stats as any).player || (stats as any).Player || stats) as Record<string, unknown> : null;
  const statsKeys = playerStats ? Object.keys(playerStats) : [];
  const statsRows = playerStats ? statsKeys.slice(0, 24).map(key => {
    let label = key;
    label = label.replace(/^num/i, '').replace(/^total/i, '').replace(/^seconds/i, 'Seconds');
    label = label.replace(/([A-Z])/g, ' $1').trim();
    label = label + ':';

    const valRaw = playerStats[key];
    const val = typeof valRaw === 'object' ? JSON.stringify(valRaw) : (typeof valRaw === 'number' ? formatLargeNumber(valRaw, 1) : valRaw);

    return `<div class="pr-stat-row"><span class="pr-stat-label">${label}</span><span class="pr-stat-value">${val ?? '—'}</span></div>`;
  }).join('') : '';

  const countTiles = (plot: GridTile[][]) => {
    let active = 0;
    let total = 0;
    plot.forEach(row => row.forEach(tile => {
      if (tile.exists) {
        total++;
        if (tile.species) active++;
      }
    }));
    return { active, total };
  };
  const leftStats = countTiles(leftPlot);
  const rightStats = countTiles(rightPlot);
  const activePlots = leftStats.active + rightStats.active;
  const totalTiles = leftStats.total + rightStats.total;

  // Journal progress
  const journal = (view as any).state?.journal as Record<string, unknown> | undefined;
  let journalHtml = '';
  if (journal) {
    const petsJournal = (journal.pets || {}) as Record<string, Record<string, unknown>>;
    const produceJournal = (journal.produce || {}) as Record<string, Record<string, unknown>>;

    let petsDiscovered = 0;
    Object.keys(petsJournal).forEach(species => {
      const entry = petsJournal[species];
      if (entry && ((entry.variantsLogged as unknown[])?.length > 0 || (entry.abilitiesLogged as unknown[])?.length > 0)) {
        petsDiscovered++;
      }
    });

    let produceVariantsDiscovered = 0;
    Object.keys(produceJournal).forEach(species => {
      const entry = produceJournal[species];
      if (entry && (entry.variantsLogged as unknown[])?.length > 0) {
        produceVariantsDiscovered += (entry.variantsLogged as unknown[]).length;
      }
    });

    const totalPets = 60;
    const totalProduceVariants = 385;
    const petsPct = Math.min(100, (petsDiscovered / totalPets) * 100);
    const producePct = Math.min(100, (produceVariantsDiscovered / totalProduceVariants) * 100);

    const isJournalExpanded = storage.get<boolean>('player-inspector:journal-expanded', false);

    const cropRows = Object.entries(produceJournal)
      .filter(([_, entry]) => entry && (entry.variantsLogged as unknown[])?.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([species, entry]) => {
        const variantsLogged = (entry.variantsLogged as unknown[])?.length || 0;
        const totalVariants = 11;
        const pct = Math.min(100, (variantsLogged / totalVariants) * 100);
        const isComplete = variantsLogged === 11;

        const mutations = isComplete ? ['Rainbow'] : [];
        const cropSprite = getMutatedCropSpriteUrl(String(species).toLowerCase(), mutations);
        const spriteHtml = cropSprite
          ? `<img src="${cropSprite}" alt="${species}" style="width:28px;height:28px;image-rendering:pixelated;border-radius:4px;border:1px solid rgba(168,139,250,0.3);margin-right:10px;" />`
          : '';

        const rainbowNameText = isComplete ? 'background: linear-gradient(90deg, #e11d48, #f97316, #eab308, #22c55e, #3b82f6, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-weight: 700;' : '';
        const rainbowVariantText = isComplete ? 'background: linear-gradient(90deg, #dc2626, #ea580c, #facc15, #16a34a, #2563eb, #9333ea); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-weight: 700;' : '';

        return `
          <div class="pr-journal-detail-row">
            ${spriteHtml}
            <span class="pr-journal-species" style="${rainbowNameText}">${friendlyName(species)}</span>
            <span class="pr-journal-variants" style="${rainbowVariantText}">${variantsLogged}/11</span>
            <div class="pr-progress-bar-mini">
              <div class="pr-progress-fill-mini" style="width:${pct}%;background:${pct === 100 ? 'linear-gradient(90deg, #f43f5e, #fb923c, #fde047, #4ade80, #60a5fa, #c084fc)' : 'linear-gradient(90deg, #4CAF50, #2E7D32)'}"></div>
            </div>
          </div>
        `;
      }).join('') || `<div class="pr-pane-placeholder">${t('feature.publicRooms.noCropsLogged')}</div>`;

    journalHtml = `
      <div class="pr-section pr-section-animated" data-expandable-section="journal">
        <div class="pr-section-head" data-qpm-journal-toggle style="cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: space-between;">
          <span>📖 ${t('feature.publicRooms.journalProgress')}</span>
          <span class="pr-expand-arrow" style="font-size: 12px; transition: transform 0.2s;">${isJournalExpanded ? '▼' : '▶'}</span>
        </div>
        <div class="pr-journal-container" style="display: ${isJournalExpanded ? 'block' : 'none'};">
          <div class="pr-journal-progress">
            <div class="pr-journal-item">
              <div class="pr-journal-header">
                <span>🐾 ${t('feature.publicRooms.petsDiscovered')}</span>
                <span class="pr-journal-count">${petsDiscovered} / ${totalPets}</span>
              </div>
              <div class="pr-progress-bar">
                <div class="pr-progress-fill pr-progress-animated" style="width:${petsPct}%;background:${petsPct === 100 ? 'linear-gradient(90deg, #FF1744, #FF9100, #FFEA00, #00E676, #2979FF, #D500F9)' : 'linear-gradient(90deg, #FF7043, #FF5722)'};${petsPct === 100 ? 'animation: qpm-rainbow-progress 3s linear infinite; background-size: 200% 100%;' : ''}"></div>
              </div>
              <div class="pr-progress-pct">${petsPct.toFixed(1)}%</div>
            </div>
            <div class="pr-journal-item">
              <div class="pr-journal-header">
                <span>🌿 ${t('feature.publicRooms.cropVariantsDiscovered')}</span>
                <span class="pr-journal-count">${produceVariantsDiscovered} / ${totalProduceVariants}</span>
              </div>
              <div class="pr-progress-bar">
                <div class="pr-progress-fill pr-progress-animated" style="width:${producePct}%;background:${producePct === 100 ? 'linear-gradient(90deg, #FF1744, #FF9100, #FFEA00, #00E676, #2979FF, #D500F9)' : 'linear-gradient(90deg, #2E7D32, #4CAF50)'};${producePct === 100 ? 'animation: qpm-rainbow-progress 3s linear infinite; background-size: 200% 100%;' : ''}"></div>
              </div>
              <div class="pr-progress-pct">${producePct.toFixed(1)}%</div>
            </div>
          </div>

          <div class="pr-journal-details" style="margin-top: 16px;">
            <div class="pr-journal-tab-content" style="display: block;">
              ${cropRows}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setPaneContent('pr-pets-content', `
    <div class="pr-section">
      <div class="pr-section-head">${t('feature.publicRooms.virtualGarden', { active: String(activePlots), total: String(totalTiles) })}</div>
      <div class="pr-garden-grid">${gardenHtml || `<div class="pr-pane-placeholder">${t('feature.publicRooms.noGardenData')}</div>`}</div>
    </div>
    ${journalHtml}
    ${`<div class="pr-section">
      <div class="pr-section-head">📊 ${t('feature.publicRooms.playerStats')}</div>
      ${playerStats ? `<div class="pr-stats-grid">${statsRows}</div>` : `<div class="pr-pane-placeholder">${t('feature.publicRooms.noStatsShared')}</div>`}
    </div>`}
  `);

  // Attach journal toggle listener
  const journalToggle = document.querySelector<HTMLElement>('[data-qpm-journal-toggle]');
  if (journalToggle) {
    journalToggle.addEventListener('click', () => {
      const section = journalToggle.closest('[data-expandable-section]');
      if (!section) return;
      const content = section.querySelector<HTMLElement>('.pr-journal-container');
      const arrow = journalToggle.querySelector<HTMLElement>('.pr-expand-arrow');
      if (!content) return;
      const expanded = content.style.display !== 'none';
      content.style.display = expanded ? 'none' : 'block';
      if (arrow) arrow.textContent = expanded ? '▶' : '▼';
      storage.set('player-inspector:journal-expanded', !expanded);
    });
  }
}
