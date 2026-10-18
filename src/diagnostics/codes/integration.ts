import type { ErrorCodeDefinition } from '../types';

const V = '3.2.29';

export const INTEGRATION_CODES: readonly ErrorCodeDefinition[] = [
  // Integration: Aries bridge — exposes QPM_ARIES_BRIDGE on the page for Aries
  // Mod consumption. One-shot expose at startup; no periodic work.
  {
    code: 'QPM-ARIES-001',
    subsystem: 'integrationAries',
    category: 'integration',
    severity: 'error',
    title: 'Aries bridge expose failed',
    description: 'shareGlobal() threw while publishing QPM_ARIES_BRIDGE on the page. The bridge is unavailable to consumers (Aries Mod and other userscripts).',
    devNotes: 'src/integrations/ariesBridge.ts exposeAriesBridge — typically a page-context issue (locked window, sandbox, or shareGlobal target missing). context.what identifies the step (expose).',
    sinceVersion: V,
  },
  // Integration: Native card view — bridges to the game\'s InventoryCardView PIXI
  // canvas. Lazy — first resolves on first openNativeCard() call. Codes share
  // the integrationNativeCard subsystem so a single bus row reflects health.
  {
    code: 'QPM-NCARD-001',
    subsystem: 'integrationNativeCard',
    category: 'integration',
    severity: 'warn',
    title: 'Native card view unavailable',
    description: 'Could not resolve the game\'s InventoryCardView through the quinoaEngineAtom chain. openNativeCard() returns false; callers fall back to their own UI.',
    devNotes: 'src/integrations/nativeCardView.ts resolveCardView — context.reason names the failure tier (atom_missing | engine_invalid | system_missing | cardview_missing | exception).',
    sinceVersion: V,
  },
  {
    code: 'QPM-NCARD-002',
    subsystem: 'integrationNativeCard',
    category: 'integration',
    severity: 'warn',
    title: 'Native card open failed',
    description: 'cv.open() threw or a precondition for opening (origin sprite, sprite class) was missing. The cardView is force-closed and dex overrides restored.',
    devNotes: 'src/integrations/nativeCardView.ts openNativeCard — context.what identifies the failing step (open | no_sprite | sprite_class_missing | sprite_build).',
    sinceVersion: V,
  },
  {
    code: 'QPM-NCARD-003',
    subsystem: 'integrationNativeCard',
    category: 'integration',
    severity: 'warn',
    title: 'Native card teardown step failed',
    description: 'Overlay restore, dex-override restore, or forceClose threw during card close. The card may be visually inconsistent until the next open clears state.',
    devNotes: 'src/integrations/nativeCardView.ts wrapCloseForRestore / closeNativeCard — context.what identifies the step (overlay_restore | dex_restore | force_close).',
    sinceVersion: V,
  },
  {
    code: 'QPM-NCARD-004',
    subsystem: 'integrationNativeCard',
    category: 'integration',
    severity: 'info',
    title: 'Native card portrait asset failed',
    description: 'A portrait image or video asset failed to load. The card still opens — video falls back to portraitUrl; portraitUrl failure proceeds without overlay.',
    devNotes: 'src/integrations/nativeCardView.ts loadImageSource / loadVideoSource — context.what is image|video. URL omitted by design (user-supplied; may carry presigned tokens).',
    sinceVersion: V,
  },
];
