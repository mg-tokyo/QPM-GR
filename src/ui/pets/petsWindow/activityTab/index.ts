import { storage } from '../../../../utils/storage';
import { t } from '../../../../i18n';
import { createEmptyState } from '../../../components/emptyState';
import { createVirtualScrollList, type VirtualScroll } from '../../../../utils/dom/virtualScroll';
import { isSpritesReady, onSpritesReady } from '../../../../sprite-v2/compat';
import { clearPetActivity, getPetActivityRuns, onPetActivityChange, PET_ACTIVITY_UI_KEY, type ActivityRun, type PetActivityEvent } from '../../../../store/petActivity';
import type { PetActivityUiPrefs } from '../../../../store/petActivity/types';
import { buildToolbar, KIND_FILTERS, type FamilyChip } from './toolbar';
import type { SpeciesOption } from './petDropdown';
import { renderRun, subRunOf } from './row';
import { liveDescribeDeps } from './describeLive';
import { ensureActivityStyles } from './styles';

const DEFAULT_PREFS: PetActivityUiPrefs = { kind: 'all', pet: null, families: [], density: 'ledger' };
const ROW_HEIGHT = { ledger: 64, compact: 44 } as const;
type ListItem = { kind: 'day'; label: string } | { kind: 'run'; run: ActivityRun } | { kind: 'sub'; run: ActivityRun; event: PetActivityEvent };

export interface ActivityTabHandle { cleanup(): void; onUnread(cb: (n: number) => void): void; markRead(): void }

function dayLabel(ts: number): string {
  const d = new Date(ts); const now = new Date();
  const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return t('feature.petActivity.today');
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return t('feature.petActivity.yesterday');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function loadPrefs(): PetActivityUiPrefs {
  const raw = storage.get<Partial<PetActivityUiPrefs>>(PET_ACTIVITY_UI_KEY, {});
  return {
    kind: raw.kind ?? DEFAULT_PREFS.kind,
    pet: typeof raw.pet === 'string' ? raw.pet : null,
    families: Array.isArray(raw.families) ? raw.families : [],
    density: raw.density === 'compact' ? 'compact' : 'ledger',
  };
}

export function renderActivityTab(panel: HTMLElement): ActivityTabHandle {
  ensureActivityStyles(panel.ownerDocument);
  const prefs = loadPrefs();
  const savePrefs = (): void => storage.set(PET_ACTIVITY_UI_KEY, prefs);
  const root = document.createElement('div'); root.className = 'qpm-pact'; panel.appendChild(root);
  const listHost = document.createElement('div'); listHost.className = 'qpm-pact__list';
  const expanded = new Set<string>();
  let vs: VirtualScroll | null = null;
  let unread = 0; let unreadCb: ((n: number) => void) | null = null;
  let scrolledAway = false; let pendingNew = 0;
  const newPill = document.createElement('button'); newPill.type = 'button'; newPill.className = 'qpm-pact__newpill'; newPill.hidden = true;

  // Ledger collapses repeat procs into ×N runs; compact lists every event.
  const collapse = (): boolean => prefs.density === 'ledger';
  const passes = (r: ActivityRun): boolean => {
    if (prefs.kind === 'hatchSell') { if (r.kind !== 'hatch' && r.kind !== 'sell') return false; }
    else if (prefs.kind !== 'all' && r.kind !== prefs.kind) return false;
    if (prefs.pet && r.pet.species !== prefs.pet) return false;
    if (prefs.kind === 'ability' && prefs.families.length && !prefs.families.includes(r.family)) return false;
    return true;
  };
  const buildItems = (): { items: ListItem[]; species: SpeciesOption[]; families: FamilyChip[] } => {
    const runs = getPetActivityRuns({ enabled: collapse() });
    const seen = new Map<string, SpeciesOption & { ids: Set<string> }>();
    for (const r of runs) {
      const cur = seen.get(r.pet.species);
      if (cur) { cur.ids.add(r.pet.id); cur.count = cur.ids.size; }
      else seen.set(r.pet.species, { species: r.pet.species, sample: r.pet, count: 1, ids: new Set([r.pet.id]) });
    }
    const fams = new Map<string, FamilyChip>();
    for (const r of runs) if (r.kind === 'ability' && !fams.has(r.family)) fams.set(r.family, { id: r.family, label: liveDescribeDeps.abilityName(r.events[0]!.action).replace(/\s+(?:IV|III|II|I)$/, ''), action: r.events[0]!.action });
    const items: ListItem[] = []; let lastDay = '';
    for (const r of runs) {
      if (!passes(r)) continue;
      const d = dayLabel(r.lastTs); if (d !== lastDay) { items.push({ kind: 'day', label: d }); lastDay = d; }
      items.push({ kind: 'run', run: r });
      if (r.events.length > 1 && expanded.has(r.id)) for (const event of r.events) items.push({ kind: 'sub', run: r, event });
    }
    return { items, species: [...seen.values()].sort((a, b) => a.species.localeCompare(b.species)), families: [...fams.values()] };
  };
  const renderItem = (item: ListItem): HTMLElement => {
    if (item.kind === 'day') { const el = document.createElement('div'); el.className = 'qpm-pact__day'; el.textContent = item.label; return el; }
    if (item.kind === 'sub') return renderRun(subRunOf(item.run, item.event), { density: prefs.density, expanded: false, sub: true, onToggleExpand: () => {} });
    return renderRun(item.run, { density: prefs.density, expanded: expanded.has(item.run.id), onToggleExpand: () => { if (expanded.has(item.run.id)) expanded.delete(item.run.id); else expanded.add(item.run.id); refresh(); } });
  };
  const resetList = (): void => { vs?.destroy(); vs = null; };
  const toolbar = buildToolbar(prefs, {
    onKind: (id) => { prefs.kind = id; savePrefs(); refresh(); },
    onPet: (species) => { prefs.pet = species; savePrefs(); refresh(); },
    onFamilies: (ids) => { prefs.families = ids; savePrefs(); refresh(); },
    onDensity: (v) => { prefs.density = v; expanded.clear(); savePrefs(); resetList(); refresh(); },
    onClear: () => { clearPetActivity(); },
  });
  root.append(toolbar.root, listHost); listHost.appendChild(newPill);

  let currentItems: ListItem[] = [];
  function refresh(): void {
    const { items, species, families } = buildItems();
    currentItems = items;
    toolbar.setSpecies(species);
    toolbar.setFamilies(families, prefs.kind === 'ability');
    if (!items.length) {
      resetList();
      const filterLabel = prefs.kind === 'all' ? '' : t(KIND_FILTERS.find((k) => k.id === prefs.kind)?.key ?? '');
      listHost.replaceChildren(newPill, createEmptyState(t('feature.petActivity.empty', { filter: filterLabel }).replace(/\s+/g, ' ')));
      return;
    }
    if (!vs) { listHost.replaceChildren(newPill); vs = createVirtualScrollList(listHost, items, renderItem, { itemHeight: ROW_HEIGHT[prefs.density] }); }
    else vs.updateItems(items);
  }
  // VirtualScroll owns the scrolling div it appends to listHost; scroll events don't bubble, so listen in capture.
  const scrollEl = (): HTMLElement | null => (vs ? listHost.querySelector<HTMLElement>(':scope > div') : null);
  listHost.addEventListener('scroll', () => { const s = scrollEl(); scrolledAway = !!s && s.scrollTop > 40; if (!scrolledAway) { pendingNew = 0; newPill.hidden = true; } }, true);
  newPill.addEventListener('click', () => { scrollEl()?.scrollTo({ top: 0 }); pendingNew = 0; newPill.hidden = true; });

  const unsub = onPetActivityChange((c) => {
    if (c.cleared) { expanded.clear(); refresh(); return; }
    if (c.added.length) { unread += c.added.length; unreadCb?.(unread); if (scrolledAway) { pendingNew += c.added.length; newPill.textContent = t('feature.petActivity.newPill', { n: pendingNew }); newPill.hidden = false; } }
    refresh();
  });
  // Rows render text immediately; sprite slots fill on the ready signal (compat.ts:28).
  const unsubSprites = isSpritesReady() ? null : onSpritesReady(() => refresh());
  // VirtualScroll sizes its window from clientHeight, so updates that land while the
  // Pets window is hidden render only the buffer rows; re-render when the list gets a height.
  let lastHeight = 0;
  const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    const h = listHost.clientHeight;
    if (h > 0 && lastHeight === 0 && vs) vs.updateItems(currentItems);
    lastHeight = h;
  });
  sizeObserver?.observe(listHost);
  refresh();
  return {
    cleanup() { unsub(); unsubSprites?.(); sizeObserver?.disconnect(); toolbar.dispose(); resetList(); root.remove(); },
    onUnread(cb) { unreadCb = cb; },
    // Also re-renders: updates that arrived while the panel was display:none rendered
    // against a 0px viewport, leaving only the buffer rows until the next scroll.
    markRead() { unread = 0; unreadCb?.(0); refresh(); },
  };
}
