import type { ErrorCodeDefinition } from '../types';

const V = '3.2.29';

export const FEATURE_CODES: readonly ErrorCodeDefinition[] = [
  // FEATURE-* codes are shared by every src/features/* module that has migrated.
  // The `subsystem` field here is a placeholder ('feature'); the bus subsystem is
  // overridden per-call to the calling feature's `feature:*` id so each feature
  // gets its own bus row attributed via `context.feature` (e.g. context.feature
  // === 'gardenInstaHarvest').
  {
    code: 'QPM-FEATURE-001',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Feature WS send failed',
    description: 'A migrated feature attempted a WS send via sendRoomAction() that returned ok:false. The underlying WS layer also emits a WS-* code with the reason; this entry attributes the failure to the calling feature so its bus row reflects the problem.',
    devNotes: 'src/features/* — see context.feature for which feature; context.type names the RoomAction; context.reason carries the WS layer reason (no_connection | session_not_ready | invalid_payload | throttled | send_failed | locker_blocked).',
    sinceVersion: V,
  },
  {
    code: 'QPM-FEATURE-002',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Feature bulk action partial failure',
    description: 'A migrated bulk feature finished with one or more failed per-item sends. context.feature names the feature; context.ok / context.failed / context.throttled / context.total carry the per-reason aggregate so Diagnostics surfaces the partial result without one row per item.',
    devNotes: 'src/features/* (bulkFavorite, autoFavorite, …) — each per-item failure is already attributed via WS-*; FEATURE-002 surfaces the aggregate. notifyUser intentionally false — features call notify() directly with the actual count, which the registry title cannot carry.',
    sinceVersion: V,
  },
  {
    code: 'QPM-FEATURE-003',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Feature lifecycle step failed',
    description: 'A migrated feature\'s init / patch / lifecycle step threw without crashing the feature. context.feature names the feature; context.what identifies the step (e.g. patch:hidden, audio:init, audio:resume, init).',
    devNotes: 'src/features/* (antiAfk, …) — fired when a non-WS lifecycle step fails non-fatally. Severity gets forced to error at call sites that publish failed status. notifyUser intentionally false — most steps are transient/recoverable; init-failure callers publish failed via log.error which the bus surfaces.',
    sinceVersion: V,
  },
  {
    code: 'QPM-FEATURE-004',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Feature helper failed',
    description: 'A migrated feature\'s runtime helper threw without crashing the feature — separate from FEATURE-003 (lifecycle/init) and FEATURE-001 (WS sends). Examples: event dispatch failure, inventory snapshot read failure, state persistence failure. context.feature names the feature; context.what identifies the helper (e.g. emit:rulesChanged, inventory:read).',
    devNotes: 'src/features/* (petFoodRules, …) — recurring runtime helpers that fail non-fatally. Distinguished from FEATURE-003 because FEATURE-003 is one-time lifecycle work whereas FEATURE-004 is recurring helper work. notifyUser intentionally false — most helpers degrade gracefully with fallback paths.',
    sinceVersion: V,
  },
  {
    code: 'QPM-PET-001',
    subsystem: 'feature:pets',
    category: 'feature',
    severity: 'warn',
    title: 'Pet position unresolved for ghost step',
    description: 'ghostStepToPet() could not resolve the target pet\'s tile (pet missing from petSlotInfos, or a motion shape petTileFromMotion does not understand). The potion/feed action is still sent without stepping, so the server rejects it for proximity. context.reason is pet-not-in-state | motion-unresolved; context.motionKind is the unrecognised kind.',
    devNotes: 'src/utils/ghostStep.ts — throttled 30 s per pet. A new motion kind in a game bundle should be ported into petTileFromMotion.',
    sinceVersion: V,
    notifyUser: false,
  },
  // Feature: Blobling Customiser Rive preview + cosmetic pipeline (SYM-1 driver).
  // Rive preview is opaque — no user-visible error surfaces when it goes blank;
  // this cluster codes the discovery / fetch / load / asset-override steps so
  // the next URL-shape change degrades the bus row instead of going dark.
  {
    code: 'QPM-BLOBLING-001',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Avatar .riv URL discovery failed',
    description: 'Neither the local player\'s avatar instance nor the seen-URL log yielded a value passing isRivUrl(). SYM-1 root cause: game v710 reshaped inst.raw.riveFileSrc from a full URL to a bare cache key; the predicate stopped matching.',
    devNotes: 'src/features/bloblingCustomiser/avatarPreview.ts discoverAvatarRivUrl — context.hasPlayerId, context.instFound, context.seenCount surface what the discovery pass observed. If this fires after a game build, inspect the avatar instance\'s raw fields for the new URL shape and widen isRivUrl.',
    sinceVersion: V,
  },
  {
    code: 'QPM-BLOBLING-002',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Avatar .riv fetch failed',
    description: 'The discovered .riv URL returned non-ok or the fetch threw. Preview cannot render; canvas stays blank.',
    devNotes: 'src/features/bloblingCustomiser/avatarPreview.ts createPreviewAvatar — context.status (HTTP status when available) and context.what (fetch:response | fetch:exception) identify the failure mode.',
    sinceVersion: V,
  },
  {
    code: 'QPM-BLOBLING-003',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Rive load / artboard / renderer step failed',
    description: 'A step in the Rive preview construction (rive.load, artboard resolution, state machine, or renderer creation) failed. Preview cannot render.',
    devNotes: 'src/features/bloblingCustomiser/avatarPreview.ts createPreviewAvatar — context.what identifies the failing step (rive:runtime_missing | rive:load_exception | rive:load_null | artboard:default | artboard:by_index | artboard:missing | statemachine:create | renderer:make | renderer:null).',
    sinceVersion: V,
  },
  {
    code: 'QPM-BLOBLING-004',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Image override / asset fetch failed',
    description: 'A cosmetic image override could not be applied — asset not captured on the file, or the CDN fetch failed. Individual slot silently falls back to the base cosmetic; other slots still render.',
    devNotes: 'src/features/bloblingCustomiser/avatarPreview.ts setImageOnAsset — context.what identifies the failing step (asset:missing | image:fetch_response | image:fetch_exception). The image-fetch response path previously logged nothing at all; SYM-1-adjacent silent bail.',
    sinceVersion: V,
  },
  {
    code: 'QPM-BLOBLING-005',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Cosmetic claim failed',
    description: 'A POST to /me/cosmetics/claim/{filename} returned non-ok or the request threw. The unowned cosmetic remains locked; user-visible via the buy/claim flow returning ok:false.',
    devNotes: 'src/features/bloblingCustomiser/cosmeticApi.ts claimCosmetic — context.what identifies the failure (claim:no_room | claim:response | claim:exception), context.status carries HTTP status on response failure.',
    sinceVersion: V,
  },
  {
    code: 'QPM-BLOBLING-006',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Preset listener threw',
    description: 'A listener registered via onPresetsChange() threw during snapshot fan-out. The presets store stays subscribed; the misbehaving subscriber\'s UI may be stale until the next update.',
    devNotes: 'src/features/bloblingCustomiser/presets/store.ts notifyListeners — subscriber bug in the presets bar or grid picker.',
    sinceVersion: V,
  },
  // Feature: Texture Swapper (garden painter) — Rive overlays and static-texture
  // swaps for plants/decor/pets. Two codes cover the ~90-empty-catch surface:
  // TEXTURESWAP-001 for rive step failures across rive/*, TEXTURESWAP-002 for
  // lifecycle/persistence/helper failures in index.ts + presets/store.ts.
  {
    code: 'QPM-TEXTURESWAP-001',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Texture-swapper Rive step failed',
    description: 'A Rive overlay step (wrapper/mask/overlay construction, ticker install, filter attach, texture swap) threw. The rule keeps trying on the next Layer B refresh; if the failure is transient the sprite recovers on its own.',
    devNotes: 'src/features/standalone/textureSwapper/rive/* — context.what identifies the step (rainbow:wrapper | rainbow:mask | rainbow:overlay | rainbow:ticker | ...); per-frame sync and teardown catches stay silent per row rule.',
    sinceVersion: V,
  },
  {
    code: 'QPM-TEXTURESWAP-002',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'Texture-swapper helper failed',
    description: 'A texture-swapper lifecycle helper failed — state load/save, debug-flag persistence, preset listener notify, or preset persistence. Rule-application pipeline is unaffected; the specific helper degrades non-fatally.',
    devNotes: 'src/features/standalone/textureSwapper/{index.ts, presets/store.ts} — context.what identifies the helper (state:load | state:save | debug:save | preset:notify | ...).',
    sinceVersion: V,
  },
];
