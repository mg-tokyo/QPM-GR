import { isVerboseLogsEnabled, setVerboseLogsEnabled } from '../../utils/logger';
import { isSpriteLogsEnabled, printSpriteLogDump, setSpriteLogsEnabled } from '../../sprite-v2/diagnostics';
import {
  spriteExtractor,
  renderSpriteGridOverlay,
  renderAllSpriteSheetsOverlay,
  listTrackedSpriteResources,
  loadTrackedSpriteSheets,
} from '../../sprite-v2/compat';
import { getSpriteBootReport, spriteProbe } from '../../sprite-v2/index';

export const spriteDebugApi = {
  spriteLogs: (enabled?: boolean) => {
    if (typeof enabled === 'boolean') {
      setSpriteLogsEnabled(enabled);
      setVerboseLogsEnabled(enabled);
    }
    return {
      spriteLogs: isSpriteLogsEnabled(),
      verboseLogs: isVerboseLogsEnabled(),
    };
  },
  spriteLogDump: (limit?: number) => printSpriteLogDump(limit),

  showPetSpriteGrid: (sheet = 'pets', maxTiles = 80) => renderSpriteGridOverlay(sheet, maxTiles),
  showAllSpriteSheets: (maxTilesPerSheet = 120) => renderAllSpriteSheetsOverlay(maxTilesPerSheet),
  listSpriteResources: (category: 'plants' | 'pets' | 'unknown' | 'all' = 'all') => listTrackedSpriteResources(category),
  loadTrackedSpriteSheets: (maxSheets = 8, category: 'plants' | 'pets' | 'unknown' | 'all' = 'all') => loadTrackedSpriteSheets(maxSheets, category),
  spriteBootReport: () => getSpriteBootReport(),
  spriteProbe: (keys?: Array<string | { key?: string; category?: string; id?: string; mutations?: string[] }>) => {
    const rows = spriteProbe(keys as any);
    console.table(rows.map((r) => ({
      input: r.input,
      ok: r.ok ? 'yes' : 'no',
      category: r.category,
      id: r.id,
      mutations: r.mutations.join(','),
      width: r.width,
      height: r.height,
      error: r.error ?? '',
    })));
    return rows;
  },

  // Expose sprite extractor for debugging
  spriteExtractor: spriteExtractor,

  // Debug function to view all sprite tiles
  viewAllSprites: () => {
    console.log('=== Exporting all sprite tiles ===');
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      top: 50px;
      right: 50px;
      background: rgba(0,0,0,0.9);
      padding: 20px;
      max-width: 800px;
      max-height: 80vh;
      overflow: auto;
      z-index: 999999;
      display: grid;
      grid-template-columns: repeat(10, 1fr);
      gap: 5px;
    `;

    for (let i = 0; i < 60; i++) {
      const tile = spriteExtractor.getTile('plants', i);
      if (tile) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position: relative; text-align: center;';

        const label = document.createElement('div');
        label.textContent = `${i}`;
        label.style.cssText = 'font-size: 10px; color: #fff; background: rgba(0,0,0,0.7); padding: 2px;';

        const img = new Image();
        img.src = tile.toDataURL();
        img.style.cssText = 'width: 64px; height: 64px; image-rendering: pixelated; border: 1px solid #444;';
        img.title = `Tile ${i}`;

        wrapper.appendChild(label);
        wrapper.appendChild(img);
        container.appendChild(wrapper);
      }
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'position: sticky; top: 0; left: 0; z-index: 1; grid-column: 1 / -1;';
    closeBtn.onclick = () => container.remove();
    container.insertBefore(closeBtn, container.firstChild);

    document.body.appendChild(container);
    console.log('Sprite viewer opened. Click tiles to see index.');
  },
};
