// Pure — imported by scripts/check-pet-activity.mjs under node. No catalog/DOM imports.
import type { EventKind, EventValue, PetActivityEvent, PetSnap, TargetSnap } from './types';

export interface NormalizeDeps {
  familyOf(action: string): string;
  isAbilityAction(action: string): boolean;
}
export interface NormalizedServerEntry { event: PetActivityEvent; rawParameters: Record<string, unknown> }

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '__CYCLE__';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Rec = {};
    for (const k of Object.keys(v as Rec).sort()) out[k] = walk((v as Rec)[k]);
    return out;
  };
  try { return JSON.stringify(walk(value)); } catch { return ''; }
}

const PET_HOLDER_KEYS = ['pet', 'targetPet', 'extraPet'] as const;
const KIND_BY_ACTION: Record<string, EventKind> = {
  feedPet: 'feed', feedPetFromTrough: 'feed', hatchEgg: 'hatch', sellPet: 'sell',
  xpPotion: 'potion', replenishPotion: 'potion',
};

export function readPetSnap(v: unknown): PetSnap | null {
  if (!isRec(v)) return null;
  const id = str(v.id); const species = str(v.petSpecies);
  if (!id || !species) return null;
  return { id, species, name: str(v.name), mutations: strArr(v.mutations), targetScale: num(v.targetScale, 1),
    xp: num(v.xp), abilities: strArr(v.abilities), str: null, maxStr: null, level: null };
}

function readCrop(v: unknown): TargetSnap | null {
  if (!isRec(v)) return null;
  const species = str(v.species); if (!species) return null;
  return { kind: 'crop', species, mutations: strArr(v.mutations), scale: num(v.scale, 1) };
}
function readGrowSlot(v: unknown): TargetSnap | null {
  if (!isRec(v)) return null;
  const species = str(v.species); if (!species) return null;
  return { kind: 'growSlot', species, mutations: strArr(v.mutations), targetScale: num(v.targetScale, 1),
    startTime: num(v.startTime), endTime: num(v.endTime) };
}

/** Targets are derived from parameter *shape* so unseen ability ids still render. */
export function extractTargets(p: Rec, self: PetSnap): TargetSnap[] {
  const out: TargetSnap[] = [];
  const push = (t: TargetSnap | null): void => { if (t) out.push(t); };
  push(readCrop(p.harvestedCrop));
  for (const c of Array.isArray(p.crops) ? p.crops : []) push(readCrop(c));
  for (const c of Array.isArray(p.cropsRefunded) ? p.cropsRefunded : []) push(readCrop(c));
  push(readGrowSlot(p.growSlot));
  for (const g of Array.isArray(p.growSlotsAffected) ? p.growSlotsAffected : []) push(readGrowSlot(g));
  for (const key of ['targetPet', 'extraPet'] as const) {
    const snap = readPetSnap(p[key]);
    if (snap && snap.id !== self.id) out.push({ kind: 'pet', pet: snap });
  }
  for (const s of Array.isArray(p.petsAffected) ? p.petsAffected : []) {
    const snap = readPetSnap(s); if (snap && snap.id !== self.id) out.push({ kind: 'pet', pet: snap });
  }
  const eggId = str(p.eggId);
  if (eggId) out.push({ kind: 'egg', eggId });
  for (const e of strArr(p.eggsAffected)) out.push({ kind: 'egg', eggId: e });
  const speciesId = str(p.speciesId);
  if (speciesId) out.push({ kind: 'seed', species: speciesId });
  if (['coinsFound', 'bonusCoins', 'sellPrice', 'totalValue'].some((k) => typeof p[k] === 'number')) out.push({ kind: 'coin' });
  return out;
}

export function extractValues(p: Rec): Record<string, EventValue> {
  const out: Record<string, EventValue> = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && v.trim() && !PET_HOLDER_KEYS.includes(k as typeof PET_HOLDER_KEYS[number])) out[k] = v;
    else if (Array.isArray(v)) out[`${k}Count`] = v.length;
  }
  return out;
}

export function serverEntryKey(raw: unknown): string | null {
  if (!isRec(raw)) return null;
  const ts = num(raw.timestamp); const action = str(raw.action);
  if (!ts || !action) return null;
  const p = isRec(raw.parameters) ? raw.parameters : {};
  const petId = isRec(p.pet) ? str(p.pet.id) ?? '' : '';
  return `${ts}|${action}|${petId}`;
}

export function entrySignature(raw: unknown): string {
  return isRec(raw) ? stableStringify(raw.parameters) : '';
}

/** Any entry carrying `parameters.pet` whose action is not a fixed kind is an ability — unseen ids flow through. */
export function normalizeServerEntry(raw: unknown, deps: NormalizeDeps): NormalizedServerEntry | null {
  const key = serverEntryKey(raw); if (!key || !isRec(raw)) return null;
  const action = raw.action as string; const ts = raw.timestamp as number;
  const p = isRec(raw.parameters) ? raw.parameters : {};
  const self = readPetSnap(p.pet); if (!self) return null;
  const kind: EventKind = KIND_BY_ACTION[action] ?? 'ability';
  const family = kind === 'ability' ? deps.familyOf(action) : kind;
  const values = extractValues(p);
  if (kind === 'sell' && typeof p.dustValue === 'number') values.sellDust = p.dustValue;
  return {
    event: { id: key, ts, source: 'server', kind, action, family, pet: self, targets: extractTargets(p, self), values, updatedAt: ts },
    rawParameters: p,
  };
}
