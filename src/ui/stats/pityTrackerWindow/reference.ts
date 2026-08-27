import { t } from '../../../i18n';
import { createSectionHeader } from '../../components';
import { getPlantSpeciesSafe as getAllPlantSpecies } from '../../../utils/game/catalogHelpers';
import {
  RARE_PATCH_VARIANTS,
  getPityCapsuleIds,
  getPityEggIds,
  getPityOutcomes,
  isRareVariantSpecies,
  type PityKind,
  type PityOutcome,
} from '../../../catalogs/pityThresholds';
import { cropName, formatChance, itemName, makeSpriteEl, outcomeName, spriteUrl } from './shared';

function outcomeList(outcomes: PityOutcome[]): string {
  return outcomes
    .map((o) => t('feature.pity.refOutcomeBy', { outcome: outcomeName(o), threshold: o.thresholdPulls.toLocaleString() }))
    .join(' · ');
}

function guaranteedBy(outcome: PityOutcome): string {
  return `${outcomeName(outcome)} ${t('feature.pity.guaranteedBy', {
    chance: formatChance(outcome.chance),
    threshold: outcome.thresholdPulls.toLocaleString(),
  })}`;
}

function makeLine(sprite: string | null, name: string, detail: string): HTMLElement {
  const line = document.createElement('div');
  line.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--qpm-border);font-size:12px;min-width:0;';
  if (sprite !== null) line.appendChild(makeSpriteEl(sprite, 20));
  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'color:var(--qpm-text);font-weight:var(--qpm-weight-semibold);white-space:nowrap;';
  nameEl.textContent = name;
  const detailEl = document.createElement('span');
  detailEl.style.cssText = 'flex:1;color:var(--qpm-text-muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;';
  detailEl.textContent = detail;
  detailEl.title = detail;
  line.append(nameEl, detailEl);
  return line;
}

function makeNote(text: string): HTMLElement {
  const note = document.createElement('div');
  note.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);padding:6px 0;';
  note.textContent = text;
  return note;
}

function makeSection(titleKey: string, badge: number): HTMLElement {
  const section = document.createElement('div');
  section.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
  section.appendChild(createSectionHeader(t(titleKey), { badge }).root);
  return section;
}

function sharedMutationOutcomes(kind: PityKind, ids: string[]): PityOutcome[] {
  const first = ids[0];
  return first ? getPityOutcomes({ kind, id: first }).filter((o) => o.roll === 'mutation') : [];
}

/** Static threshold reference: one line per egg/capsule, shared lines for what every item has in common. */
export function buildReferenceTab(): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

  const eggIds = getPityEggIds();
  const eggs = makeSection('feature.pity.sectionEggs', eggIds.length);
  const eggShared = sharedMutationOutcomes('egg', eggIds);
  if (eggShared.length > 0) eggs.appendChild(makeNote(t('feature.pity.refAllEggs', { list: outcomeList(eggShared) })));
  // Every egg's species guarantee is its single rarest pet; thresholds are identical unless the catalog says otherwise.
  const rarest = eggIds.map((id) => ({ id, outcomes: getPityOutcomes({ kind: 'egg', id }).filter((o) => o.roll === 'species') }));
  const thresholds = new Set(rarest.flatMap((r) => r.outcomes.map((o) => o.thresholdPulls)));
  const commonThreshold = thresholds.size === 1 ? [...thresholds][0] ?? null : null;
  if (commonThreshold !== null) {
    eggs.appendChild(makeNote(t('feature.pity.refRarestIntro', { threshold: commonThreshold.toLocaleString() })));
  }
  for (const { id, outcomes } of rarest) {
    const detail = outcomes
      .map((o) => (commonThreshold !== null ? `${outcomeName(o)} · ${formatChance(o.chance)}` : guaranteedBy(o)))
      .join(' · ');
    eggs.appendChild(makeLine(spriteUrl('egg', id), itemName('egg', id), detail));
  }
  root.appendChild(eggs);

  const plantIds = getAllPlantSpecies().filter((id) => !isRareVariantSpecies(id));
  const plants = makeSection('feature.pity.sectionSeeds', plantIds.length);
  const plantShared = sharedMutationOutcomes('seed', plantIds);
  if (plantShared.length > 0) {
    plants.appendChild(makeNote(t('feature.pity.refAllPlants', { count: plantIds.length, list: outcomeList(plantShared) })));
  }
  for (const patch of Object.keys(RARE_PATCH_VARIANTS)) {
    const variant = getPityOutcomes({ kind: 'seed', id: patch }).find((o) => o.roll === 'variant');
    if (!variant) continue;
    plants.appendChild(makeLine(
      spriteUrl('seed', patch),
      t('feature.pity.refVariant', { patch: cropName(patch), variant: outcomeName(variant) }),
      t('feature.pity.guaranteedBy', { chance: formatChance(variant.chance), threshold: variant.thresholdPulls.toLocaleString() }),
    ));
  }
  plants.appendChild(makeNote(t('feature.pity.refFixedSpots')));
  root.appendChild(plants);

  const capsuleIds = getPityCapsuleIds();
  if (capsuleIds.length > 0) {
    const capsules = makeSection('feature.pity.sectionCapsules', capsuleIds.length);
    for (const id of capsuleIds) {
      const outcomes = getPityOutcomes({ kind: 'capsule', id });
      capsules.appendChild(makeLine(spriteUrl('capsule', id), itemName('capsule', id), outcomes.map(guaranteedBy).join(' · ')));
    }
    root.appendChild(capsules);
  }

  return root;
}
