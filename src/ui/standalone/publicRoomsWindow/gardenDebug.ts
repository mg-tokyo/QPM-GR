import { getState } from '../../../features/standalone/publicRooms';
import { getPlayerView, resetFriendsCache } from '../../../services/ariesPlayers';
import { storage } from '../../../utils/storage';
import { inspectorState } from './state';
import { inferSelfPlayerId } from './helpers';

export const setupGardenInspector = () => {
  const QPM_INSPECT_GARDEN = async () => {
    console.log('[QPM Garden Inspector] Starting...');

    try {
      const state = getState();
      console.log('[QPM] Public Rooms state:', state);

      const selfId = inferSelfPlayerId();
      console.log('[QPM] Your Player ID:', selfId || 'Not found');

      if (inspectorState.targetPlayerId) {
        console.log('[QPM] Currently inspecting:', inspectorState.targetPlayerName, inspectorState.targetPlayerId);
        const view = await getPlayerView(inspectorState.targetPlayerId);
        const garden = (view as any)?.data?.garden || (view as any)?.garden;
        if (garden && typeof garden === 'object' && 'tileObjects' in garden) {
          analyzeGardenTiles((garden as any).tileObjects, inspectorState.targetPlayerName);
          return;
        }
      }

      if (selfId) {
        console.log('[QPM] Fetching YOUR garden...');
        const view = await getPlayerView(selfId);
        const garden = (view as any)?.data?.garden || (view as any)?.garden;
        if (garden && typeof garden === 'object' && 'tileObjects' in garden) {
          analyzeGardenTiles((garden as any).tileObjects, 'You');
          return;
        }
      }

      console.warn('[QPM] No garden data found. Open the inspector on a player first.');
    } catch (err) {
      console.error('[QPM] Error:', err);
    }
  };

  function analyzeGardenTiles(tiles: unknown, playerName: string) {
    const tilesObj = tiles as any;
    const tileIds = Object.keys(tilesObj).map(k => parseInt(k, 10)).sort((a, b) => a - b);
    console.log(`[QPM] Garden for ${playerName}`);
    console.log('[QPM] Total tiles:', tileIds.length);
    console.log('[QPM] Tile IDs:', tileIds);

    const byRow10: Record<number, number[]> = {};
    tileIds.forEach(id => {
      const row = Math.floor(id / 10);
      if (!byRow10[row]) byRow10[row] = [];
      byRow10[row]!.push(id);
    });

    console.log('[QPM] Tiles grouped by row (÷10):');
    console.table(Object.entries(byRow10).map(([row, ids]) => ({
      Row: row,
      Count: ids.length,
      Range: `${ids[0]}-${ids[ids.length - 1]}`,
      IDs: ids.join(','),
    })));

    console.log('[QPM] Sample tile data (first 3):');
    tileIds.slice(0, 3).forEach(id => {
      console.log(`Tile ${id}:`, tilesObj[id]);
    });
  }

  const QPM_CURRENT_TILE = async () => {
    try {
      const { getAtomByLabel, readAtomValue } = await import('../../../core/jotaiBridge');

      const tileAtom = getAtomByLabel('myCurrentGardenTileAtom');
      const objectAtom = getAtomByLabel('myOwnCurrentGardenObjectAtom');

      if (!tileAtom || !objectAtom) {
        console.warn('[QPM] Tile atoms not found. Make sure you\'re in your garden.');
        return null;
      }

      const tileInfo = await readAtomValue(tileAtom) as Record<string, unknown> | null;
      const tileObject = await readAtomValue(objectAtom) as Record<string, unknown> | null;

      console.log('[QPM] Current Tile Info:');
      console.log('  localTileIndex:', tileInfo?.localTileIndex);
      console.log('  tileType:', tileInfo?.tileType);
      console.log('  objectType:', tileObject?.objectType);
      console.log('  species:', tileObject?.species);
      console.log('\n[QPM] Full tile data:', { tileInfo, tileObject });

      return { tileInfo, tileObject };
    } catch (err) {
      console.error('[QPM] Error:', err);
      return null;
    }
  };

  const QPM_EXPOSE_GARDEN = async () => {
    try {
      const selfId = inferSelfPlayerId();
      const targetId = inspectorState.targetPlayerId || selfId;
      const targetName = inspectorState.targetPlayerName || 'You';

      if (!targetId) {
        console.warn('[QPM] No player selected. Open inspector on a player first.');
        return null;
      }

      console.log(`[QPM] Fetching garden data for ${targetName}...`);
      const res = await getPlayerView(targetId);
      console.log('[QPM] API Response:', res);
      const garden = (res as any)?.data?.garden || (res as any)?.garden;

      if (!garden) {
        console.warn('[QPM] No garden data in response. Response structure:', Object.keys(res || {}));
        if (res?.data) console.warn('[QPM] Response.data keys:', Object.keys(res.data));
        return null;
      }

      const gardenObj = garden as any;
      console.log('[QPM] Garden Data:');
      console.log('  tileObjects:', gardenObj.tileObjects);
      console.log('  boardwalkTileObjects:', gardenObj.boardwalkTileObjects);
      console.log('\n[QPM] Tile IDs in tileObjects:', Object.keys((gardenObj.tileObjects || {}) as object).map((k: string) => parseInt(k, 10)).sort((a: number, b: number) => a - b));
      console.log('[QPM] Tile IDs in boardwalkTileObjects:', Object.keys((gardenObj.boardwalkTileObjects || {}) as object).map((k: string) => parseInt(k, 10)).sort((a: number, b: number) => a - b));

      return garden;
    } catch (err) {
      console.error('[QPM] Error:', err);
      return null;
    }
  };

  return {
    QPM_INSPECT_GARDEN,
    QPM_EXPOSE_GARDEN,
    QPM_CURRENT_TILE
  };
};

// Module-level side effect: register QPM_INSPECT_FRIEND debug command
if (!(window as any).QPM_INSPECT_FRIEND) {
  (window as any).QPM_INSPECT_FRIEND = (playerId: string): void => {
    const pid = (playerId || '').trim();
    if (!pid) {
      console.warn('[QPM Inspector] Provide a playerId string.');
      return;
    }
    try {
      storage.set('quinoa:selfPlayerId', pid);
    } catch (err) {
      console.warn('[QPM Inspector] Unable to persist self playerId', err);
    }
    resetFriendsCache();
    console.log('[QPM Inspector] self playerId set to', pid, 'friend cache cleared.');
  };
}
