// src/diagnostics/codes.ts — Error code registry (§4.2)
//
// Add codes here as subsystems migrate. A code, once shipped, NEVER changes
// meaning (§4.3). If the failure mode shifts, retire the old code and add a
// new one.

import type { ErrorCode, ErrorCodeDefinition } from './types';

const CURRENT_VERSION = '3.2.29';

const REGISTRY: Record<ErrorCode, ErrorCodeDefinition> = Object.create(null);

function register(def: ErrorCodeDefinition): void {
  REGISTRY[def.code] = def;
}

export function lookupCode(code: ErrorCode): ErrorCodeDefinition | undefined {
  return REGISTRY[code];
}

export function listCodes(): readonly ErrorCodeDefinition[] {
  return Object.values(REGISTRY);
}

// ── Initial code set (10 entries spanning the highest-traffic subsystems) ──
// These exist so that buildError() resolves cleanly during Phase 1; the
// subsystems they describe do not yet publish to the bus.

register({
  code: 'QPM-WS-001',
  subsystem: 'websocket',
  category: 'core',
  severity: 'warn',
  title: 'No active connection',
  description: 'sendRoomAction() called before a room connection was established.',
  userAction: 'Reconnect to the game (refresh the tab if it persists).',
  devNotes: 'src/websocket/api.ts — guards against missing MagicCircle_RoomConnection.',
  sinceVersion: CURRENT_VERSION,
  // §9 — fires only during user-driven sends; user can act (reconnect/refresh); not transient
  // (each fire is a real failed action). Default warn throttle (30s) suppresses send-spam.
  notifyUser: true,
});

register({
  code: 'QPM-WS-002',
  subsystem: 'websocket',
  category: 'core',
  severity: 'info',
  title: 'Throttled',
  description: 'sendRoomAction() was throttled by the per-key rate limit.',
  devNotes: 'src/websocket/api.ts — throttle bucket per (type, key).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-WS-003',
  subsystem: 'websocket',
  category: 'core',
  severity: 'warn',
  title: 'WebSocket send failed',
  description: 'sendRoomAction() returned ok:false from the underlying connection.',
  devNotes: 'src/websocket/api.ts — non-ok return path.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-WS-004',
  subsystem: 'websocket',
  category: 'core',
  severity: 'warn',
  title: 'Invalid payload',
  description: 'sendRoomAction() rejected a payload that failed validation.',
  devNotes: 'src/websocket/api.ts — validatePayload(); likely a caller bug.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-WS-005',
  subsystem: 'websocket',
  category: 'core',
  severity: 'info',
  title: 'Locker blocked send',
  description: 'A registered preflight (locker guard) blocked the send.',
  devNotes: 'src/websocket/api.ts — registerSendPreflight() returned ok:false.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-ATOM-001',
  subsystem: 'atomRegistry',
  category: 'core',
  severity: 'warn',
  title: 'Missing atom',
  description: 'A registered atom key could not be resolved from the Jotai store.',
  devNotes: 'src/core/atomRegistry.ts — fallback applied; feature still works on stale data.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-ATOM-002',
  subsystem: 'atomRegistry',
  category: 'core',
  severity: 'warn',
  title: 'Atom transform error',
  description: 'A registered atom resolved but its path/transform threw — fallback applied.',
  devNotes: 'src/core/atomRegistry.ts applyTransform — likely a shape change on the game side.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-STATETREE-001',
  subsystem: 'stateTree',
  category: 'core',
  severity: 'warn',
  title: 'State not ready',
  description: 'stateTree.select() was called before the state tree finished initializing.',
  devNotes: 'src/core/stateTree.ts — caller ran a selector before initStateTree() resolved. Selectors should be called after main.ts init phase completes, or subscribe() used instead (which queues until ready).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-STATETREE-002',
  subsystem: 'stateTree',
  category: 'core',
  severity: 'warn',
  title: 'Selector threw',
  description: 'A state-tree selector function threw during evaluation.',
  devNotes: 'src/core/stateTree.ts — a subscriber\'s selector encountered an unexpected state shape. Subscriber isolated; delivered null. Check the selector for missing optional-chaining or a stale type assumption.',
  sinceVersion: CURRENT_VERSION,
});


register({
  code: 'QPM-CATALOG-001',
  subsystem: 'catalogs',
  category: 'core',
  severity: 'error',
  title: 'Catalog never arrived',
  description: 'Game catalogs were not captured within the expected window.',
  userAction: 'Refresh the game tab.',
  devNotes: 'src/catalogs/gameCatalogs.ts — Object.* hook missed the capture.',
  sinceVersion: CURRENT_VERSION,
  // §9 — affects every catalog-dependent feature; clear user action; the watchdog only fires
  // after the timeout, so not transient. Default error throttle (10s) is fine — fires once.
  notifyUser: true,
});

register({
  code: 'QPM-CATALOG-002',
  subsystem: 'catalogs',
  category: 'core',
  severity: 'warn',
  title: 'Partial catalog load',
  description: 'A catalog was captured but is missing some expected entries.',
  userAction: 'Refresh the game tab if features that depend on the missing catalog look incomplete.',
  devNotes: 'src/catalogs/gameCatalogs.ts — enrichment incomplete.',
  sinceVersion: CURRENT_VERSION,
  // §9 — pet/plant/egg gaps break dependent features (journal, calculator, optimizer); user can
  // refresh; the 30s grace timer ensures it is not a transient capture race.
  notifyUser: true,
});

register({
  code: 'QPM-CATALOG-003',
  subsystem: 'catalogs',
  category: 'core',
  severity: 'warn',
  title: 'Catalog enrichment timed out',
  description: 'A secondary catalog enrichment (ability colors, weather, cosmetics) exhausted its retry budget before completing.',
  devNotes: 'src/catalogs/catalogLoader.ts — startAbilityColorPolling / startWeatherCatalogPolling / startCosmeticCatalogPolling. Fallback data still applied; affected catalog may be partial.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-CATALOG-004',
  subsystem: 'catalogs',
  category: 'core',
  severity: 'warn',
  title: 'Catalog loader lifecycle error',
  description: 'A catalogs-ready callback threw, or the Object.* capture hooks failed to install.',
  devNotes: 'src/catalogs/catalogLoader/readyState.ts (callback isolation — the throwing subscriber is the real owner) / hooks.ts installHooks. If hooks failed to install, QPM-CATALOG-001 fires later from the watchdog.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-JOTAI-001',
  subsystem: 'jotaiBridge',
  category: 'core',
  severity: 'error',
  title: 'Jotai store unavailable',
  description: 'No Jotai store could be captured through any of the 6 fallback tiers.',
  userAction: 'Refresh the game tab.',
  devNotes: 'src/core/jotaiBridge.ts — polyfill engaged.',
  sinceVersion: CURRENT_VERSION,
  // §9 — all atom-driven features (pets/inventory/shops/weather) broken; user can refresh;
  // not transient (6 tiers already exhausted). reportJotaiCapture dedups via lastReportedMode.
  notifyUser: true,
});

register({
  code: 'QPM-JOTAI-002',
  subsystem: 'jotaiBridge',
  category: 'core',
  severity: 'info',
  title: 'Jotai capture source recorded',
  description: 'ensureJotaiStore() resolved via one of the 6 fallback tiers (aries / shared / fiber / write / cache-read / none). The tier is published as metrics.source on the health bus row.',
  devNotes: 'src/core/jotaiBridge.ts reportJotaiCapture — informational only; surfaces in Diagnostics window via metrics.source rather than the error buffer.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-SPRITE-001',
  subsystem: 'spriteV2',
  category: 'core',
  severity: 'error',
  title: 'Sprite system init failed',
  description: 'initSpriteSystem() rejected (PIXI never resolved, hydration produced zero frames, or boot threw).',
  userAction: 'Refresh the game tab.',
  devNotes: 'src/sprite-v2/index.ts start() — see cause for the underlying error.',
  sinceVersion: CURRENT_VERSION,
  // §9 — all sprite rendering broken for this session; user can refresh; init failure is terminal.
  notifyUser: true,
});

register({
  code: 'QPM-SPRITE-002',
  subsystem: 'spriteV2',
  category: 'core',
  severity: 'warn',
  title: 'Sprite hydration degraded',
  description: 'Sprite atlas hydration completed with missing frames or alias misses.',
  devNotes: 'src/sprite-v2/* — fallback render still active.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-SPRITE-003',
  subsystem: 'spriteV2',
  category: 'core',
  severity: 'info',
  title: 'Atlas frame missing',
  description: 'A specific sprite frame could not be resolved; fallback applied.',
  devNotes: 'RETIRED 2026-07-16 (row 6.25) — no emitting path. compat.ts renderAcrossCategories exhausts alias variants silently; frame-miss signal surfaces via SPRITE-002 hydration-coverage metrics + spriteLog compat-render-failed entries. Kept registered for cross-script contract stability (§4.3).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-SPRITE-004',
  subsystem: 'spriteV2',
  category: 'core',
  severity: 'warn',
  title: 'Sprite render failed',
  description: 'Texture extract / canvas conversion threw or returned blank. Falls through to other render strategies; deduped by failure signature.',
  devNotes: 'src/sprite-v2/index.ts rememberRenderFailure — GPU extract issues, lost WebGL context, or KTX2 fallback path.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-SPRITE-005',
  subsystem: 'spriteV2',
  category: 'core',
  severity: 'error',
  title: 'KTX2 decoder unavailable',
  description: 'Discovery of the game\'s ktx2.worker-*.js / libktx-*.wasm assets on the game origin failed, or the wasm fetch failed. Compressed atlases cannot decode; sprite hydration degrades and QPM-SPRITE-001/002 will surface the user-visible signal.',
  userAction: 'Refresh the game tab.',
  devNotes: 'src/sprite-v2/ktx2/client.ts + src/utils/gameAssetDiscovery.ts. If the game renamed assets, update the DISCOVERY_QUERIES filename patterns (ktx2.worker-*.js / libktx-*.wasm) in client.ts.',
  sinceVersion: CURRENT_VERSION,
  // §9 — user-facing signal already emerges via SPRITE-001/002; this row targets the diagnostics
  // panel so a developer can distinguish "game renamed assets" from generic hydration failure.
  notifyUser: false,
});

register({
  code: 'QPM-SPRITE-006',
  subsystem: 'spriteV2',
  category: 'core',
  severity: 'error',
  title: 'KTX2 worker protocol mismatch',
  description: 'The game\'s KTX2 worker replied with an unexpected message shape or texture format — the game changed its decode pipeline. Compressed atlases fail to decode; SPRITE-001/002 surface the user-visible degradation.',
  devNotes: 'src/sprite-v2/ktx2/client.ts validateTextureOptions. Re-run the discovery/protocol audit in .claude/plans/2026-07-08-ktx2-libktx-port.md against the new ktx2.worker-*.js.',
  sinceVersion: CURRENT_VERSION,
  notifyUser: false,
});

// STORE-* codes are shared by every src/store/* module. The `subsystem` field
// here is a placeholder ('store'); the bus subsystem is overridden per-call by
// _storeDiagnostics.ts so each store gets its own row attributed via
// `context.store` (e.g. context.store === 'hutch').
register({
  code: 'QPM-STORE-001',
  subsystem: 'store',
  category: 'store',
  severity: 'warn',
  title: 'Store init failed',
  description: 'A reactive store could not start. context.store identifies which store.',
  devNotes: 'src/store/* — see context.store + cause. Call sites escalate: emit via diag.error (bus → failed) when the failure leaves the store non-functional; diag.warn when a fallback keeps it partially working.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-STORE-002',
  subsystem: 'store',
  category: 'store',
  severity: 'warn',
  title: 'Store atom unavailable',
  description: 'A reactive store could not resolve its Jotai atom (label not found in cache).',
  devNotes: 'src/store/* — getAtomByLabel returned null; capture race or game-side rename. context.store identifies which store; context.atom names the missing label.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-STORE-003',
  subsystem: 'store',
  category: 'store',
  severity: 'warn',
  title: 'Store listener threw',
  description: 'A subscriber/listener inside a reactive store threw during a state update.',
  devNotes: 'src/store/* — listener bug; the store stays subscribed and the next update will re-emit. context.store identifies which store.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-STORE-004',
  subsystem: 'store',
  category: 'store',
  severity: 'warn',
  title: 'Store persistence failed',
  description: 'A reactive store could not persist its slice to the storage wrapper. In-memory state is unaffected; the write will retry on the next debounced save.',
  devNotes: 'src/store/* — storage.set threw (quota, hostile GM_setValue, or serializer failure). context.store identifies which store; context.what names the slice (e.g. procs, config).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-UI-001',
  subsystem: 'ui.window',
  category: 'ui',
  severity: 'error',
  title: 'Window render failed',
  description: 'A modal window threw during render. The shell remains intact; the body shows a structured error card via the error boundary.',
  devNotes: 'src/ui/core/modalWindow.ts try/catch around render() — context.id names the failing window; cause carries the original throw. src/ui/core/modalWindowErrorBoundary.ts paints the user-visible card.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-UI-002',
  subsystem: 'ui.window',
  category: 'ui',
  severity: 'warn',
  title: 'Window/panel helper failed',
  description: 'A window/panel helper threw. Parent op continues; fallbacks shown where present.',
  devNotes: 'src/ui/core/{modalWindow,originalPanel}.ts + src/ui/panel/{panelFooter,tileRegistry,standaloneTiles}.ts. context.what names the site; context.id/tile narrows.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-TILE-001',
  subsystem: 'ui.tileStatuses',
  category: 'ui',
  severity: 'warn',
  title: 'Tile provider import failed',
  description: 'A dynamic import inside a tile-status provider rejected. The tile keeps its last status text instead of updating.',
  devNotes: 'src/ui/panel/tileStatuses{Core,New}.ts — context.tile names the affected tile.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-TILE-002',
  subsystem: 'ui.tileStatuses',
  category: 'ui',
  severity: 'warn',
  title: 'Tile provider async work failed',
  description: 'An async operation inside a tile-status provider threw (fetch, store start, atom read). The tile keeps its last status text.',
  devNotes: 'src/ui/panel/tileStatuses{Core,New}.ts — context.tile + context.op identify the call site.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-TOUR-001',
  subsystem: 'ui.tour',
  category: 'ui',
  severity: 'warn',
  title: 'Tour overlay step failed',
  description: 'The tour engine swallowed an exception in an overlay render or step-progression path. The active tour is torn down so the user can keep using the app; previous behaviour silently dropped the rejection on the floor.',
  devNotes: 'src/ui/tour/engine.ts — context.phase identifies the call site (createOverlay | updateOverlayStep | destroyOverlay | showStep | teardown | startTour | positionTracking). src/ui/tour/help/panel.ts also uses phase=helpPanelSpriteImport / helpPanelReplayImport for its lazy-import failure paths. notifyUser intentionally false — a broken tour does not block the user\'s current task (criterion 1 of §9 fails).',
  sinceVersion: CURRENT_VERSION,
});

// FEATURE-* codes are shared by every src/features/* module that has migrated.
// The `subsystem` field here is a placeholder ('feature'); the bus subsystem is
// overridden per-call to the calling feature's `feature:*` id so each feature
// gets its own bus row attributed via `context.feature` (e.g. context.feature
// === 'gardenInstaHarvest').
register({
  code: 'QPM-FEATURE-001',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Feature WS send failed',
  description: 'A migrated feature attempted a WS send via sendRoomAction() that returned ok:false. The underlying WS layer also emits a WS-* code with the reason; this entry attributes the failure to the calling feature so its bus row reflects the problem.',
  devNotes: 'src/features/* — see context.feature for which feature; context.type names the RoomAction; context.reason carries the WS layer reason (no_connection | invalid_payload | throttled | send_failed | locker_blocked).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-FEATURE-002',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Feature bulk action partial failure',
  description: 'A migrated bulk feature finished with one or more failed per-item sends. context.feature names the feature; context.ok / context.failed / context.throttled / context.total carry the per-reason aggregate so Diagnostics surfaces the partial result without one row per item.',
  devNotes: 'src/features/* (bulkFavorite, autoFavorite, …) — each per-item failure is already attributed via WS-*; FEATURE-002 surfaces the aggregate. notifyUser intentionally false — features call notify() directly with the actual count, which the registry title cannot carry.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-FEATURE-003',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Feature lifecycle step failed',
  description: 'A migrated feature\'s init / patch / lifecycle step threw without crashing the feature. context.feature names the feature; context.what identifies the step (e.g. patch:hidden, audio:init, audio:resume, init).',
  devNotes: 'src/features/* (antiAfk, …) — fired when a non-WS lifecycle step fails non-fatally. Severity gets forced to error at call sites that publish failed status. notifyUser intentionally false — most steps are transient/recoverable; init-failure callers publish failed via log.error which the bus surfaces.',
  sinceVersion: CURRENT_VERSION,
});

// Integration: Aries bridge — exposes QPM_ARIES_BRIDGE on the page for Aries
// Mod consumption. One-shot expose at startup; no periodic work.
register({
  code: 'QPM-ARIES-001',
  subsystem: 'integrationAries',
  category: 'integration',
  severity: 'error',
  title: 'Aries bridge expose failed',
  description: 'shareGlobal() threw while publishing QPM_ARIES_BRIDGE on the page. The bridge is unavailable to consumers (Aries Mod and other userscripts).',
  devNotes: 'src/integrations/ariesBridge.ts exposeAriesBridge — typically a page-context issue (locked window, sandbox, or shareGlobal target missing). context.what identifies the step (expose).',
  sinceVersion: CURRENT_VERSION,
});

// Integration: Native card view — bridges to the game\'s InventoryCardView PIXI
// canvas. Lazy — first resolves on first openNativeCard() call. Codes share
// the integrationNativeCard subsystem so a single bus row reflects health.
register({
  code: 'QPM-NCARD-001',
  subsystem: 'integrationNativeCard',
  category: 'integration',
  severity: 'warn',
  title: 'Native card view unavailable',
  description: 'Could not resolve the game\'s InventoryCardView through the quinoaEngineAtom chain. openNativeCard() returns false; callers fall back to their own UI.',
  devNotes: 'src/integrations/nativeCardView.ts resolveCardView — context.reason names the failure tier (atom_missing | engine_invalid | system_missing | cardview_missing | exception).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-NCARD-002',
  subsystem: 'integrationNativeCard',
  category: 'integration',
  severity: 'warn',
  title: 'Native card open failed',
  description: 'cv.open() threw or a precondition for opening (origin sprite, sprite class) was missing. The cardView is force-closed and dex overrides restored.',
  devNotes: 'src/integrations/nativeCardView.ts openNativeCard — context.what identifies the failing step (open | no_sprite | sprite_class_missing | sprite_build).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-NCARD-003',
  subsystem: 'integrationNativeCard',
  category: 'integration',
  severity: 'warn',
  title: 'Native card teardown step failed',
  description: 'Overlay restore, dex-override restore, or forceClose threw during card close. The card may be visually inconsistent until the next open clears state.',
  devNotes: 'src/integrations/nativeCardView.ts wrapCloseForRestore / closeNativeCard — context.what identifies the step (overlay_restore | dex_restore | force_close).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-NCARD-004',
  subsystem: 'integrationNativeCard',
  category: 'integration',
  severity: 'info',
  title: 'Native card portrait asset failed',
  description: 'A portrait image or video asset failed to load. The card still opens — video falls back to portraitUrl; portraitUrl failure proceeds without overlay.',
  devNotes: 'src/integrations/nativeCardView.ts loadImageSource / loadVideoSource — context.what is image|video. URL omitted by design (user-supplied; may carry presigned tokens).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-FEATURE-004',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Feature helper failed',
  description: 'A migrated feature\'s runtime helper threw without crashing the feature — separate from FEATURE-003 (lifecycle/init) and FEATURE-001 (WS sends). Examples: event dispatch failure, inventory snapshot read failure, state persistence failure. context.feature names the feature; context.what identifies the helper (e.g. emit:rulesChanged, inventory:read).',
  devNotes: 'src/features/* (petFoodRules, …) — recurring runtime helpers that fail non-fatally. Distinguished from FEATURE-003 because FEATURE-003 is one-time lifecycle work whereas FEATURE-004 is recurring helper work. notifyUser intentionally false — most helpers degrade gracefully with fallback paths.',
  sinceVersion: CURRENT_VERSION,
});

// UI: Notification hub itself (§4.4 borderline → promoted Phase 5.4). The hub
// is the user-facing end of the logger pipeline; if it breaks, the user gets
// zero feedback for everything else, so its own degradation is uniquely
// meta-critical and not surfaced anywhere else on the bus.
register({
  code: 'QPM-NOTIF-001',
  subsystem: 'ui.notifications',
  category: 'ui',
  severity: 'warn',
  title: 'Notification subscriber threw',
  description: 'A subscriber registered via onNotifications() threw during fan-out or its initial replay. The hub stays subscribed and the next notify() call will re-emit; the misbehaving subscriber may still be running.',
  devNotes: 'src/core/notifications.ts emit() / onNotifications() — context.at identifies the path (emit | initial). notifyUser intentionally false — a misbehaving subscriber typically belongs to a single UI surface that is already broken; the notification hub itself keeps working.',
  sinceVersion: CURRENT_VERSION,
});

// Service: Restock data fetcher (§4.4 borderline → promoted Phase 5.4).
// External Supabase fetch with real failure modes (network, schema drift,
// CORS). Consumers (tile statuses, dashboard, shop window) see stale data on
// failure but no upstream signal told them WHY without this row.
register({
  code: 'QPM-RESTOCK-001',
  subsystem: 'restockData',
  category: 'service',
  severity: 'warn',
  title: 'Restock fetch failed',
  description: 'fetchRestockData() could not get a usable response from Supabase. Stale cache is served when present; otherwise consumers see an empty list.',
  devNotes: 'src/utils/restock/dataService.ts fetchRestockData — context.where identifies the attempted endpoint (extended | base | outer), context.gm whether GM_xmlhttpRequest was available, context.errors carries the per-transport reason snippets.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-RESTOCK-002',
  subsystem: 'restockData',
  category: 'service',
  severity: 'warn',
  title: 'Restock response unparseable',
  description: 'JSON parse failed or the response was not the expected array shape. Cache fallback applied (if present).',
  devNotes: 'src/utils/restock/dataService.ts fetchRestockData — context.what is parse | shape.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-RESTOCK-003',
  subsystem: 'restockData',
  category: 'service',
  severity: 'warn',
  title: 'Restock API config invalid',
  description: 'RESTOCK_URL malformed or anon key missing. Network fetch disabled for the session — only cached data is served.',
  devNotes: 'src/utils/restock/dataService.ts getRestockRequestConfig — most likely a build-time misconfiguration. The hub stays degraded for the session because config is static; restart required to recover.',
  sinceVersion: CURRENT_VERSION,
});

// Feature: Blobling Customiser Rive preview + cosmetic pipeline (SYM-1 driver).
// Rive preview is opaque — no user-visible error surfaces when it goes blank;
// this cluster codes the discovery / fetch / load / asset-override steps so
// the next URL-shape change degrades the bus row instead of going dark.
register({
  code: 'QPM-BLOBLING-001',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Avatar .riv URL discovery failed',
  description: 'Neither the local player\'s avatar instance nor the seen-URL log yielded a value passing isRivUrl(). SYM-1 root cause: game v710 reshaped inst.raw.riveFileSrc from a full URL to a bare cache key; the predicate stopped matching.',
  devNotes: 'src/features/bloblingCustomiser/avatarPreview.ts discoverAvatarRivUrl — context.hasPlayerId, context.instFound, context.seenCount surface what the discovery pass observed. If this fires after a game build, inspect the avatar instance\'s raw fields for the new URL shape and widen isRivUrl.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-BLOBLING-002',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Avatar .riv fetch failed',
  description: 'The discovered .riv URL returned non-ok or the fetch threw. Preview cannot render; canvas stays blank.',
  devNotes: 'src/features/bloblingCustomiser/avatarPreview.ts createPreviewAvatar — context.status (HTTP status when available) and context.what (fetch:response | fetch:exception) identify the failure mode.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-BLOBLING-003',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Rive load / artboard / renderer step failed',
  description: 'A step in the Rive preview construction (rive.load, artboard resolution, state machine, or renderer creation) failed. Preview cannot render.',
  devNotes: 'src/features/bloblingCustomiser/avatarPreview.ts createPreviewAvatar — context.what identifies the failing step (rive:runtime_missing | rive:load_exception | rive:load_null | artboard:default | artboard:by_index | artboard:missing | statemachine:create | renderer:make | renderer:null).',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-BLOBLING-004',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Image override / asset fetch failed',
  description: 'A cosmetic image override could not be applied — asset not captured on the file, or the CDN fetch failed. Individual slot silently falls back to the base cosmetic; other slots still render.',
  devNotes: 'src/features/bloblingCustomiser/avatarPreview.ts setImageOnAsset — context.what identifies the failing step (asset:missing | image:fetch_response | image:fetch_exception). The image-fetch response path previously logged nothing at all; SYM-1-adjacent silent bail.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-BLOBLING-005',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Cosmetic claim failed',
  description: 'A POST to /me/cosmetics/claim/{filename} returned non-ok or the request threw. The unowned cosmetic remains locked; user-visible via the buy/claim flow returning ok:false.',
  devNotes: 'src/features/bloblingCustomiser/cosmeticApi.ts claimCosmetic — context.what identifies the failure (claim:no_room | claim:response | claim:exception), context.status carries HTTP status on response failure.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-BLOBLING-006',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Preset listener threw',
  description: 'A listener registered via onPresetsChange() threw during snapshot fan-out. The presets store stays subscribed; the misbehaving subscriber\'s UI may be stale until the next update.',
  devNotes: 'src/features/bloblingCustomiser/presets/store.ts notifyListeners — subscriber bug in the presets bar or grid picker.',
  sinceVersion: CURRENT_VERSION,
});

// Feature: Texture Swapper (garden painter) — Rive overlays and static-texture
// swaps for plants/decor/pets. Two codes cover the ~90-empty-catch surface:
// TEXTURESWAP-001 for rive step failures across rive/*, TEXTURESWAP-002 for
// lifecycle/persistence/helper failures in index.ts + presets/store.ts.
register({
  code: 'QPM-TEXTURESWAP-001',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Texture-swapper Rive step failed',
  description: 'A Rive overlay step (wrapper/mask/overlay construction, ticker install, filter attach, texture swap) threw. The rule keeps trying on the next Layer B refresh; if the failure is transient the sprite recovers on its own.',
  devNotes: 'src/features/standalone/textureSwapper/rive/* — context.what identifies the step (rainbow:wrapper | rainbow:mask | rainbow:overlay | rainbow:ticker | ...); per-frame sync and teardown catches stay silent per row rule.',
  sinceVersion: CURRENT_VERSION,
});

register({
  code: 'QPM-TEXTURESWAP-002',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Texture-swapper helper failed',
  description: 'A texture-swapper lifecycle helper failed — state load/save, debug-flag persistence, preset listener notify, or preset persistence. Rule-application pipeline is unaffected; the specific helper degrades non-fatally.',
  devNotes: 'src/features/standalone/textureSwapper/{index.ts, presets/store.ts} — context.what identifies the helper (state:load | state:save | debug:save | preset:notify | ...).',
  sinceVersion: CURRENT_VERSION,
});

// Core: Boot phases (row 6.22). One code covers the try/catch surface across
// src/main/{init,phases,globalApis}.ts — each catch swallows a non-fatal init
// failure so the userscript keeps booting; context.what identifies the step so
// the enumeration lives inside the buffer instead of one code per phase.
register({
  code: 'QPM-INIT-001',
  subsystem: 'init',
  category: 'core',
  severity: 'warn',
  title: 'Boot phase step failed',
  description: 'A non-fatal init/boot step threw and was swallowed to keep the userscript loading. Boot continues with reduced functionality — the specific step named by context.what is unavailable.',
  devNotes: 'src/main/{init,phases,globalApis}.ts — the classic try/catch around a non-critical phase call. context.what enumerates: canvasRuntimeTrap | rivFetchInterceptor | riveEngine | riveControl | customSkins | bloblingPresets | gardenPainterPresets | stateTree | reactiveManager | initLocale | shopRestockAlerts | dawnFeatures | chargedAbilities | weatherPredictions | atomHealthCheck | phase:antiAfk | phase:inventoryStore | phase:hutchStore | phase:seedSiloStore | phase:decorShedStore | phase:petInfoStore | phase:abilityTriggerStore | phase:activityLog | phase:economyTracker | phase:petHatchingTracker | globalApis:exposeActivityLog | inspector:friendShare | inspector:playerShare.',
  sinceVersion: CURRENT_VERSION,
  // §9 — boot-time non-fatal failures fire before the user is doing anything
  // interactive; no clear per-code userAction (refresh helps but many are
  // transient); the aggregate signal surfaces via the titlebar dot once init
  // completes with degraded status.
  notifyUser: false,
});

// Core: Timer manager (row 6.23). The RAF tick loop catches per-callback throws
// so one broken timer never breaks the loop; that catch previously logged via
// raw console.error, now routed through the named logger for buffer + bus
// attribution. Per-tick recovery expected on the next interval.
register({
  code: 'QPM-TIMER-001',
  subsystem: 'timerManager',
  category: 'core',
  severity: 'warn',
  title: 'Timer callback threw',
  description: 'A registered timer callback threw inside the RAF tick loop. The timer stays registered and will fire again next interval; the loop keeps ticking for other timers. context.id names the failing timer.',
  devNotes: 'src/utils/scheduling/timerManager.ts tick() — the try/catch keeps the RAF loop alive after per-timer failures.',
  sinceVersion: CURRENT_VERSION,
  notifyUser: false,
});

// Core: Rive engine (row 6.25). Low-level runtime that features (textureSwapper,
// bloblingCustomiser previews) sit on top of. One code covers the sole real
// failure surface — the async runtime-capture chain that resolves the
// low-level Rive runtime (@rive-app/canvas-advanced) via lowLevelRiveAtom or
// the canvas trap. If capture never resolves, every downstream override
// (image/input/text/speed/file/asset) silently no-ops.
register({
  code: 'QPM-RIVE-001',
  subsystem: 'riveEngine',
  category: 'core',
  severity: 'warn',
  title: 'Rive runtime capture failed',
  description: 'captureRiveRuntime() rejected — the low-level Rive runtime (@rive-app/canvas-advanced) could not be resolved via lowLevelRiveAtom or the canvas trap. Rive overrides silently no-op until reload.',
  devNotes: 'src/rive-engine/index.ts initRiveEngine() — the void captureRiveRuntime().catch. context.what identifies the step (runtimeCapture).',
  sinceVersion: CURRENT_VERSION,
  // §9 — user-visible signal already surfaces via BLOBLING-003 (avatar preview
  // blank) and TEXTURESWAP-001 (rule refresh no-ops); this row targets the
  // Diagnostics panel so a developer can distinguish "runtime never captured"
  // from "override chain broke downstream".
  notifyUser: false,
});

register({
  code: 'QPM-BUNDLE-001',
  subsystem: 'bundle',
  category: 'core',
  severity: 'info',
  title: 'Bundle info published',
  description: 'Startup publish of build artefact metadata (version, iifeBytes, builtAt) to the health bus for size-regression visibility in the Diagnostics window.',
  devNotes: 'src/diagnostics/bundleInfo.ts reads window.__QPM_BUNDLE_INFO__ (burned in by scripts/build-userscript.js before USERSCRIPT_FOOTER). Metric-only; never fires a log call.',
  sinceVersion: CURRENT_VERSION,
});
