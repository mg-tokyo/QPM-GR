export type RiveRuleTarget =
  | { kind: 'avatar'; playerId: string; playerName?: string }
  | { kind: 'pet'; petId: string; species?: string }
  | { kind: 'decorClass'; decorClass: string }
  | { kind: 'artboard'; artboardNameLower: string };

/**
 * Persistent rule mapping a stable entity target to a set of Rive overrides.
 * Triggers are one-shots and are NOT persisted — the editor exposes fire-now
 * buttons that call `fireTrigger` directly instead of writing here.
 */
export interface RiveRule {
  id: string;
  enabled: boolean;
  label: string;
  target: RiveRuleTarget;
  /** playbackSpeed multiplier; 0 freezes; 1 = normal. Absent = don't touch. */
  speed?: number;
  boolInputs?: Record<string, boolean>;
  numberInputs?: Record<string, number>;
  /** VMI image property → URL / dataURL. */
  images?: Record<string, string>;
  /** Artboard text-run name → value. */
  textRuns?: Record<string, string>;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeStringMap(v: unknown): Record<string, string> | undefined {
  if (!isPlainRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === 'string' && k.length > 0 && typeof val === 'string') {
      out[k] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeBoolMap(v: unknown): Record<string, boolean> | undefined {
  if (!isPlainRecord(v)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === 'string' && k.length > 0 && typeof val === 'boolean') {
      out[k] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeNumberMap(v: unknown): Record<string, number> | undefined {
  if (!isPlainRecord(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === 'string' && k.length > 0 && typeof val === 'number' && Number.isFinite(val)) {
      out[k] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeTarget(v: unknown): RiveRuleTarget | null {
  if (!isPlainRecord(v)) return null;
  const kind = v.kind;
  switch (kind) {
    case 'avatar': {
      const playerId = v.playerId;
      if (typeof playerId !== 'string' || playerId.length === 0) return null;
      const target: RiveRuleTarget = { kind, playerId };
      if (typeof v.playerName === 'string') target.playerName = v.playerName;
      return target;
    }
    case 'pet': {
      const petId = v.petId;
      if (typeof petId !== 'string' || petId.length === 0) return null;
      const target: RiveRuleTarget = { kind, petId };
      if (typeof v.species === 'string') target.species = v.species;
      return target;
    }
    case 'decorClass': {
      const decorClass = v.decorClass;
      if (typeof decorClass !== 'string' || decorClass.length === 0) return null;
      return { kind, decorClass };
    }
    case 'artboard': {
      const artboardNameLower = v.artboardNameLower;
      if (typeof artboardNameLower !== 'string' || artboardNameLower.length === 0) return null;
      return { kind, artboardNameLower };
    }
    default:
      return null;
  }
}

export function sanitizeRiveRule(raw: unknown): RiveRule | null {
  if (!isPlainRecord(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
  const target = sanitizeTarget(raw.target);
  if (!id || !target) return null;

  const rule: RiveRule = {
    id,
    enabled: raw.enabled !== false,
    label: typeof raw.label === 'string' ? raw.label : '',
    target,
  };

  if (typeof raw.speed === 'number' && Number.isFinite(raw.speed)) {
    const clamped = Math.max(0, Math.min(10, raw.speed));
    rule.speed = clamped;
  }
  const boolInputs = sanitizeBoolMap(raw.boolInputs);
  if (boolInputs) rule.boolInputs = boolInputs;
  const numberInputs = sanitizeNumberMap(raw.numberInputs);
  if (numberInputs) rule.numberInputs = numberInputs;
  const images = sanitizeStringMap(raw.images);
  if (images) rule.images = images;
  const textRuns = sanitizeStringMap(raw.textRuns);
  if (textRuns) rule.textRuns = textRuns;
  return rule;
}
