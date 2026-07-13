// DIAGNOSTICS — call QPM_GARDEN_DIAG() in the browser console

import { getGardenSnapshot, getMapSnapshot } from '../bridge';
import { getAllPlantSpecies as getCatalogPlantSpecies, getPlantSpecies } from '../../../catalogs/gameCatalogs';
import { pageWindow, isIsolatedContext } from '../../../core/pageContext';
import { SPECIES_TO_VIEW } from './speciesView';
import { getPixiApp, buildTileNodeCache, getOrBuildTileNodeCache } from './pixiStage';
import { getGardenTileData, tileMatchesSpecies } from './tileData';

/** Slot-level species of a tile (rare variants live here, not in tile.species). */
function getSlotSpeciesList(tileData: any): string[] {
  const slots = tileData?.slots;
  if (!Array.isArray(slots)) return [];
  return slots
    .map((slot: any) => slot?.species)
    .filter((s: unknown): s is string => typeof s === 'string');
}
import { getControllerDiagnostics } from './controller';

/**
 * Check whether a PIXI node is still attached to the live scene graph.
 * Walks up the parent chain — if it reaches stage, the node is live.
 */
export function isNodeAttached(node: any, stage: any): boolean {
  let current = node;
  let depth = 0;
  while (current && depth < 50) {
    if (current === stage) return true;
    current = current.parent;
    depth++;
  }
  return false;
}

/**
 * Full diagnostic dump of garden filters pipeline.
 * Reports the state of every dependency so we can see exactly what's broken.
 */
export function diagnoseGardenFilters(): Record<string, unknown> {
  const diag: Record<string, unknown> = {};

  // 1. Environment
  diag.isIsolatedContext = isIsolatedContext;
  diag.pageWindowType = typeof pageWindow;
  diag.pageWindowLocation = (() => {
    try { return (pageWindow as any)?.location?.href ?? 'unknown'; } catch { return 'access-denied'; }
  })();
  diag.sandboxWindowLocation = (() => {
    try { return window.location.href; } catch { return 'access-denied'; }
  })();
  diag.pageWindowSameAsSandbox = pageWindow === window;

  // 2. PIXI capture state
  const captured = (() => {
    try { return (pageWindow as any).__QPM_PIXI_CAPTURED__; } catch { return 'access-error'; }
  })();
  diag.pixiCaptured = captured ? {
    hasApp: !!captured.app,
    hasRenderer: !!captured.renderer,
    version: captured.version,
    appType: captured.app ? typeof captured.app : 'null',
    stageType: captured.app?.stage ? typeof captured.app.stage : 'null',
    stageChildrenCount: captured.app?.stage?.children?.length ?? 'no-stage',
  } : captured === null ? 'null' : captured === undefined ? 'undefined' : String(captured);

  // 3. Sprite bridge
  const bridge = (() => {
    try { return (pageWindow as any).__QPM_SPRITE_BRIDGE__; } catch { return 'access-error'; }
  })();
  diag.spriteBridge = bridge ? {
    exists: true,
    atlasCount: bridge.atlas ? Object.keys(bridge.atlas).length : 0,
    stats: bridge.stats ?? 'missing',
  } : bridge === null ? 'null' : bridge === undefined ? 'undefined' : String(bridge);

  // 4. Hooks injected?
  diag.hooksInjected = (() => {
    try { return !!(pageWindow as any).__QPM_HOOKS_INJECTED__; } catch { return 'access-error'; }
  })();
  diag.pixiHooksActive = (() => {
    try { return !!(pageWindow as any).__QPM_PIXI_HOOKS_ACTIVE__; } catch { return 'access-error'; }
  })();

  // 5. PIXI app from getPixiApp()
  const app = getPixiApp();
  diag.getPixiApp = app ? {
    hasStage: !!app.stage,
    stageChildren: app.stage?.children?.length ?? 'no-stage',
    hasRenderer: !!app.renderer,
  } : 'null';

  // 6. Stage tile traversal + attachment audit
  if (app?.stage) {
    const tileNodes = getOrBuildTileNodeCache(app.stage);
    let attachedCount = 0;
    let detachedCount = 0;
    for (const t of tileNodes) {
      if (isNodeAttached(t.node, app.stage)) { attachedCount++; } else { detachedCount++; }
    }
    diag.tileNodes = {
      count: tileNodes.length,
      attached: attachedCount,
      detached: detachedCount,
      detachedWarning: detachedCount > 0 ? '⚠️ STALE CACHE — detached nodes found' : '✅ all live',
      sample: tileNodes.slice(0, 3).map(t => ({
        label: t.node?.label,
        x: t.x,
        y: t.y,
        childCount: t.node?.children?.length ?? 0,
        firstChildLabel: t.node?.children?.[0]?.label ?? 'none',
        alpha: t.node?.alpha,
        attached: isNodeAttached(t.node, app.stage),
      })),
    };
  } else {
    diag.tileNodes = 'no-app-or-stage';
  }

  // 7. Garden data
  const snapshot = getGardenSnapshot();
  const map = getMapSnapshot();
  diag.gardenSnapshot = snapshot ? {
    tileObjectCount: snapshot.tileObjects ? Object.keys(snapshot.tileObjects).length : 0,
    boardwalkCount: snapshot.boardwalkTileObjects ? Object.keys(snapshot.boardwalkTileObjects).length : 0,
  } : 'null';
  diag.mapSnapshot = map ? {
    cols: map.cols,
    rows: map.rows,
    dirtMappingCount: map.globalTileIdxToDirtTile ? Object.keys(map.globalTileIdxToDirtTile).length : 0,
    boardwalkMappingCount: map.globalTileIdxToBoardwalk ? Object.keys(map.globalTileIdxToBoardwalk).length : 0,
  } : 'null';

  // 8. Config and state
  const controllerDiag = getControllerDiagnostics();
  diag.config = controllerDiag.config;
  diag.pollingActive = controllerDiag.pollingActive;
  diag.statsHubOverride = controllerDiag.statsHubOverride;
  diag.cachedFilterSetsReady = controllerDiag.cachedFilterSetsReady;

  // 9. Check for PIXI globals on page window (alternative capture sources)
  diag.pixiGlobals = (() => {
    try {
      const pw = pageWindow as any;
      return {
        __PIXI_APP__: pw.__PIXI_APP__ ? 'exists' : 'missing',
        PIXI_APP: pw.PIXI_APP ? 'exists' : 'missing',
        app: pw.app?.stage ? 'exists-with-stage' : pw.app ? 'exists-no-stage' : 'missing',
        PIXI: pw.PIXI ? 'exists' : 'missing',
        __PIXI__: pw.__PIXI__ ? 'exists' : 'missing',
        __PIXI_RENDERER__: pw.__PIXI_RENDERER__ ? 'exists' : 'missing',
      };
    } catch { return 'access-error'; }
  })();

  // 10. Species audit — cross-reference static map, catalog, and live PIXI labels
  const catalogKeys = getCatalogPlantSpecies();
  const allKeys = new Set([...Object.keys(SPECIES_TO_VIEW), ...catalogKeys]);
  const livePixiLabels = new Set<string>();
  // Also collect per-label tile details for target species
  const targetSpecies = new Set(['FourLeafClover', 'PurpleDaisy', 'Clover', 'Daisy', 'Snowdrop', 'SnowdropDouble']);
  const targetTileDetails: Array<Record<string, unknown>> = [];
  if (app?.stage) {
    const walkLabels = (node: any, depth: number) => {
      if (!node || depth > 10) return;
      if (node.label && /^Tile \(\d+, \d+\)$/.test(node.label)) {
        const cl = node.children?.[0]?.label;
        if (cl && cl !== 'Sprite') {
          livePixiLabels.add(cl);
          // Collect detailed info for target species tiles
          const match = node.label.match(/^Tile \((\d+), (\d+)\)$/);
          if (match) {
            const x = parseInt(match[1]!);
            const y = parseInt(match[2]!);
            const tileData = getGardenTileData(x, y);
            const isTarget = tileData && tileMatchesSpecies(tileData, targetSpecies);
            // Also check if the label matches any target species' expected label
            const isTargetByLabel = [...targetSpecies].some(s => {
              const expected = SPECIES_TO_VIEW[s];
              return expected && cl === expected;
            });
            if (isTarget || isTargetByLabel) {
              targetTileDetails.push({
                pixiLabel: node.label,
                childLabel: cl,
                tileAlpha: node.alpha,
                childAlpha: node.children?.[0]?.alpha,
                tileDataSpecies: tileData?.species ?? 'no-tile-data',
                slotSpecies: getSlotSpeciesList(tileData),
                tileDataObjectType: tileData?.objectType ?? 'unknown',
                attached: isNodeAttached(node, app.stage),
                hasParent: !!node.parent,
                parentLabel: node.parent?.label ?? 'none',
              });
            }
          }
        }
        return;
      }
      if (node.children) {
        for (const c of node.children) walkLabels(c, depth + 1);
      }
    };
    walkLabels(app.stage, 0);
  }
  const speciesAudit: Array<{
    key: string; staticLabel: string | null; catalogPlantName: string | null;
    catalogLabel: string | null; inLivePixi: boolean | string;
  }> = [];
  for (const key of [...allKeys].sort()) {
    const staticLabel = SPECIES_TO_VIEW[key] ?? null;
    const entry = getPlantSpecies(key);
    const plantName = (entry?.plant as any)?.name as string | undefined ?? null;
    const catalogLabel = plantName ? plantName + ' View' : null;
    const expectedLabel = staticLabel ?? catalogLabel;
    speciesAudit.push({
      key,
      staticLabel,
      catalogPlantName: plantName,
      catalogLabel,
      inLivePixi: expectedLabel ? (livePixiLabels.has(expectedLabel) ? '✅' : 'not planted') : 'no label',
    });
  }
  diag.speciesAudit = speciesAudit;
  diag.livePixiLabels = [...livePixiLabels].sort();
  // 10b. Unmatched labels — live PIXI labels not covered by static map or catalog
  const allExpectedLabels = new Set<string>();
  for (const key of allKeys) {
    const sl = SPECIES_TO_VIEW[key]; if (sl) allExpectedLabels.add(sl);
    const entry = getPlantSpecies(key);
    const pn = (entry?.plant as any)?.name as string | undefined;
    if (pn) { allExpectedLabels.add(pn + ' View'); allExpectedLabels.add(pn + ' Plant View'); }
    allExpectedLabels.add(key + ' Plant View');
  }
  allExpectedLabels.add('Egg');
  const unmatchedLabels = [...livePixiLabels].filter(l => !allExpectedLabels.has(l));
  diag.unmatchedPixiLabels = unmatchedLabels.length > 0
    ? { warning: '⚠️ These live labels are not covered by any species mapping', labels: unmatchedLabels }
    : '✅ all live labels matched';

  // 11. Target species deep dive — FourLeafClover, PurpleDaisy, etc.
  diag.targetSpeciesTiles = targetTileDetails.length > 0
    ? targetTileDetails
    : 'none found in garden (not planted or not in viewport)';

  // Pretty-print
  console.group('[QPM] Garden Filters Diagnostics');
  for (const [key, value] of Object.entries(diag)) {
    if (typeof value === 'object' && value !== null) {
      console.log(`${key}:`, value);
    } else {
      console.log(`${key}: ${value}`);
    }
  }
  console.groupEnd();

  return diag;
}

/**
 * Filter test for a specific species — enables the filter, applies once, then reports
 * exactly which tiles matched and which didn't, with full detail on why.
 *
 * Call QPM_GARDEN_TEST('FourLeafClover') in the console.
 */
export function testSpeciesFilter(species: string): Record<string, unknown> {
  const app = getPixiApp();
  if (!app?.stage) return { error: 'No PIXI app/stage' };

  const result: Record<string, unknown> = {};
  result.species = species;
  result.staticLabel = SPECIES_TO_VIEW[species] ?? 'NOT IN STATIC MAP';

  const catalogEntry = getPlantSpecies(species);
  const plantName = (catalogEntry?.plant as any)?.name as string | undefined;
  result.catalogPlantName = plantName ?? 'NOT IN CATALOG';
  result.catalogLabel = plantName ? plantName + ' View' : 'N/A';

  // Build candidate PIXI labels for diagnostic matching
  const candidates = new Set<string>();
  const staticLabel = SPECIES_TO_VIEW[species];
  if (staticLabel) candidates.add(staticLabel);
  if (plantName) {
    candidates.add(plantName + ' View');
    candidates.add(plantName + ' Plant View');
  }
  candidates.add(species + ' Plant View');
  result.allCandidateLabels = [...candidates];

  // Walk tiles and check matches
  const tiles = buildTileNodeCache(app.stage);
  const matches: Array<Record<string, unknown>> = [];
  const nearMisses: Array<Record<string, unknown>> = [];

  for (const { node, x, y } of tiles) {
    const childLabel = node.children?.[0]?.label;
    if (!childLabel || childLabel === 'Sprite') continue;

    const tileData = getGardenTileData(x, y);

    // Check if this tile matches our species via PIXI label
    const pixiMatch = candidates.has(childLabel);
    // Check if this tile matches via tile data — tile-level OR slot-level species
    // (mirrors the actual filter path in applyFiltersToStage)
    const tileDataMatch = tileData ? tileMatchesSpecies(tileData, new Set([species])) : false;

    if (pixiMatch || tileDataMatch) {
      matches.push({
        tile: `(${x}, ${y})`,
        childLabel,
        tileDataSpecies: tileData?.species ?? 'no-data',
        slotSpecies: getSlotSpeciesList(tileData),
        pixiMatch,
        tileDataMatch,
        currentAlpha: node.alpha,
        childAlpha: node.children?.[0]?.alpha,
        attached: isNodeAttached(node, app.stage),
      });
    }

    // Near-miss: tile data species contains our species name (case-insensitive partial)
    if (!pixiMatch && !tileDataMatch && tileData?.species) {
      const s = String(tileData.species).toLowerCase();
      const target = species.toLowerCase();
      if (s.includes(target) || target.includes(s)) {
        nearMisses.push({
          tile: `(${x}, ${y})`,
          childLabel,
          tileDataSpecies: tileData.species,
          note: 'partial match — possible naming mismatch',
        });
      }
    }
  }

  result.totalTiles = tiles.length;
  result.matchCount = matches.length;
  result.matches = matches;
  result.nearMisses = nearMisses.length > 0 ? nearMisses : 'none';

  // Pretty-print
  console.group(`[QPM] Species Filter Test: ${species}`);
  console.log('Candidate PIXI labels:', [...candidates]);
  console.log(`Found ${matches.length} matching tiles out of ${tiles.length} total`);
  if (matches.length > 0) console.table(matches);
  if (nearMisses.length > 0) { console.warn('Near misses (possible naming mismatch):'); console.table(nearMisses); }
  console.groupEnd();

  return result;
}
