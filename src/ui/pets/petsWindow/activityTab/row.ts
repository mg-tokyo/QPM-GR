import { t } from '../../../../i18n';
import { renderAbilitySquares, getAbilityColor } from '../../../../utils/rendering/petCardRenderer';
import { createMutationBadge } from '../../../components/mutationBadge';
import { withPetStr, type ActivityRun, type PetActivityEvent, type PetSnap, type TargetSnap } from '../../../../store/petActivity';
import { describe, type Segment } from './describe';
import { liveDescribeDeps } from './describeLive';
import { petSizeRatio, petSpriteUrl, targetSpriteUrl } from './sprites';

export interface RowOptions { density: 'ledger' | 'compact'; expanded: boolean; sub?: boolean; onToggleExpand(): void }
const MAX_TARGET_SPRITES = 4;

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function strPart(snap: PetSnap): string {
  const pet = withPetStr(snap);
  if (pet.str == null) return '–';
  return pet.maxStr != null && pet.maxStr !== pet.str ? `${pet.str}/${pet.maxStr}` : `${pet.str}`;
}
export function strLabel(snap: PetSnap): string {
  return `STR: ${strPart(snap)}`;
}
function teamPets(e: PetActivityEvent): PetSnap[] {
  const pets = e.targets.filter((t): t is Extract<TargetSnap, { kind: 'pet' }> => t.kind === 'pet').map((t) => t.pet).slice(0, 3);
  return pets.length ? pets : [e.pet];
}
/** A single member of a run, shaped as its own run so the row renderer can draw it. */
export function subRunOf(run: ActivityRun, sub: PetActivityEvent): ActivityRun {
  return { ...run, id: sub.id, pet: sub.pet, events: [sub], totals: {}, firstTs: sub.ts, lastTs: sub.ts };
}
function segNode(s: Segment): Node {
  switch (s.t) {
    case 'text': return document.createTextNode(String(s.v));
    case 'pet': case 'hl': { const b = document.createElement('b'); b.textContent = String(s.v); return b; }
    case 'mut': return createMutationBadge(String(s.v), { size: 'compact' });
    case 'coin': { const span = document.createElement('span'); span.className = 'qpm-pact__coin';
      const url = targetSpriteUrl({ kind: 'coin' });
      if (url) { const img = document.createElement('img'); img.alt = ''; img.src = url; span.appendChild(img); }
      span.appendChild(document.createTextNode(Number(s.v).toLocaleString())); return span; }
    case 'xn': { const span = document.createElement('span'); span.className = 'qpm-pact__xn'; span.textContent = `×${s.v}`; return span; }
  }
}
function spriteCell(url: string, title: string): HTMLElement {
  const c = document.createElement('div'); c.className = 'qpm-pact__c'; c.title = title;
  if (url) { const img = document.createElement('img'); img.alt = ''; img.src = url; c.appendChild(img); }
  return c;
}
function targetsBlock(e: PetActivityEvent): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'qpm-pact__tgt';
  const list = e.cluster ?? e.targets;
  const shown = list.slice(0, e.cluster ? 3 : MAX_TARGET_SPRITES);
  if (e.cluster) wrap.classList.add('qpm-pact__tgt--arch');
  for (const t of shown) wrap.appendChild(spriteCell(targetSpriteUrl(t), t.kind === 'pet' ? t.pet.species : 'species' in t ? t.species : t.kind));
  const extra = (e.clusterTotal ?? list.length) - shown.length;
  if (extra > 0) { const m = document.createElement('div'); m.className = 'qpm-pact__more'; m.textContent = `+${extra}`; wrap.appendChild(m); }
  return wrap;
}
function petBlock(run: ActivityRun, size: number): HTMLElement {
  const wrap = document.createElement('div'); wrap.className = 'qpm-pact__pet';
  const first = run.events[0]!;
  if (first.kind === 'team') {
    // A team apply shows the whole team (≤3) as an arch instead of one pet + STR.
    const team = document.createElement('div'); team.className = 'qpm-pact__team qpm-pact__arch';
    for (const p of teamPets(first)) team.appendChild(spriteCell(petSpriteUrl(p), p.name ?? p.species));
    wrap.appendChild(team);
    return wrap;
  }
  // renderAbilitySquares builds markup from catalog colour strings + ability ids only (no user text).
  const squares = document.createElement('div'); squares.className = 'qpm-pact__squares'; squares.innerHTML = renderAbilitySquares(run.pet.abilities, 8); wrap.appendChild(squares);
  const spr = document.createElement('div'); spr.className = 'qpm-pact__spr';
  const url = petSpriteUrl(run.pet);
  if (url) { const img = document.createElement('img'); img.alt = ''; img.src = url; const px = Math.round(size * (0.75 + 0.25 * petSizeRatio(run.pet))); img.style.width = `${px}px`; img.style.height = `${px}px`; spr.appendChild(img); }
  wrap.appendChild(spr);
  const chip = document.createElement('span'); chip.className = 'qpm-pact__str';
  chip.textContent = strLabel(run.pet);
  wrap.appendChild(chip);
  return wrap;
}
export function renderRun(run: ActivityRun, opts: RowOptions): HTMLElement {
  const e = run.events[0]!;
  const compact = opts.density === 'compact';
  const row = document.createElement('div');
  row.className = `qpm-pact__row${compact ? ' qpm-pact__row--compact' : ''}${opts.expanded ? ' qpm-pact__row--expanded' : ''}${opts.sub ? ' qpm-pact__row--sub' : ''}`;
  row.dataset.runId = run.id;
  const { sentence, meta } = describe(run, liveDescribeDeps);
  row.appendChild(petBlock(run, compact ? 32 : opts.sub ? 36 : 44));
  const txt = document.createElement('div'); txt.className = 'qpm-pact__txt';
  const sent = document.createElement('div'); sent.className = 'qpm-pact__sent';
  for (const s of sentence) sent.appendChild(segNode(s));
  if (e.kind === 'team') {
    // The per-pet tag is too wide for the pet column, so it rides the sentence line instead.
    const chip = document.createElement('span'); chip.className = 'qpm-pact__str qpm-pact__str--inline';
    chip.textContent = t('feature.petActivity.teamStr', { list: teamPets(e).map(strPart).join(' | ') });
    sent.appendChild(chip);
  }
  txt.appendChild(sent);
  if (meta.length || e.kind === 'ability') {
    const m = document.createElement('div'); m.className = 'qpm-pact__meta';
    if (e.kind === 'ability') { const fam = document.createElement('span'); fam.className = 'qpm-pact__fam'; const dot = document.createElement('i'); dot.style.background = getAbilityColor(e.action).base; fam.append(dot, document.createTextNode(meta.shift() ?? e.family)); m.appendChild(fam); }
    for (const line of meta) { const s = document.createElement('span'); s.textContent = line; m.appendChild(s); }
    if (run.events.length > 1) { const s = document.createElement('span'); s.textContent = `${fmtTime(run.firstTs)} – ${fmtTime(run.lastTs)}`; m.appendChild(s); }
    txt.appendChild(m);
    if (compact) row.title = meta.join(' · ');
  }
  row.appendChild(txt);
  row.appendChild(e.kind === 'team' ? document.createElement('div') : targetsBlock(e));
  const time = document.createElement('div'); time.className = 'qpm-pact__time'; time.textContent = fmtTime(run.lastTs); time.title = new Date(run.lastTs).toLocaleString(); row.appendChild(time);
  if (run.events.length > 1 && !opts.sub) {
    row.classList.add('qpm-pact__row--group');
    row.addEventListener('click', () => opts.onToggleExpand());
  }
  return row;
}
