// ALR-10.2: one hub row per catalog charged ability; a recharge edge (readyEdge.ts) raises a
// card per pet, and using the ability or the pet leaving the team closes it.

import { t } from '../../i18n';
import { getPetSpriteDataUrlWithMutations, isSpritesReady } from '../../sprite-v2/compat';
import { getActivePetInfos } from '../../store/pets';
import { raiseAlert, registerAlertRow, type AlertCardHandle, type AlertPayload, type RaiseOptions } from '../alertHub';
import { petIcon, petName } from '../pets/hungerAlarm';
import { getAbilityProjection, getAllAbilityProjections, onAbilityProjectionsRebuilt, type AbilityProjection } from './abilities';
import { onReadyEdge, type ReadyEdgeEvent } from './readyEdge';
import { getChargedReadyIntervalSec, isChargedReadyRepeatOn } from './readySettings';

export const CHARGED_READY_ROW_PREFIX = 'pets.chargedReady.';

export function chargedReadyRowId(abilityId: string): string {
  return `${CHARGED_READY_ROW_PREFIX}${abilityId}`;
}

// A gradient is no valid border colour (ALR-17.2 handoff); the card then keeps its plain border.
function solidColor(color: string | undefined): string | undefined {
  return color && !/gradient\(/i.test(color) ? color : undefined;
}

function openPanel(): void {
  void import('../../ui/chargedAbilities/floatingPanel').then((m) => { m.openChargedAbilitiesPanel(); });
}

/** The live pet carrying the ability, else the catalog species that carries it natively. */
function rowIcon(ability: AbilityProjection): string | null {
  const live = getActivePetInfos().find((p) => p.chargedAbilityId === ability.abilityId && p.species);
  if (live) return petIcon(live) ?? null;
  const species = ability.requiredSpecies[0];
  if (!species || !isSpritesReady()) return null;
  return getPetSpriteDataUrlWithMutations(species, []) || null;
}

export function chargedReadySummary(abilityId: string): string {
  return isChargedReadyRepeatOn(abilityId)
    ? t('feature.chargedReady.summaryRepeat', { sec: getChargedReadyIntervalSec() })
    : t('feature.chargedReady.summary');
}

function raiseOptions(abilityId: string): RaiseOptions {
  return isChargedReadyRepeatOn(abilityId) ? { repeat: { intervalMs: getChargedReadyIntervalSec() * 1000 } } : {};
}

// Lazy so the alarm core never loads window code.
function openSettings(abilityId: string): void {
  void import('../../ui/pets/chargedReadyWindow').then((m) => { m.openChargedReadyWindow(abilityId); });
}

function registerRows(): void {
  for (const ability of getAllAbilityProjections()) {
    const accent = solidColor(ability.accentColor);
    registerAlertRow({
      id: chargedReadyRowId(ability.abilityId),
      group: 'pets',
      labelKey: 'feature.chargedReady.row',
      labelParams: { ability: ability.abilityName },
      defaultSound: 'chime',
      settingsAction: () => openSettings(ability.abilityId),
      icon: () => rowIcon(ability),
      summary: () => chargedReadySummary(ability.abilityId),
      ...(accent ? { accent } : {}),
    });
  }
}

export function buildChargedReadyPayload(event: ReadyEdgeEvent): AlertPayload {
  const ability = getAbilityProjection(event.abilityId);
  const pet = getActivePetInfos().find((p) => p.slotId === event.petSlotId);
  const abilityName = ability?.abilityName ?? event.abilityId;
  const accent = solidColor(ability?.accentColor);
  const icon = pet ? petIcon(pet) : undefined;
  return {
    title: t('feature.chargedReady.title', { name: pet ? petName(pet) : abilityName }),
    body: t('feature.chargedReady.body'),
    cardKey: `chargedReady:${event.key}`,
    chips: [{ text: abilityName, ...(accent ? { color: accent } : {}) }],
    figure: { value: String(event.gardenTargetCount), label: t('feature.chargedReady.targets') },
    actions: [{ label: t('feature.chargedReady.openPanel'), onClick: openPanel }],
    ...(accent ? { accent } : {}),
    ...(icon ? { iconUrl: icon } : {}),
  };
}

const cards = new Map<string, AlertCardHandle>();
const counts = { fired: 0, closed: 0 };
const cleanups: Array<() => void> = [];

function onEdge(event: ReadyEdgeEvent): void {
  if (event.kind === 'stop') {
    const card = cards.get(event.key);
    cards.delete(event.key);
    if (card) {
      counts.closed += 1;
      card.close();
    }
    return;
  }
  counts.fired += 1;
  const card = raiseAlert(chargedReadyRowId(event.abilityId), buildChargedReadyPayload(event), raiseOptions(event.abilityId));
  if (card) cards.set(event.key, card);
}

export function startChargedReadyAlarm(): void {
  if (cleanups.length > 0) return;
  registerRows();
  cleanups.push(onAbilityProjectionsRebuilt(registerRows), onReadyEdge(onEdge));
}

export function stopChargedReadyAlarm(): void {
  for (const fn of cleanups.splice(0)) {
    try { fn(); } catch { /* teardown best-effort */ }
  }
  for (const card of cards.values()) {
    try { card.close(); } catch { /* teardown best-effort */ }
  }
  cards.clear();
}

/** Debug: the card a recharge would raise, through the real row (row off → null). No game state is touched. */
export function previewChargedReadyCard(abilityId: string, petSlotId = '', gardenTargetCount = 0): AlertCardHandle | null {
  const key = `preview:${petSlotId}:${abilityId}`;
  return raiseAlert(chargedReadyRowId(abilityId), buildChargedReadyPayload({ kind: 'fire', key, petSlotId, abilityId, gardenTargetCount }), raiseOptions(abilityId));
}

export function getChargedReadyAlarmDiagnostics(): { started: boolean; openCards: number; fired: number; closed: number; rows: string[] } {
  return {
    started: cleanups.length > 0,
    openCards: cards.size,
    ...counts,
    rows: getAllAbilityProjections().map((a) => chargedReadyRowId(a.abilityId)),
  };
}
