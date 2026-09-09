// Pure — imported by scripts/check-pet-activity.mjs under node. i18n/catalogs arrive via DescribeDeps.
import type { ActivityRun, PetActivityEvent, EventValue } from '../../../../store/petActivity';

export type Segment = { t: 'text' | 'pet' | 'hl' | 'mut' | 'coin' | 'xn'; v: string | number };
export interface Described { sentence: Segment[]; meta: string[] }
export interface DescribeDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  abilityName(id: string): string;
  abilityDescription(id: string): string | null;
  mutationName(id: string): string;
  cropName(species: string): string;
  petSpeciesName(species: string): string;
  eggName(id: string): string;
  seedName(species: string): string;
  formatCoins(n: number): string;
  formatDurationSec(sec: number): string;
}

const text = (v: string): Segment => ({ t: 'text', v });
const hl = (v: string | number): Segment => ({ t: 'hl', v });
const mut = (v: string): Segment => ({ t: 'mut', v });
const coin = (v: number): Segment => ({ t: 'coin', v });

/** Splits a translated template on `{slot}` markers and substitutes segments — keeps word order translatable. */
function fill(template: string, slots: Record<string, Segment | Segment[]>): Segment[] {
  const out: Segment[] = [];
  const re = /\{(\w+)\}/g; let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) out.push(text(template.slice(last, m.index)));
    const s = slots[m[1] ?? '']; if (s) out.push(...(Array.isArray(s) ? s : [s])); else out.push(text(m[0]));
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(text(template.slice(last)));
  return out;
}

function petSeg(e: PetActivityEvent, d: DescribeDeps, capital: boolean): Segment[] {
  if (e.pet.name) return [{ t: 'pet', v: e.pet.name }];
  return fill(d.t(capital ? 'feature.petActivity.yourPetCap' : 'feature.petActivity.yourPet'), { species: { t: 'pet', v: d.petSpeciesName(e.pet.species) } });
}
function targetPetSeg(e: PetActivityEvent, d: DescribeDeps): Segment[] {
  const tp = e.targets.find((t) => t.kind === 'pet');
  if (!tp || tp.kind !== 'pet') return [text(d.t('feature.petActivity.itself'))];
  if (tp.pet.name) return [hl(tp.pet.name)];
  return fill(d.t('feature.petActivity.yourPet'), { species: hl(d.petSpeciesName(tp.pet.species)) });
}
const n = (v: EventValue | undefined, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const plural = (d: DescribeDeps, count: number, key: string): string => d.t(`${key}${count === 1 ? 'One' : 'Many'}`, { n: count });

/** Shape-keyed ability templates. Order matters: more specific shapes first. */
function abilitySentence(e: PetActivityEvent, v: Record<string, EventValue>, d: DescribeDeps): Segment[] | null {
  const P = petSeg(e, d, true);
  const has = (...keys: string[]): boolean => keys.every((k) => k in v);
  const crop = e.targets.find((t) => t.kind === 'crop' || t.kind === 'growSlot');
  const cropName = crop && (crop.kind === 'crop' || crop.kind === 'growSlot') ? d.cropName(crop.species) : '';
  const T = (key: string, slots: Record<string, Segment | Segment[]>): Segment[] => fill(d.t(key), { pet: P, ...slots });
  if (has('coinsFound')) return T('feature.petActivity.tpl.coinFinder', { coin: coin(n(v.coinsFound)) });
  if (has('speciesId') && !has('sourceMutation')) return T('feature.petActivity.tpl.seedFinder', { seed: hl(d.seedName(String(v.speciesId))) });
  if (has('hungerRestoreAmount')) return T('feature.petActivity.tpl.hungerRestore', { n: hl(Math.round(n(v.hungerRestoreAmount)).toLocaleString()), target: targetPetSeg(e, d) });
  const noNumbers = !Object.values(v).some((x) => typeof x === 'number');
  if (noNumbers && crop?.kind === 'crop') return T('feature.petActivity.tpl.doubleHarvest', { crop: hl(cropName) });
  if (noNumbers && e.targets.some((t) => t.kind === 'pet')) return T('feature.petActivity.tpl.doubleHatch', { species: targetPetSeg(e, d) });
  if (has('cropsRefundedCount')) return T('feature.petActivity.tpl.produceRefund', { n: hl(plural(d, n(v.cropsRefundedCount), 'feature.petActivity.crops')) });
  if (has('bonusCoins')) return T('feature.petActivity.tpl.sellBoost', { coin: coin(n(v.bonusCoins)) });
  if (has('bonusXp', 'petsAffectedCount')) return T('feature.petActivity.tpl.xpBoost', { n: hl(plural(d, n(v.petsAffectedCount), 'feature.petActivity.pets')), xp: hl(n(v.bonusXp).toLocaleString()) });
  if (has('strengthIncrease')) return T('feature.petActivity.tpl.hatchSizeBoost', { target: targetPetSeg(e, d), n: hl(Math.round(n(v.strengthIncrease))) });
  if (has('bonusXp') && e.targets.some((t) => t.kind === 'pet')) return T('feature.petActivity.tpl.ageBoost', { target: targetPetSeg(e, d), xp: hl(n(v.bonusXp).toLocaleString()) });
  if (e.targets.some((t) => t.kind === 'egg') && !has('secondsReduced')) return T('feature.petActivity.tpl.petRefund', { egg: hl(d.eggName(String(v.eggId))) });
  if (has('secondsReduced', 'eggsAffectedCount')) return T('feature.petActivity.tpl.eggGrowth', { n: hl(plural(d, n(v.eggsAffectedCount), 'feature.petActivity.eggs')), time: hl(d.formatDurationSec(n(v.secondsReduced))) });
  // v1118 flat `sizeIncrease` → +N Size. Legacy `scaleIncreasePercentage` → N%.
  if (has('sizeIncrease', 'numPlantsAffected')) return T('feature.petActivity.tpl.scaleBoostFlat', { n: hl(plural(d, n(v.numPlantsAffected), 'feature.petActivity.crops')), amount: hl(`+${n(v.sizeIncrease).toFixed(0)}`) });
  if (has('scaleIncreasePercentage', 'numPlantsAffected')) return T('feature.petActivity.tpl.scaleBoost', { n: hl(plural(d, n(v.numPlantsAffected), 'feature.petActivity.crops')), pct: hl(`${n(v.scaleIncreasePercentage).toFixed(0)}%`) });
  if (has('secondsReduced', 'numPlantsAffected')) return T('feature.petActivity.tpl.plantGrowth', { n: hl(plural(d, n(v.numPlantsAffected), 'feature.petActivity.plants')), time: hl(d.formatDurationSec(n(v.secondsReduced))) });
  if (has('mutation') && crop?.kind === 'growSlot') {
    // Rain/Snow granters on an already-Frozen crop report the pre-freeze mutation, not Frozen.
    const frozen = (e.action === 'RainDance' || e.action === 'SnowGranter') && crop.mutations.includes('Frozen');
    if (frozen) return T('feature.petActivity.tpl.granterFrozen', { prev: mut(d.mutationName(e.action === 'RainDance' ? 'Chilled' : 'Wet')), crop: hl(cropName), mutation: mut(d.mutationName('Frozen')) });
    return T('feature.petActivity.tpl.granter', { crop: hl(cropName), mutation: mut(d.mutationName(String(v.mutation))) });
  }
  if (has('sellPrice') && crop) return T('feature.petActivity.tpl.produceEater', { crop: hl(cropName), coin: coin(n(v.sellPrice)) });
  if (has('capsulesAdded')) return T('feature.petActivity.tpl.dawnCapture', { removed: hl(n(v.dawnlitRemoved) + n(v.dawnboundRemoved)), n: hl(plural(d, n(v.capsulesAdded), 'feature.petActivity.capsules')) });
  if (has('cropsCharged')) return T('feature.petActivity.tpl.thundercharge', { n: hl(plural(d, n(v.cropsCharged), 'feature.petActivity.crops')), mutation: mut(d.mutationName('Thundercharged')) });
  return null;
}

function fallbackSentence(e: PetActivityEvent, v: Record<string, EventValue>, d: DescribeDeps): Segment[] {
  const out = fill(d.t('feature.petActivity.tpl.generic'), { pet: petSeg(e, d, true), ability: hl(d.abilityName(e.action)) });
  for (const [k, val] of Object.entries(v)) { out.push(text(' · ')); out.push(hl(`${k} ${typeof val === 'number' ? val.toLocaleString() : val}`)); }
  return out;
}

function fixedSentence(e: PetActivityEvent, v: Record<string, EventValue>, d: DescribeDeps): Segment[] {
  const P = petSeg(e, d, false);
  const T = (key: string, slots: Record<string, Segment | Segment[]>): Segment[] => fill(d.t(key), { pet: P, ...slots });
  const crop = e.targets.find((t) => t.kind === 'crop');
  switch (e.kind) {
    case 'feed': {
      // Provisional QPM feeds (id-only path) know neither crop nor hunger until the server entry supersedes them.
      const cropSeg = crop?.kind === 'crop' ? hl(d.cropName(crop.species)) : text('');
      if (typeof v.hungerPct !== 'number') return T('feature.petActivity.tpl.feedPending', { n: hl(n(v.cropsCount, e.targets.length)), crop: cropSeg });
      return T('feature.petActivity.tpl.feed', { n: hl(n(v.cropsCount, e.targets.length)), crop: cropSeg, pct: hl(`+${v.hungerPct}%`) });
    }
    case 'hatch': { const egg = e.targets.find((t) => t.kind === 'egg'); return T('feature.petActivity.tpl.hatch', { egg: hl(egg?.kind === 'egg' ? d.eggName(egg.eggId) : ''), species: hl(d.petSpeciesName(e.pet.species)) }); }
    case 'sell': { const s = T('feature.petActivity.tpl.sell', { coin: coin(n(v.totalValue)) }); if (n(v.sellDust) > 0) s.push(...fill(d.t('feature.petActivity.tpl.sellDust'), { dust: hl(n(v.sellDust).toLocaleString()) })); return s; }
    case 'potion': return e.action === 'xpPotion'
      ? T('feature.petActivity.tpl.xpPotion', { from: hl(n(v.levelBefore)), to: hl(n(v.levelAfter)) })
      : T('feature.petActivity.tpl.hungerPotion', {});
    case 'mount': return T(e.action === 'mount' ? 'feature.petActivity.tpl.mount' : 'feature.petActivity.tpl.dismount', {});
    case 'team': return fill(d.t('feature.petActivity.tpl.team'), { name: hl(String(v.teamName ?? '')), n: hl(n(v.applied)) });
    default: return fallbackSentence(e, v, d);
  }
}

/** Drops empty segments, merges adjacent text and collapses the whitespace runs an empty slot leaves behind. */
function tidy(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.t !== 'xn' && s.v === '') continue;
    const prev = out[out.length - 1];
    if (s.t === 'text' && prev?.t === 'text') prev.v = `${prev.v}${s.v}`;
    else out.push({ ...s });
  }
  for (const s of out) if (s.t === 'text') s.v = String(s.v).replace(/\s{2,}/g, ' ');
  const last = out[out.length - 1];
  if (last?.t === 'text') last.v = String(last.v).replace(/\s+$/, '');
  return out;
}

export function describe(run: ActivityRun, d: DescribeDeps): Described {
  const e = run.events[0]!;
  const v: Record<string, EventValue> = run.events.length > 1 ? { ...e.values, ...run.totals } : e.values;
  const sentence = tidy(e.kind === 'ability' ? (abilitySentence(e, v, d) ?? fallbackSentence(e, v, d)) : fixedSentence(e, v, d));
  if (run.events.length > 1) sentence.push({ t: 'xn', v: run.events.length });
  const meta: string[] = [];
  if (e.kind === 'ability') meta.push(d.abilityName(e.action));
  if (e.kind === 'ability' && !abilitySentence(e, v, d)) { const desc = d.abilityDescription(e.action); if (desc) meta.push(desc); }
  if (e.kind === 'feed' && typeof v.hungerPct === 'number') meta.push(d.t('feature.petActivity.meta.hunger', { pct: n(v.hungerPct) }));
  if (e.cluster) meta.push(d.t('feature.petActivity.meta.gardenWide'));
  return { sentence, meta };
}
