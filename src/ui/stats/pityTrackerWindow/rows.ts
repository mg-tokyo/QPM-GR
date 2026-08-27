import { t } from '../../../i18n';
import { createProgressBar, createSectionHeader } from '../../components';
import {
  getPityOutcomes,
  isPityDue,
  parsePityCounterKey,
  pityLaunchFloor,
  type PityOutcome,
  type PityProximity,
} from '../../../catalogs/pityThresholds';
import type { PityTrackerState } from '../../../store/pityTracker';
import { timeAgo } from '../statsHubWindow/styleHelpers';
import {
  PROXIMITY_RANK,
  fillStyle,
  formatChance,
  itemName,
  makeSpriteEl,
  outcomeName,
  outcomeProgress,
  proximityColor,
  spriteUrl,
  type PityRowModel,
} from './shared';

/** Manual expand/collapse choices for the session; rows without an entry follow the observed-only default. */
const rowExpandedOverride = new Map<string, boolean>();

function makeDuePill(): HTMLElement {
  const pill = document.createElement('span');
  pill.style.cssText = [
    'font-size:10px',
    'font-weight:var(--qpm-weight-semibold)',
    'color:var(--qpm-positive)',
    'background:var(--qpm-surface-3)',
    'border-radius:var(--qpm-radius-pill)',
    'padding:0 6px',
    'line-height:1.6',
    'white-space:nowrap',
    'flex-shrink:0',
  ].join(';');
  pill.textContent = t('feature.pity.guaranteedNext');
  return pill;
}

function buildOutcomeRow(row: PityRowModel, outcome: PityOutcome, state: PityTrackerState): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  const { counter, observed, estimate, proximity, gap, corrected } = outcomeProgress(row, outcome, state);

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;';

  const label = document.createElement('span');
  label.style.cssText = 'color:var(--qpm-text);min-width:0;';
  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'font-weight:var(--qpm-weight-semibold);';
  nameEl.textContent = outcomeName(outcome);
  const detail = document.createElement('span');
  detail.style.cssText = 'color:var(--qpm-text-muted);margin-left:6px;';
  const guaranteed = t('feature.pity.guaranteedBy', {
    chance: formatChance(outcome.chance),
    threshold: outcome.thresholdPulls.toLocaleString(),
  });
  detail.textContent = row.kind === 'egg' && outcome.roll === 'species' ? `${t('feature.pity.rarestPet')} · ${guaranteed}` : guaranteed;
  label.append(nameEl, detail);

  const right = document.createElement('span');
  right.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';
  if (proximity === 'due') right.appendChild(makeDuePill());

  const value = document.createElement('span');
  value.style.cssText = 'font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--qpm-text-muted);';
  if (observed && counter) {
    value.style.color = proximityColor(proximity) ?? 'var(--qpm-text)';
    value.style.fontWeight = 'var(--qpm-weight-semibold)';
    let text = t('feature.pity.observedMisses', { misses: counter.misses.toLocaleString() });
    const titles: string[] = [];
    const numbers = { count: estimate.toLocaleString(), threshold: outcome.thresholdPulls.toLocaleString() };
    if (gap > 0) {
      text += ` · ${t('feature.pity.estimateApprox', numbers)}`;
      titles.push(t('feature.pity.gapTitle', { gap: gap.toLocaleString() }));
    } else if (estimate > counter.misses) {
      text += ` · ${t('feature.pity.estimate', numbers)}`;
    }
    if (estimate > counter.misses) {
      titles.push(t('feature.pity.estimateTitle', {
        floor: pityLaunchFloor(outcome.thresholdPulls, state.account?.createdAt ?? null).toLocaleString(),
      }));
    }
    if (corrected) titles.push(t('feature.pity.correctedTitle'));
    if (counter.lastHitAt) titles.push(t('feature.pity.lastHit', { when: timeAgo(counter.lastHitAt) }));
    value.title = titles.join('\n');
    value.textContent = text;
  } else {
    value.textContent = t('feature.pity.notObserved');
  }
  right.appendChild(value);
  head.append(label, right);
  el.appendChild(head);

  const bar = createProgressBar({ value: estimate, max: outcome.thresholdPulls, height: 4, ...fillStyle(outcome, proximity) });
  el.appendChild(bar.root);
  return el;
}

function collapsedSummary(row: PityRowModel, state: PityTrackerState): { text: string; color: string | null } {
  const parts: string[] = [];
  let best: PityProximity = 'far';
  for (const outcome of row.outcomes) {
    const p = outcomeProgress(row, outcome, state);
    if (!p.observed) continue;
    parts.push(t('feature.pity.collapsedSummary', {
      outcome: outcomeName(outcome),
      misses: p.estimate.toLocaleString(),
      threshold: outcome.thresholdPulls.toLocaleString(),
    }));
    if (PROXIMITY_RANK[p.proximity] > PROXIMITY_RANK[best]) best = p.proximity;
  }
  if (parts.length === 0) return { text: t('feature.pity.notObserved'), color: null };
  return { text: parts.join(' · '), color: proximityColor(best) };
}

export function buildItemRow(row: PityRowModel, state: PityTrackerState): HTMLElement {
  const rowKey = `${row.kind}:${row.id}`;
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 0;border-bottom:1px solid var(--qpm-border);';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer;user-select:none;';
  head.appendChild(makeSpriteEl(row.spriteUrl, 24));
  const name = document.createElement('div');
  name.style.cssText = 'flex:1;font-size:12px;font-weight:var(--qpm-weight-semibold);color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  name.textContent = row.name;
  name.title = row.name;
  head.appendChild(name);

  const summary = document.createElement('span');
  summary.style.cssText = 'font-size:12px;font-variant-numeric:tabular-nums;color:var(--qpm-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
  const summaryModel = collapsedSummary(row, state);
  summary.textContent = summaryModel.text;
  summary.title = summaryModel.text;
  if (summaryModel.color) summary.style.color = summaryModel.color;
  head.appendChild(summary);

  const chevron = document.createElement('button');
  chevron.style.cssText = [
    'background:none',
    'border:none',
    'color:var(--qpm-text-muted)',
    'cursor:pointer',
    'font-size:12px',
    'padding:2px 4px',
    'line-height:1',
    'flex-shrink:0',
    'transition:transform 0.15s ease',
  ].join(';');
  head.appendChild(chevron);

  const outcomes = document.createElement('div');
  outcomes.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding-left:32px;min-width:0;';
  for (const outcome of row.outcomes) outcomes.appendChild(buildOutcomeRow(row, outcome, state));

  let expanded = rowExpandedOverride.get(rowKey) ?? row.observed;
  const applyExpanded = (): void => {
    outcomes.style.display = expanded ? 'flex' : 'none';
    summary.style.display = expanded ? 'none' : '';
    chevron.textContent = expanded ? '▾' : '▸';
    chevron.title = expanded ? t('feature.pity.collapseRow') : t('feature.pity.expandRow');
    chevron.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
  };
  const toggle = (): void => {
    expanded = !expanded;
    rowExpandedOverride.set(rowKey, expanded);
    applyExpanded();
  };
  applyExpanded();
  head.addEventListener('click', toggle);
  chevron.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

  el.append(head, outcomes);
  return el;
}

/** Observed hits with the estimate held at the time — the only available sanity check on the model. */
export function buildHitLog(state: PityTrackerState): HTMLElement | null {
  if (state.hits.length === 0) return null;
  const section = document.createElement('div');
  section.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
  section.appendChild(createSectionHeader(t('feature.pity.hitsHeader'), { badge: state.hits.length }).root);

  for (const hit of [...state.hits].reverse()) {
    const parsed = parsePityCounterKey(hit.key);
    if (!parsed) continue;
    const outcome = getPityOutcomes({ kind: parsed.kind, id: parsed.itemId }).find((o) => o.outcomeId === parsed.outcomeId);
    const atGuarantee = isPityDue(hit.estimate, hit.thresholdPulls);

    const line = document.createElement('div');
    line.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--qpm-border);font-size:12px;min-width:0;';
    line.appendChild(makeSpriteEl(spriteUrl(parsed.kind, parsed.itemId), 20));

    const name = document.createElement('span');
    name.style.cssText = 'flex:1;color:var(--qpm-text);font-weight:var(--qpm-weight-semibold);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.textContent = `${itemName(parsed.kind, parsed.itemId)} · ${outcome ? outcomeName(outcome) : parsed.outcomeId}`;

    const status = document.createElement('span');
    status.style.cssText = `font-variant-numeric:tabular-nums;white-space:nowrap;color:${atGuarantee ? 'var(--qpm-positive)' : 'var(--qpm-text-muted)'};`;
    // The hit itself is pull estimate+1 since the last reset.
    status.textContent = t(atGuarantee ? 'feature.pity.hitAtGuarantee' : 'feature.pity.hitEarly', {
      pull: (hit.estimate + 1).toLocaleString(),
      threshold: hit.thresholdPulls.toLocaleString(),
    });

    const when = document.createElement('span');
    when.style.cssText = 'color:var(--qpm-text-muted);font-size:10px;white-space:nowrap;';
    when.textContent = timeAgo(hit.at);

    line.append(name, status, when);
    section.appendChild(line);
  }
  return section;
}
