import { MUTATION_META, RENDERER_VERSION, type MgSceneV1 } from '../../../../mg-sprite-render/src';
import { hasSpriteKey } from '../../../sprite-v2/compat';

export interface ValidationError { code: string; message: string; details?: unknown }
export interface ValidationWarning { code: string; message: string; details?: unknown }
export type ValidationResult =
  | { ok: true; scene: MgSceneV1; warnings: ValidationWarning[] }
  | { ok: false; errors: ValidationError[] };

const MAX_CANVAS = 256;
const SLOT_WARN_CAP = 32;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function majorOf(v: string): string | null {
  const m = /^(\d+)\.\d+\.\d+$/.exec(v);
  return m ? m[1]! : null;
}

export function validateMgScene(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: [{ code: 'QPM-TDCDIMP-001', message: 'Not a valid JSON object.' }] };
  }
  if (raw.$schema !== 'mgscene/v1') {
    return { ok: false, errors: [{ code: 'QPM-TDCDIMP-002', message: 'Not an mgscene/v1 file.' }] };
  }

  const rv = typeof raw.rendererVersion === 'string' ? raw.rendererVersion : '';
  const rvMajor = majorOf(rv);
  const localMajor = majorOf(RENDERER_VERSION);
  if (!rvMajor || !localMajor) {
    errors.push({
      code: 'QPM-TDCDIMP-003',
      message: `Invalid rendererVersion "${rv}".`,
      details: { designVersion: rv, localVersion: RENDERER_VERSION },
    });
  } else if (rvMajor !== localMajor) {
    return {
      ok: false,
      errors: [{
        code: 'QPM-TDCDIMP-003',
        message: `Design uses mg-sprite-render v${rvMajor}.x; this QPM has v${localMajor}.x. Update QPM or re-export.`,
        details: { designVersion: rv, localVersion: RENDERER_VERSION },
      }],
    };
  } else if (rv !== RENDERER_VERSION) {
    warnings.push({
      code: 'QPM-TDCDIMP-004',
      message: `Minor version mismatch (design: ${rv}, local: ${RENDERER_VERSION}).`,
      details: { designVersion: rv, localVersion: RENDERER_VERSION },
    });
  }

  const canvas = raw.canvas;
  if (!isObject(canvas) || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') {
    errors.push({ code: 'QPM-TDCDIMP-002', message: 'Missing or invalid canvas.' });
  } else if (canvas.width > MAX_CANVAS || canvas.height > MAX_CANVAS) {
    errors.push({
      code: 'QPM-TDCDIMP-008',
      message: `Canvas ${canvas.width}x${canvas.height} exceeds 256x256. Multi-tile footprints are not supported in v1.`,
      details: { canvasWidth: canvas.width, canvasHeight: canvas.height },
    });
  }

  const slots = raw.slots;
  if (!Array.isArray(slots)) {
    errors.push({ code: 'QPM-TDCDIMP-002', message: 'Missing slots array.' });
    return { ok: false, errors };
  }

  if (slots.length > SLOT_WARN_CAP) {
    warnings.push({
      code: 'QPM-TDCDIMP-009',
      message: `${slots.length} slots exceeds recommended cap of ${SLOT_WARN_CAP}.`,
      details: { slotCount: slots.length },
    });
  }

  const badTypes: string[] = [];
  const badKeys: string[] = [];
  const badMuts: string[] = [];
  const keptSlots: unknown[] = [];
  let emptyKeySkipped = 0;
  for (const s of slots) {
    if (!isObject(s)) { errors.push({ code: 'QPM-TDCDIMP-002', message: 'Slot is not an object.' }); continue; }
    if (s.type !== 'sprite') {
      const t = typeof s.type === 'string' ? s.type : String(s.type);
      if (!badTypes.includes(t)) badTypes.push(t);
      continue;
    }
    // Customiser exports include placeholder slots with spriteKey:"" — treat as unused, skip silently.
    if (typeof s.spriteKey !== 'string' || !s.spriteKey) { emptyKeySkipped += 1; continue; }
    if (!hasSpriteKey(s.spriteKey) && !badKeys.includes(s.spriteKey)) badKeys.push(s.spriteKey);
    if (Array.isArray(s.mutations)) {
      for (const m of s.mutations) {
        if (typeof m === 'string' && !(m in MUTATION_META) && !badMuts.includes(m)) badMuts.push(m);
      }
    }
    keptSlots.push(s);
  }
  if (emptyKeySkipped > 0) {
    warnings.push({
      code: 'QPM-TDCDIMP-004',
      message: `Skipped ${emptyKeySkipped} unused (empty) slot(s) from the customiser export.`,
      details: { emptyKeySkipped },
    });
  }
  if (badTypes.length) errors.push({
    code: 'QPM-TDCDIMP-007',
    message: `Non-sprite slot types not supported in v1: ${badTypes.join(', ')}.`,
    details: { badTypes },
  });
  if (badKeys.length) errors.push({
    code: 'QPM-TDCDIMP-005',
    message: `Sprite keys not in current atlas: ${badKeys.join(', ')}.`,
    details: { badKeys },
  });
  if (badMuts.length) errors.push({
    code: 'QPM-TDCDIMP-006',
    message: `Unknown mutations: ${badMuts.join(', ')}.`,
    details: { badMutations: badMuts },
  });

  if (errors.length) return { ok: false, errors };
  const cleanScene = { ...raw, slots: keptSlots } as unknown as MgSceneV1;
  return { ok: true, scene: cleanScene, warnings };
}
