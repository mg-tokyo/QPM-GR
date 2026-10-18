import type { ErrorCodeDefinition } from '../types';

const V = '3.2.29';

export const CORE_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-ATOM-001',
    subsystem: 'gameState',
    category: 'core',
    severity: 'warn',
    title: 'Missing atom',
    description: 'A registered atom key could not be resolved from the Jotai store.',
    devNotes: 'src/core/gameState/ — fallback applied; feature still works on stale data.',
    sinceVersion: V,
  },
  {
    code: 'QPM-ATOM-002',
    subsystem: 'gameState',
    category: 'core',
    severity: 'warn',
    title: 'Atom transform error',
    description: 'A registered atom resolved but its path/transform threw — fallback applied.',
    devNotes: 'src/core/gameState/ applyTransform — likely a shape change on the game side.',
    sinceVersion: V,
  },
  {
    code: 'QPM-ATOM-003',
    subsystem: 'gameState',
    category: 'core',
    severity: 'warn',
    title: 'Atom / state-tree divergence',
    description: 'A key whose atom rung and state-tree rung both resolved returned different values with an idle prediction queue.',
    devNotes: 'src/core/gameState/divergence.ts — usually a label regex matched the wrong sibling atom, or the game changed a projection. Run QPM_DEBUG_API.atoms.divergence() and compare shapes.',
    sinceVersion: V,
  },
  {
    code: 'QPM-ATOM-004',
    subsystem: 'gameState',
    category: 'core',
    severity: 'info',
    title: 'Key rebound to a lower rung',
    description: 'A registry key fell back from its preferred source to a lower ladder rung.',
    devNotes: 'src/core/gameState/resolver.ts — expected briefly at boot; persistent fallback means the preferred source (usually the state tree) is unavailable. Check QPM_DEBUG_API.atoms.explain(key).',
    sinceVersion: V,
  },
  {
    code: 'QPM-STATETREE-001',
    subsystem: 'stateTree',
    category: 'core',
    severity: 'warn',
    title: 'State not ready',
    description: 'stateTree.select() was called before the state tree finished initializing.',
    devNotes: 'src/core/stateTree.ts — caller ran a selector before initStateTree() resolved. Selectors should be called after main.ts init phase completes, or subscribe() used instead (which queues until ready).',
    sinceVersion: V,
  },
  {
    code: 'QPM-STATETREE-002',
    subsystem: 'stateTree',
    category: 'core',
    severity: 'warn',
    title: 'Selector threw',
    description: 'A state-tree selector function threw during evaluation.',
    devNotes: 'src/core/stateTree.ts — a subscriber\'s selector encountered an unexpected state shape. Subscriber isolated; delivered null. Check the selector for missing optional-chaining or a stale type assumption.',
    sinceVersion: V,
  },
  {
    code: 'QPM-CATALOG-001',
    subsystem: 'catalogs',
    category: 'core',
    severity: 'error',
    title: 'Catalog never arrived',
    description: 'Game catalogs were not captured within the expected window.',
    userAction: 'Refresh the game tab.',
    devNotes: 'src/catalogs/gameCatalogs.ts — Object.* hook missed the capture.',
    sinceVersion: V,
    // §9 — affects every catalog-dependent feature; clear user action; the watchdog only fires
    // after the timeout, so not transient. Default error throttle (10s) is fine — fires once.
    notifyUser: true,
  },
  {
    code: 'QPM-CATALOG-002',
    subsystem: 'catalogs',
    category: 'core',
    severity: 'warn',
    title: 'Partial catalog load',
    description: 'A catalog was captured but is missing some expected entries.',
    userAction: 'Refresh the game tab if features that depend on the missing catalog look incomplete.',
    devNotes: 'src/catalogs/gameCatalogs.ts — enrichment incomplete.',
    sinceVersion: V,
    // §9 — pet/plant/egg gaps break dependent features (journal, calculator, optimizer); user can
    // refresh; the 30s grace timer ensures it is not a transient capture race.
    notifyUser: true,
  },
  {
    code: 'QPM-CATALOG-003',
    subsystem: 'catalogs',
    category: 'core',
    severity: 'warn',
    title: 'Catalog enrichment timed out',
    description: 'A secondary catalog enrichment (ability colors, weather, cosmetics) exhausted its retry budget before completing.',
    devNotes: 'src/catalogs/catalogLoader.ts — startAbilityColorPolling / startWeatherCatalogPolling / startCosmeticCatalogPolling. Fallback data still applied; affected catalog may be partial.',
    sinceVersion: V,
  },
  {
    code: 'QPM-CATALOG-004',
    subsystem: 'catalogs',
    category: 'core',
    severity: 'warn',
    title: 'Catalog loader lifecycle error',
    description: 'A catalogs-ready callback threw, or the Object.* capture hooks failed to install.',
    devNotes: 'src/catalogs/catalogLoader/readyState.ts (callback isolation — the throwing subscriber is the real owner) / hooks.ts installHooks. If hooks failed to install, QPM-CATALOG-001 fires later from the watchdog.',
    sinceVersion: V,
  },
  {
    code: 'QPM-JOTAI-001',
    subsystem: 'jotaiBridge',
    category: 'core',
    severity: 'error',
    title: 'Jotai store unavailable',
    description: 'No Jotai store could be captured through any of the fallback tiers.',
    userAction: 'Refresh the game tab.',
    devNotes: 'src/core/jotaiBridge.ts — polyfill engaged.',
    sinceVersion: V,
    // §9 — all atom-driven features (pets/inventory/shops/weather) broken; user can refresh;
    // not transient (6 tiers already exhausted). reportJotaiCapture dedups via lastReportedMode.
    notifyUser: true,
  },
  {
    code: 'QPM-JOTAI-002',
    subsystem: 'jotaiBridge',
    category: 'core',
    severity: 'info',
    title: 'Jotai capture source recorded',
    description: 'ensureJotaiStore() resolved via one of its tiers (native / aries / shared / fiber / write / cache-read / none). The tier is published as metrics.source on the health bus row.',
    devNotes: 'src/core/jotaiBridge.ts reportJotaiCapture — informational only; surfaces in Diagnostics window via metrics.source rather than the error buffer.',
    sinceVersion: V,
  },
  {
    code: 'QPM-SPRITE-001',
    subsystem: 'spriteV2',
    category: 'core',
    severity: 'error',
    title: 'Sprite system init failed',
    description: 'initSpriteSystem() rejected (PIXI never resolved, hydration produced zero frames, or boot threw).',
    userAction: 'Refresh the game tab.',
    devNotes: 'src/sprite-v2/index.ts start() — see cause for the underlying error.',
    sinceVersion: V,
    // §9 — all sprite rendering broken for this session; user can refresh; init failure is terminal.
    notifyUser: true,
  },
  {
    code: 'QPM-SPRITE-002',
    subsystem: 'spriteV2',
    category: 'core',
    severity: 'warn',
    title: 'Sprite hydration degraded',
    description: 'Sprite atlas hydration completed with missing frames or alias misses.',
    devNotes: 'src/sprite-v2/* — fallback render still active.',
    sinceVersion: V,
  },
  {
    code: 'QPM-SPRITE-003',
    subsystem: 'spriteV2',
    category: 'core',
    severity: 'info',
    title: 'Atlas frame missing',
    description: 'A specific sprite frame could not be resolved; fallback applied.',
    devNotes: 'RETIRED 2026-07-16 (row 6.25) — no emitting path. compat.ts renderAcrossCategories exhausts alias variants silently; frame-miss signal surfaces via SPRITE-002 hydration-coverage metrics + spriteLog compat-render-failed entries. Kept registered for cross-script contract stability (§4.3).',
    sinceVersion: V,
  },
  {
    code: 'QPM-SPRITE-004',
    subsystem: 'spriteV2',
    category: 'core',
    severity: 'warn',
    title: 'Sprite render failed',
    description: 'Texture extract / canvas conversion threw or returned blank. Falls through to other render strategies; deduped by failure signature.',
    devNotes: 'src/sprite-v2/index.ts rememberRenderFailure — GPU extract issues, lost WebGL context, or KTX2 fallback path.',
    sinceVersion: V,
  },
  {
    code: 'QPM-SPRITE-005',
    subsystem: 'spriteV2',
    category: 'core',
    severity: 'error',
    title: 'KTX2 decoder unavailable',
    description: 'Discovery of the game\'s ktx2.worker-*.js / libktx-*.wasm assets on the game origin failed, or the wasm fetch failed. Compressed atlases cannot decode; sprite hydration degrades and QPM-SPRITE-001/002 will surface the user-visible signal.',
    userAction: 'Refresh the game tab.',
    devNotes: 'src/sprite-v2/ktx2/client.ts + src/utils/gameAssetDiscovery.ts (delegates chunk enumeration to catalogs/logic/bundleParser.ts). Game 1152 moved the KTX2 loader into a lazy rolldown chunk; discovery scans every loaded /version/N/assets/*.js and waits once for a late chunk. If it fires again, first check the filenames in DISCOVERY_QUERIES against performance.getEntriesByType("resource"), then whether the referencing chunk loads before the sprite boot.',
    sinceVersion: V,
    // §9 — user-facing signal already emerges via SPRITE-001/002; this row targets the diagnostics
    // panel so a developer can distinguish "game renamed assets" from generic hydration failure.
    notifyUser: false,
  },
  {
    code: 'QPM-SPRITE-006',
    subsystem: 'spriteV2',
    category: 'core',
    severity: 'error',
    title: 'KTX2 worker protocol mismatch',
    description: 'The game\'s KTX2 worker replied with an unexpected message shape or texture format — the game changed its decode pipeline. Compressed atlases fail to decode; SPRITE-001/002 surface the user-visible degradation.',
    devNotes: 'src/sprite-v2/ktx2/client.ts validateTextureOptions. Re-run the discovery/protocol audit in .claude/plans/2026-07-08-ktx2-libktx-port.md against the new ktx2.worker-*.js.',
    sinceVersion: V,
    notifyUser: false,
  },
  // Core: Boot phases (row 6.22). One code covers the try/catch surface across
  // src/main/{init,phases,globalApis}.ts — each catch swallows a non-fatal init
  // failure so the userscript keeps booting; context.what identifies the step so
  // the enumeration lives inside the buffer instead of one code per phase.
  {
    code: 'QPM-INIT-001',
    subsystem: 'init',
    category: 'core',
    severity: 'warn',
    title: 'Boot phase step failed',
    description: 'A non-fatal init/boot step threw and was swallowed to keep the userscript loading. Boot continues with reduced functionality — the specific step named by context.what is unavailable.',
    devNotes: 'src/main/{init,phases,globalApis}.ts — the classic try/catch around a non-critical phase call. context.what enumerates: canvasRuntimeTrap | rivFetchInterceptor | riveEngine | riveControl | customSkins | bloblingPresets | gardenPainterPresets | stateTree | reactiveManager | initLocale | shopRestockAlerts | dawnFeatures | chargedAbilities | weatherPredictions | atomHealthCheck | phase:antiAfk | phase:inventoryStore | phase:hutchStore | phase:seedSiloStore | phase:decorShedStore | phase:petInfoStore | phase:abilityTriggerStore | phase:activityLog | phase:economyTracker | phase:petHatchingTracker | globalApis:exposeActivityLog | inspector:friendShare | inspector:playerShare.',
    sinceVersion: V,
    // §9 — boot-time non-fatal failures fire before the user is doing anything
    // interactive; no clear per-code userAction (refresh helps but many are
    // transient); the aggregate signal surfaces via the titlebar dot once init
    // completes with degraded status.
    notifyUser: false,
  },
  {
    code: 'QPM-INIT-002',
    subsystem: 'init',
    category: 'core',
    severity: 'warn',
    title: 'Duplicate QPM instance',
    description: 'A second QPM userscript is installed on this page; only the first one started.',
    userAction: 'Uninstall or disable one of the two QPM installs (e.g. ALPHA and private).',
    devNotes: 'src/core/instanceGuard.ts — first-wins; the second instance aborts main.ts before hooks and writes __QPM_DUPLICATE__ so the first instance\'s report carries a dup:X marker.',
    sinceVersion: '3.3.43',
    notifyUser: true,
  },
  // Core: Timer manager (row 6.23). The RAF tick loop catches per-callback throws
  // so one broken timer never breaks the loop; that catch previously logged via
  // raw console.error, now routed through the named logger for buffer + bus
  // attribution. Per-tick recovery expected on the next interval.
  {
    code: 'QPM-TIMER-001',
    subsystem: 'timerManager',
    category: 'core',
    severity: 'warn',
    title: 'Timer callback threw',
    description: 'A registered timer callback threw inside the RAF tick loop. The timer stays registered and will fire again next interval; the loop keeps ticking for other timers. context.id names the failing timer.',
    devNotes: 'src/utils/scheduling/timerManager.ts tick() — the try/catch keeps the RAF loop alive after per-timer failures.',
    sinceVersion: V,
    notifyUser: false,
  },
  // Core: Rive engine (row 6.25). Low-level runtime that features (textureSwapper,
  // bloblingCustomiser previews) sit on top of. One code covers the sole real
  // failure surface — the async runtime-capture chain that resolves the
  // low-level Rive runtime (@rive-app/canvas-advanced) via lowLevelRiveAtom or
  // the canvas trap. If capture never resolves, every downstream override
  // (image/input/text/speed/file/asset) silently no-ops.
  {
    code: 'QPM-RIVE-001',
    subsystem: 'riveEngine',
    category: 'core',
    severity: 'warn',
    title: 'Rive runtime capture failed',
    description: 'captureRiveRuntime() rejected — the low-level Rive runtime (@rive-app/canvas-advanced) could not be resolved via lowLevelRiveAtom or the canvas trap. Rive overrides silently no-op until reload.',
    devNotes: 'src/rive-engine/index.ts initRiveEngine() — the void captureRiveRuntime().catch. context.what identifies the step (runtimeCapture).',
    sinceVersion: V,
    // §9 — user-visible signal already surfaces via BLOBLING-003 (avatar preview
    // blank) and TEXTURESWAP-001 (rule refresh no-ops); this row targets the
    // Diagnostics panel so a developer can distinguish "runtime never captured"
    // from "override chain broke downstream".
    notifyUser: false,
  },
  {
    code: 'QPM-BUNDLE-001',
    subsystem: 'bundle',
    category: 'core',
    severity: 'info',
    title: 'Bundle info published',
    description: 'Startup publish of build artefact metadata (version, iifeBytes, builtAt) to the health bus for size-regression visibility in the Diagnostics window.',
    devNotes: 'src/diagnostics/bundleInfo.ts reads window.__QPM_BUNDLE_INFO__ (burned in by scripts/build-userscript.js before USERSCRIPT_FOOTER). Metric-only; never fires a log call.',
    sinceVersion: V,
  },
  {
    code: 'QPM-AUDIO-001',
    subsystem: 'audio',
    category: 'core',
    severity: 'warn',
    title: 'Unknown SFX name',
    description: 'playSfx() / startLoop() was called with a name that is not present in the game\'s live SFX atlas or the fallback URL index. The call is a silent no-op.',
    devNotes: 'src/audio/player.ts warnUnknown() — deduped per name. Compare against __QPM_AUDIO__.list() to find the correct name.',
    sinceVersion: V,
    notifyUser: false,
  },
];
