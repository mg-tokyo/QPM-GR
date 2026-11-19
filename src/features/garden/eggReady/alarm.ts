// ALR-11.2: one hub card for every egg come due (PD1): a new batch adds to the open card,
// a hatched egg (gone from the garden) leaves it, and the card closes once none is left.

import { t } from '../../../i18n';
import { getAnySpriteDataUrl, isSpritesReady } from '../../../sprite-v2/compat';
import { getServerNowMs } from '../../../store/serverClock';
import { getEggSafe } from '../../../utils/game/catalogHelpers';
import { isRecord } from '../../../utils/typeGuards';
import { isAlertCardOpen, raiseAlert, registerAlertRow, type AlertCardHandle, type AlertFigure, type AlertPayload, type AlertSprite } from '../../alertHub';
import { getGardenSnapshot, onGardenSnapshot, type GardenSnapshot } from '../bridge';
import { walkEggs, type EggEntry } from './schedule';
import { getEggReadyLeadMinutes } from './settings';

export const EGG_READY_ROW = 'garden.eggReady';
const CARD_KEY = 'eggReady';

function catalogText(eggId: string, field: 'name' | 'sprite'): string | null {
  const entry: unknown = getEggSafe(eggId);
  const v = isRecord(entry) ? entry[field] : undefined;
  return typeof v === 'string' && v ? v : null;
}

const eggName = (eggId: string): string => catalogText(eggId, 'name') ?? eggId;

function eggSprite(eggId: string): string | undefined {
  if (!isSpritesReady()) return undefined;
  return getAnySpriteDataUrl(catalogText(eggId, 'sprite')) || undefined;
}

/** Egg kinds in the order they came due, with how many of each. */
export function groupEggs(eggs: readonly EggEntry[]): Array<{ eggId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of eggs) counts.set(e.eggId, (counts.get(e.eggId) ?? 0) + 1);
  return Array.from(counts, ([eggId, count]) => ({ eggId, count }));
}

function cardBody(groups: ReadonlyArray<{ eggId: string; count: number }>): string {
  return groups.map((g) => (g.count > 1 ? t('feature.eggReady.nameCount', { name: eggName(g.eggId), count: g.count }) : eggName(g.eggId))).join(' · ');
}

// With a lead time the card opens before its eggs are ready: count down to the last one instead of
// showing the count. The card ticks on the local clock; maturedAt is server time.
function cardFigure(eggs: readonly EggEntry[]): AlertFigure {
  const now = getServerNowMs() ?? Date.now();
  const lastReadyAt = eggs.reduce((max, e) => Math.max(max, e.maturedAt), 0);
  if (lastReadyAt > now) return { countdownTo: Date.now() + (lastReadyAt - now), label: t('feature.eggReady.figureSoon') };
  return { value: String(eggs.length), label: t('feature.eggReady.figure') };
}

export function buildEggReadyPayload(eggs: readonly EggEntry[]): AlertPayload {
  const groups = groupEggs(eggs);
  const sprites: AlertSprite[] = [];
  for (const g of groups) {
    const url = eggSprite(g.eggId);
    if (url) sprites.push({ url, ...(g.count > 1 ? { count: g.count } : {}) });
  }
  const icon = sprites[0]?.url;
  return {
    title: t('feature.eggReady.title'),
    body: cardBody(groups),
    cardKey: CARD_KEY,
    figure: cardFigure(eggs),
    ...(sprites.length > 1 ? { sprites } : {}),
    ...(icon ? { iconUrl: icon } : {}),
  };
}

const onCard = new Map<string, EggEntry>();
let handle: AlertCardHandle | null = null;
let cleanups: Array<() => void> = [];
const counts = { batches: 0, hatched: 0, closedEmpty: 0 };

function onBatch(batch: readonly EggEntry[]): void {
  counts.batches += 1;
  if (!isAlertCardOpen(CARD_KEY)) {
    onCard.clear();
    handle = null;
  }
  for (const egg of batch) onCard.set(egg.key, egg);
  const card = raiseAlert(EGG_READY_ROW, buildEggReadyPayload([...onCard.values()]));
  if (card) handle = card;
  else onCard.clear();
}

// A null garden is a gap in the feed (index.ts keeps the schedule across it), not a hatch.
function onSnapshot(snapshot: GardenSnapshot): void {
  if (!snapshot || onCard.size === 0) return;
  if (!isAlertCardOpen(CARD_KEY)) {
    onCard.clear();
    handle = null;
    return;
  }
  const present = new Set(walkEggs(snapshot).map((e) => e.key));
  let removed = 0;
  for (const key of Array.from(onCard.keys())) {
    if (present.has(key)) continue;
    onCard.delete(key);
    removed += 1;
  }
  if (removed === 0) return;
  counts.hatched += removed;
  if (onCard.size === 0) {
    counts.closedEmpty += 1;
    const h = handle;
    handle = null;
    h?.close();
    return;
  }
  const next = buildEggReadyPayload([...onCard.values()]);
  handle?.update({ body: next.body ?? '', ...(next.figure ? { figure: next.figure } : {}) });
}

function rowIcon(): string | null {
  const first = walkEggs(getGardenSnapshot())[0];
  return first ? eggSprite(first.eggId) ?? null : null;
}

export function eggReadySummary(): string {
  const lead = getEggReadyLeadMinutes();
  return lead === 0 ? t('feature.eggReady.summary') : t('feature.eggReady.summaryLead', { min: lead });
}

// Lazy so the alarm core never loads window code.
function openEggReadySettings(): void {
  void import('../../../ui/garden/eggReadyWindow').then((m) => { m.openEggReadyWindow(); });
}

/** Started and stopped by the egg schedule (index.ts), which hands over its batch feed. */
export function startEggReadyAlarm(subscribeBatches: (cb: (batch: EggEntry[]) => void) => () => void): void {
  if (cleanups.length > 0) return;
  registerAlertRow({
    id: EGG_READY_ROW,
    group: 'garden',
    labelKey: 'feature.eggReady.row',
    defaultSound: 'chime',
    settingsAction: openEggReadySettings,
    icon: rowIcon,
    summary: eggReadySummary,
  });
  cleanups = [subscribeBatches(onBatch), onGardenSnapshot(onSnapshot)];
}

export function stopEggReadyAlarm(): void {
  for (const fn of cleanups) {
    try { fn(); } catch { /* teardown best-effort */ }
  }
  cleanups = [];
  const h = handle;
  handle = null;
  onCard.clear();
  try { h?.close(); } catch { /* teardown best-effort */ }
}

export function getEggReadyAlarmState(): { started: boolean; cardOpen: boolean; onCard: string[]; batches: number; hatched: number; closedEmpty: number } {
  return { started: cleanups.length > 0, cardOpen: isAlertCardOpen(CARD_KEY), onCard: [...onCard.keys()], ...counts };
}
