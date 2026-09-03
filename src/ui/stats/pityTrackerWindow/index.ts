import { t } from '../../../i18n';
import { createEmptyState, createSectionHeader, createTabBar, createToggle } from '../../components';
import {
  areCatalogsReady,
  getPlantSpeciesSafe as getAllPlantSpecies,
  onCatalogsReady,
} from '../../../utils/game/catalogHelpers';
import {
  PITY_LAUNCH_TS,
  getPityCapsuleIds,
  getPityEggIds,
  isRareVariantSpecies,
  type PityKind,
} from '../../../catalogs/pityThresholds';
import {
  getPityAccountError,
  isPityKindEnabled,
  setPityKindEnabled,
  subscribePity,
  subscribePityEnabled,
  type PityTrackerState,
} from '../../../store/pityTracker';
import { buildReferenceTab } from './reference';
import { buildHitLog, buildItemRow } from './rows';
import { buildRows, type PityRowModel } from './shared';

const GUIDE_KEYS = ['feature.pity.guide1', 'feature.pity.guide2', 'feature.pity.guide3'] as const;

type TabId = 'tracking' | 'reference';

function accountChipText(state: PityTrackerState): string {
  const createdAt = state.account?.createdAt ?? null;
  if (createdAt === null) return t('feature.pity.accountUnknown');
  const date = new Date(createdAt).toLocaleDateString();
  return t(createdAt < PITY_LAUNCH_TS ? 'feature.pity.accountPreLaunch' : 'feature.pity.accountPostLaunch', { date });
}

const TRACK_KINDS: ReadonlyArray<{ kind: PityKind; labelKey: `feature.pity.${string}` }> = [
  { kind: 'seed', labelKey: 'feature.pity.trackSeeds' },
  { kind: 'egg', labelKey: 'feature.pity.trackEggs' },
  { kind: 'capsule', labelKey: 'feature.pity.trackCapsules' },
];

function buildTrackToggles(): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:11px;';

  const label = document.createElement('span');
  label.textContent = t('feature.pity.trackLabel');
  label.style.cssText = 'color:var(--qpm-text-muted);font-weight:var(--qpm-weight-semibold);';
  row.appendChild(label);

  for (const { kind, labelKey } of TRACK_KINDS) {
    const toggle = createToggle({
      size: 'compact',
      checked: isPityKindEnabled(kind),
      label: t(labelKey),
      onChange: (checked) => { setPityKindEnabled(kind, checked); },
    });
    row.appendChild(toggle.root);
  }

  return row;
}

function buildHeader(onAccountChip: (el: HTMLElement) => void): HTMLElement {
  const strip = document.createElement('div');
  strip.style.cssText = [
    'padding:8px 12px',
    'font-size:12px',
    'color:var(--qpm-text-muted)',
    'border-bottom:1px solid var(--qpm-border)',
    'flex-shrink:0',
    'display:flex',
    'flex-direction:column',
    'gap:6px',
  ].join(';');

  const lead = document.createElement('div');
  lead.textContent = t('feature.pity.lead', { date: new Date(PITY_LAUNCH_TS).toLocaleDateString() });

  const chip = document.createElement('span');
  chip.style.cssText = [
    'align-self:flex-start',
    'font-size:10px',
    'font-weight:var(--qpm-weight-semibold)',
    'color:var(--qpm-text)',
    'background:var(--qpm-surface-3)',
    'border-radius:var(--qpm-radius-pill)',
    'padding:0 8px',
    'line-height:1.8',
    'white-space:nowrap',
  ].join(';');
  onAccountChip(chip);

  const guide = document.createElement('div');
  guide.style.cssText = 'display:none;flex-direction:column;gap:4px;font-size:10px;padding:4px 0 2px;';
  for (const key of GUIDE_KEYS) {
    const item = document.createElement('div');
    item.textContent = t(key, { date: new Date(PITY_LAUNCH_TS).toLocaleDateString() });
    guide.appendChild(item);
  }
  const guideHeader = createSectionHeader(t('feature.pity.howItWorks'), {
    size: 'compact',
    collapsible: true,
    collapsed: true,
    onToggle: (collapsed) => { guide.style.display = collapsed ? 'none' : 'flex'; },
  });

  strip.append(lead, chip, buildTrackToggles(), guideHeader.root, guide);
  return strip;
}

export function renderPityTrackerContent(container: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  let activeTab: TabId = 'tracking';
  let currentState: PityTrackerState | null = null;
  let accountChip: HTMLElement | null = null;
  let referenceEl: HTMLElement | null = null;

  container.appendChild(buildHeader((chip) => { accountChip = chip; }));

  const tabRow = document.createElement('div');
  tabRow.style.cssText = 'padding:8px 12px 0;flex-shrink:0;';
  const tabs = createTabBar(
    [{ id: 'tracking', label: t('feature.pity.tabTracking') }, { id: 'reference', label: t('feature.pity.tabReference') }],
    { defaultTab: 'tracking', onChange: (id) => { activeTab = id === 'reference' ? 'reference' : 'tracking'; render(); } },
  );
  tabRow.appendChild(tabs.root);
  container.appendChild(tabRow);

  const scroll = document.createElement('div');
  scroll.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';
  const body = document.createElement('div');
  body.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:16px;';
  scroll.appendChild(body);
  container.appendChild(scroll);

  function trackedRows(state: PityTrackerState): PityRowModel[] {
    const seedIds = getAllPlantSpecies().filter((id) => !isRareVariantSpecies(id));
    const rows: PityRowModel[] = [];
    if (isPityKindEnabled('egg')) rows.push(...buildRows('egg', getPityEggIds(), state));
    if (isPityKindEnabled('seed')) rows.push(...buildRows('seed', seedIds, state));
    if (isPityKindEnabled('capsule')) rows.push(...buildRows('capsule', getPityCapsuleIds(), state));
    return rows
      .filter((row) => row.observed)
      .sort((a, b) => b.progress - a.progress || a.name.localeCompare(b.name));
  }

  function renderTracking(state: PityTrackerState): void {
    const rows = trackedRows(state);
    tabs.setBadge('tracking', rows.length);
    if (rows.length === 0) {
      body.appendChild(createEmptyState(t('feature.pity.trackingEmpty')));
    } else {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
      for (const row of rows) list.appendChild(buildItemRow(row, state));
      body.appendChild(list);
    }
    const hits = buildHitLog(state);
    if (hits) body.appendChild(hits);
  }

  function render(): void {
    body.replaceChildren();
    const state = currentState;
    if (!state) return;
    if (accountChip) {
      accountChip.textContent = accountChipText(state);
      const error = state.account?.createdAt == null ? getPityAccountError() : null;
      accountChip.title = error ? t('feature.pity.accountError', { error }) : '';
    }
    if (!areCatalogsReady()) {
      body.appendChild(createEmptyState(t('feature.pity.catalogsLoading')));
      return;
    }
    if (activeTab === 'reference') {
      referenceEl ??= buildReferenceTab();
      body.appendChild(referenceEl);
      return;
    }
    renderTracking(state);
  }

  cleanups.push(subscribePity((state) => {
    currentState = state;
    render();
  }));
  cleanups.push(subscribePityEnabled(() => { render(); }));
  if (!areCatalogsReady()) cleanups.push(onCatalogsReady(() => { referenceEl = null; render(); }));

  return () => {
    for (const fn of cleanups.splice(0)) {
      try { fn(); } catch { /* already torn down */ }
    }
  };
}
