// src/ui/xpTracker/nearMaxSection.ts — Near-max-level section with swap picker

import { log } from '../../utils/logger';
import { type ActivePetInfo } from '../../store/pets';
import { readAtomValue } from '../../core/atomRegistry';
import { getPetSpriteDataUrlWithMutations } from '../../sprite-v2/compat';
import { getSpeciesXpPerLevel, calculateMaxStrength } from '../../store/xpTracker';
import { formatCoins } from '../../features/economy/valueCalculator';
import { swapPetIntoActiveSlot, placePetIntoActiveSlot, type SwapPetFailureReason } from '../../features/petSwap';
import { makePillButton } from './xpTrackerContent';
import { t } from '../../i18n';
import { createEmptyState } from '../components/emptyState';

// ============================================================================
// TYPES
// ============================================================================

export interface NearMaxState {
  expandedPetKey: string | null;
  busyPetKey: string | null;
  status: { key: string; text: string; tone: 'success' | 'error' | 'info' } | null;
  statusTimer: number | null;
}

interface PetWithLevel {
  name: string;
  species: string;
  mutations: string[];
  level: number;
  xp: number;
  maxStr: number;
  xpNeeded: number;
  xpPerLevel: number;
  source: 'active' | 'inventory' | 'hutch';
  itemId: string | null;
  storageId: string | null;
  activeSlotId: string | null;
}

// Module-level filter state — no window globals
const nearMaxSources = new Set<'active' | 'inventory' | 'hutch'>(['active', 'inventory', 'hutch']);

// ============================================================================
// HELPERS
// ============================================================================

function parseMaxLevelFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const match = name.match(/\((\d+)\)/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

/** Format total minutes into a compact human-readable string */
function formatTime(totalMinutes: number): string {
  if (totalMinutes >= 1440) {
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function splitMutationTokens(value: string): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const tokens = /[,|/;]/.test(trimmed) ? trimmed.split(/[,|/;]/g) : [trimmed];
  return tokens.map((token) => token.trim()).filter((token) => token.length > 0 && /[a-z]/i.test(token));
}

function collectMutationNames(value: unknown, out: string[], seen = new WeakSet<object>(), depth = 0): void {
  if (value == null || depth > 4) return;
  if (typeof value === 'string') {
    out.push(...splitMutationTokens(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMutationNames(item, out, seen, depth + 1);
    }
    return;
  }
  if (value instanceof Set) {
    collectMutationNames(Array.from(value.values()), out, seen, depth + 1);
    return;
  }
  if (value instanceof Map) {
    collectMutationNames(Array.from(value.values()), out, seen, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  collectMutationNames(record.mutation, out, seen, depth + 1);
  collectMutationNames(record.mutations, out, seen, depth + 1);

  const descriptorKeys = new Set(['id', 'name', 'displayName', 'label', 'value', 'variant', 'key', 'type', 'slug', '__typename']);
  const isDescriptorObject = keys.length > 0 && keys.every((key) => descriptorKeys.has(key));
  if (isDescriptorObject) {
    const namedFields = [record.name, record.displayName, record.label, record.value, record.variant, record.key, record.id];
    for (const field of namedFields) {
      if (typeof field === 'string') {
        out.push(...splitMutationTokens(field));
      }
    }
  } else {
    const isFlagMap =
      keys.length > 0 &&
      keys.length <= 8 &&
      keys.every((key) => typeof record[key] === 'boolean' || typeof record[key] === 'number');
    if (isFlagMap) {
      for (const key of keys) {
        const flag = record[key];
        if (flag) {
          out.push(...splitMutationTokens(key));
        }
      }
    }
  }
}

function extractItemMutations(entry: Record<string, unknown>): string[] {
  const out: string[] = [];
  collectMutationNames(entry.mutation, out);
  collectMutationNames(entry.mutations, out);
  const rawEntry = entry.raw;
  if (rawEntry && typeof rawEntry === 'object') {
    const rawRecord = rawEntry as Record<string, unknown>;
    collectMutationNames(rawRecord.mutation, out);
    collectMutationNames(rawRecord.mutations, out);
    const rawNestedPet = rawRecord.pet;
    if (rawNestedPet && typeof rawNestedPet === 'object') {
      const petRecord = rawNestedPet as Record<string, unknown>;
      collectMutationNames(petRecord.mutation, out);
      collectMutationNames(petRecord.mutations, out);
    }
  }
  const nestedPet = entry.pet;
  if (nestedPet && typeof nestedPet === 'object') {
    const petRecord = nestedPet as Record<string, unknown>;
    collectMutationNames(petRecord.mutation, out);
    collectMutationNames(petRecord.mutations, out);
  }
  const deduped = new Map<string, string>();
  for (const name of out) {
    const key = name.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, name);
    }
  }
  return Array.from(deduped.values());
}

function normalizeId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function extractItemId(entry: Record<string, unknown>): string | null {
  const nestedPet = entry.pet && typeof entry.pet === 'object'
    ? (entry.pet as Record<string, unknown>)
    : null;
  const nestedRaw = entry.raw && typeof entry.raw === 'object'
    ? (entry.raw as Record<string, unknown>)
    : null;
  const nestedRawPet = nestedRaw?.pet && typeof nestedRaw.pet === 'object'
    ? (nestedRaw.pet as Record<string, unknown>)
    : null;

  const candidates = [
    normalizeId(entry.id),
    normalizeId(entry.itemId),
    normalizeId(entry.petId),
    normalizeId(entry.slotId),
    normalizeId(nestedPet?.id),
    normalizeId(nestedPet?.itemId),
    normalizeId(nestedPet?.petId),
    normalizeId(nestedRaw?.id),
    normalizeId(nestedRaw?.itemId),
    normalizeId(nestedRaw?.petId),
    normalizeId(nestedRawPet?.id),
    normalizeId(nestedRawPet?.itemId),
    normalizeId(nestedRawPet?.petId),
  ];
  return candidates.find((value): value is string => Boolean(value)) ?? null;
}

function extractStorageId(entry: Record<string, unknown>): string | null {
  const nestedStorage = entry.storage && typeof entry.storage === 'object'
    ? (entry.storage as Record<string, unknown>)
    : null;
  const nestedRaw = entry.raw && typeof entry.raw === 'object'
    ? (entry.raw as Record<string, unknown>)
    : null;
  const nestedRawStorage = nestedRaw?.storage && typeof nestedRaw.storage === 'object'
    ? (nestedRaw.storage as Record<string, unknown>)
    : null;

  const candidates = [
    normalizeId(entry.storageId),
    normalizeId(entry.storageID),
    normalizeId(entry.storageType),
    normalizeId(nestedStorage?.id),
    normalizeId(nestedStorage?.storageId),
    normalizeId(nestedRaw?.storageId),
    normalizeId(nestedRaw?.storageID),
    normalizeId(nestedRawStorage?.id),
    normalizeId(nestedRawStorage?.storageId),
  ];
  return candidates.find((value): value is string => Boolean(value)) ?? null;
}

function getNearMaxPetKey(pet: PetWithLevel): string {
  const idPart = pet.itemId ?? `${pet.species}:${pet.xp}:${pet.level}:${pet.maxStr}`;
  return `${pet.source}:${idPart}`;
}

function mapSwapErrorReason(reason: SwapPetFailureReason | undefined): string {
  switch (reason) {
    case 'missing_connection':
      return t('feature.xpTracker.swapNoConnection');
    case 'missing_ids':
      return t('feature.xpTracker.swapNoIds');
    case 'retrieve_failed_or_inventory_full':
      return t('feature.xpTracker.swapInvFull');
    case 'swap_failed_or_timeout':
      return t('feature.xpTracker.swapTimeout');
    default:
      return t('feature.xpTracker.swapFailed');
  }
}

function setNearMaxStatus(
  state: NearMaxState,
  key: string,
  text: string,
  tone: 'success' | 'error' | 'info',
  onUpdate: () => void,
): void {
  state.status = { key, text, tone };
  if (state.statusTimer != null) {
    window.clearTimeout(state.statusTimer);
  }
  state.statusTimer = window.setTimeout(() => {
    state.status = null;
    state.statusTimer = null;
    onUpdate();
  }, 2600);
}

// ============================================================================
// GET ALL PETS (active + inventory + hutch)
// ============================================================================

async function getAllPets(activePets: ActivePetInfo[]): Promise<PetWithLevel[]> {
  const allPets: PetWithLevel[] = [];

  // Active pets
  for (const pet of activePets) {
    if (!pet.species || pet.xp === null || pet.strength === null) continue;
    const xpPerLevel = getSpeciesXpPerLevel(pet.species);
    if (!xpPerLevel) continue;
    const levelsGained = Math.min(30, Math.floor(pet.xp / xpPerLevel));
    const hatchLevel = pet.strength - levelsGained;
    const maxStr = Math.min(hatchLevel + 30, 100);
    if (pet.strength >= maxStr) continue;
    const xpToNext = pet.xp % xpPerLevel;
    const levelsLeft = maxStr - pet.strength;
    const xpNeeded = (xpPerLevel - xpToNext) + xpPerLevel * (levelsLeft - 1);
    allPets.push({
      name: pet.name || pet.species,
      species: pet.species,
      mutations: Array.isArray(pet.mutations) ? [...pet.mutations] : [],
      level: pet.strength,
      xp: pet.xp,
      maxStr,
      xpNeeded,
      xpPerLevel,
      source: 'active',
      itemId: normalizeId(pet.petId) ?? normalizeId(pet.slotId),
      storageId: null,
      activeSlotId: normalizeId(pet.slotId) ?? normalizeId(pet.petId),
    });
  }

  function extractAtomItems(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.items)) return record.items;
    }
    return [];
  }

  const processItems = (items: unknown[], source: 'inventory' | 'hutch') => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      const nested = (i.pet && typeof i.pet === 'object') ? i.pet as Record<string, unknown> : null;

      const species = (i.petSpecies ?? i.species ?? nested?.petSpecies ?? nested?.species) as string | undefined;

      if (source === 'inventory') {
        const itemType = String(i.itemType ?? i.type ?? '').toLowerCase();
        if (!itemType.includes('pet') && !species) continue;
      }

      if (!species) continue;

      const xp = (i.xp ?? nested?.xp) as number | null | undefined;
      if (xp == null) continue;

      const mutations = extractItemMutations(i);
      const xpPerLevel = getSpeciesXpPerLevel(species);
      if (!xpPerLevel) continue;

      const rawStrength = (i.strength ?? nested?.strength) as number | null | undefined;
      const rawTargetScale = (i.targetScale ?? nested?.targetScale) as number | null | undefined;

      let currentStr: number, maxStr: number;
      if (rawStrength != null) {
        currentStr = rawStrength;
        const levelsGained = Math.min(30, Math.floor(xp / xpPerLevel));
        maxStr = Math.min(currentStr - levelsGained + 30, 100);
      } else if (rawTargetScale != null) {
        const calcMax = calculateMaxStrength(rawTargetScale, species);
        maxStr = calcMax ?? 100;
        currentStr = (maxStr - 30) + Math.min(30, Math.floor(xp / xpPerLevel));
      } else {
        const parsedMax = parseMaxLevelFromName((i.name ?? nested?.name) as string | undefined);
        if (!parsedMax || parsedMax < 80 || parsedMax > 100) continue;
        maxStr = parsedMax;
        currentStr = (maxStr - 30) + Math.min(30, Math.floor(xp / xpPerLevel));
      }

      if (currentStr >= maxStr) continue;
      const xpToNext = xp % xpPerLevel;
      const levelsLeft = maxStr - currentStr;
      const xpNeeded = (xpPerLevel - xpToNext) + xpPerLevel * (levelsLeft - 1);
      allPets.push({
        name: ((i.name ?? nested?.name) as string | undefined) || species,
        species,
        mutations,
        level: currentStr,
        xp,
        maxStr,
        xpNeeded,
        xpPerLevel,
        source,
        itemId: extractItemId(i),
        storageId: source === 'hutch' ? extractStorageId(i) : null,
        activeSlotId: null,
      });
    }
  };

  try {
    const invData = await readAtomValue('petInventory') ?? await readAtomValue('inventory');
    if (invData != null) {
      processItems(extractAtomItems(invData as unknown), 'inventory');
    }
  } catch (e) { log('⚠️ Near max: inventory read failed', e); }

  try {
    const hutchData = await readAtomValue('hutchPets');
    if (hutchData != null) {
      processItems(extractAtomItems(hutchData as unknown), 'hutch');
    }
  } catch (e) { log('⚠️ Near max: hutch read failed', e); }

  return allPets;
}

// ============================================================================
// RENDER NEAR-MAX SECTION
// ============================================================================

export function renderNearMaxSection(
  container: HTMLElement,
  state: NearMaxState,
  latestPets: ActivePetInfo[],
  totalTeamXpPerHour: number,
): void {
  void updateNearMaxDisplay(container, state, latestPets, totalTeamXpPerHour);
}

async function updateNearMaxDisplay(
  container: HTMLElement,
  state: NearMaxState,
  latestPets: ActivePetInfo[],
  totalTeamXpPerHour: number,
): Promise<void> {
  try {
    const allPets = (await getAllPets(latestPets))
      .sort((a, b) => a.xpNeeded - b.xpNeeded)
      .slice(0, 50);

    const observedSlotIndexes = Array.from(new Set(
      latestPets
        .map((pet) => pet.slotIndex)
        .filter((value) => Number.isFinite(value))
    )).sort((a, b) => a - b);
    const slotIndexes: number[] = observedSlotIndexes.length > 0
      ? observedSlotIndexes.slice(0, 3)
      : [0, 1, 2];
    let fallbackSlotIndex = slotIndexes.length > 0 ? Math.max(...slotIndexes) + 1 : 0;
    while (slotIndexes.length < 3) {
      if (!slotIndexes.includes(fallbackSlotIndex)) {
        slotIndexes.push(fallbackSlotIndex);
      }
      fallbackSlotIndex += 1;
    }

    const activeSlots = slotIndexes.map((slotIndex, visualIndex) => {
      const activePet = latestPets.find((p) => p.slotIndex === slotIndex) ?? null;
      const targetSlotId = normalizeId(activePet?.slotId) ?? normalizeId(activePet?.petId);
      return { slotIndex, visualIndex: visualIndex + 1, activePet, targetSlotId };
    });
    const hasAnySlot = activeSlots.length > 0;

    container.innerHTML = '';

    const filterRow = document.createElement('div');
    filterRow.style.cssText = 'display:flex;gap:6px;padding:10px 14px 4px;flex-wrap:wrap;align-items:center;';

    const filterLbl = document.createElement('span');
    filterLbl.textContent = t('feature.xpTracker.show');
    filterLbl.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);';
    filterRow.appendChild(filterLbl);

    const sourceDefs: Array<{ key: 'active' | 'inventory' | 'hutch'; label: string }> = [
      { key: 'active', label: t('feature.xpTracker.filterActive') },
      { key: 'inventory', label: t('feature.xpTracker.filterInventory') },
      { key: 'hutch', label: t('feature.xpTracker.filterHutch') },
    ];

    const triggerRerender = (): void => {
      renderNearMaxSection(container, state, latestPets, totalTeamXpPerHour);
    };

    for (const sourceDef of sourceDefs) {
      const btn = makePillButton(sourceDef.label, nearMaxSources.has(sourceDef.key));
      btn.addEventListener('click', () => {
        if (nearMaxSources.has(sourceDef.key)) {
          nearMaxSources.delete(sourceDef.key);
        } else {
          nearMaxSources.add(sourceDef.key);
        }
        triggerRerender();
      });
      filterRow.appendChild(btn);
    }
    container.appendChild(filterRow);

    const filtered = allPets.filter((pet) => nearMaxSources.has(pet.source)).slice(0, 10);
    if (filtered.length === 0) {
      const text = allPets.length === 0
        ? t('feature.xpTracker.noNearMax')
        : t('feature.xpTracker.noFilterMatch');
      container.appendChild(createEmptyState(text));
      return;
    }

    const nearMaxColHeader = document.createElement('div');
    nearMaxColHeader.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 14px 4px;border-bottom:1px solid rgba(255,255,255,0.06);';
    const nmchSpacer = document.createElement('div');
    nmchSpacer.style.cssText = 'width:20px;flex-shrink:0;';
    const nmchName = document.createElement('span');
    nmchName.textContent = t('feature.xpTracker.colPet');
    nmchName.style.cssText = 'flex:1;font-size:9px;color:var(--qpm-text-muted);';
    const nmchBar = document.createElement('div');
    nmchBar.style.cssText = 'width:56px;flex-shrink:0;';
    const nmchLvl = document.createElement('span');
    nmchLvl.textContent = t('feature.xpTracker.colLevel');
    nmchLvl.style.cssText = 'width:44px;text-align:right;font-size:9px;color:var(--qpm-text-muted);flex-shrink:0;';
    const nmchTime = document.createElement('span');
    nmchTime.textContent = t('feature.xpTracker.colToMax');
    nmchTime.style.cssText = 'min-width:56px;text-align:right;font-size:9px;color:var(--qpm-text-muted);flex-shrink:0;';
    const nmchAction = document.createElement('span');
    nmchAction.textContent = t('feature.xpTracker.colAction');
    nmchAction.style.cssText = 'width:58px;text-align:right;font-size:9px;color:var(--qpm-text-muted);flex-shrink:0;';
    nearMaxColHeader.append(nmchSpacer, nmchName, nmchBar, nmchLvl, nmchTime, nmchAction);
    container.appendChild(nearMaxColHeader);

    const list = document.createElement('div');
    list.style.cssText = 'padding:4px 14px 12px;display:flex;flex-direction:column;gap:6px;';
    const sourceIcons = { active: 'A', inventory: 'I', hutch: 'H' } as const;

    for (const pet of filtered) {
      const petKey = getNearMaxPetKey(pet);
      const canSwap = (pet.source === 'inventory' || pet.source === 'hutch') && Boolean(pet.itemId) && hasAnySlot;
      const isExpanded = canSwap && state.expandedPetKey === petKey;
      const isBusy = state.busyPetKey === petKey;
      const hasBusyOperation = state.busyPetKey !== null;

      const rowShell = document.createElement('div');
      rowShell.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';

      const img = document.createElement('img');
      img.src = getPetSpriteDataUrlWithMutations(pet.species, pet.mutations ?? []) ?? '';
      img.dataset.qpmSprite = `pet:${pet.species}`;
      img.alt = pet.species;
      img.style.cssText = 'width:20px;height:20px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';

      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'flex:1;min-width:0;font-size:12px;color:var(--qpm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      nameEl.textContent = `${sourceIcons[pet.source]} ${pet.name}`;

      const totalXpForRange = pet.xpPerLevel * (pet.maxStr - pet.level);
      const xpDone = totalXpForRange - pet.xpNeeded;
      const pct = Math.max(0, Math.min(100, (xpDone / totalXpForRange) * 100));
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'width:56px;flex-shrink:0;';
      const track = document.createElement('div');
      track.style.cssText = 'height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;';
      const fill = document.createElement('div');
      fill.style.cssText = `width:${pct.toFixed(0)}%;height:100%;background:var(--qpm-accent);border-radius:3px;`;
      track.appendChild(fill);
      barWrap.appendChild(track);

      const lvlEl = document.createElement('div');
      lvlEl.textContent = `${pet.level}->${pet.maxStr}`;
      lvlEl.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);font-family:monospace;flex-shrink:0;width:44px;text-align:right;';

      const xpRate = pet.source === 'active' ? totalTeamXpPerHour : 3600;
      const minsToMax = xpRate > 0 ? (pet.xpNeeded / xpRate) * 60 : 0;
      const timeEl = document.createElement('div');
      timeEl.textContent = xpRate > 0 ? formatTime(minsToMax) : '--';
      timeEl.style.cssText = 'font-size:12px;color:var(--qpm-warning);font-family:monospace;flex-shrink:0;min-width:56px;text-align:right;';

      const actionWrap = document.createElement('div');
      actionWrap.style.cssText = 'width:58px;display:flex;justify-content:flex-end;flex-shrink:0;';

      if (canSwap) {
        const swapButton = document.createElement('button');
        swapButton.type = 'button';
        swapButton.textContent = isBusy ? t('feature.xpTracker.swapping') : t('feature.xpTracker.swap');
        swapButton.disabled = hasBusyOperation;
        swapButton.style.cssText = [
          'min-height:24px',
          'padding:0 10px',
          'border-radius:999px',
          'border:1px solid rgba(255,255,255,0.2)',
          'font-size:12px',
          `background:${isExpanded ? 'var(--qpm-accent)' : 'rgba(255,255,255,0.08)'}`,
          `color:${isExpanded ? '#fff' : 'var(--qpm-text)'}`,
          `cursor:${hasBusyOperation ? 'not-allowed' : 'pointer'}`,
          `opacity:${hasBusyOperation ? '0.65' : '1'}`,
        ].join(';');
        swapButton.addEventListener('click', () => {
          if (hasBusyOperation) return;
          state.expandedPetKey = isExpanded ? null : petKey;
          triggerRerender();
        });
        actionWrap.appendChild(swapButton);
      }

      row.append(img, nameEl, barWrap, lvlEl, timeEl, actionWrap);
      rowShell.appendChild(row);

      if (isExpanded && canSwap) {
        const picker = document.createElement('div');
        picker.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding-left:28px;';

        for (const slot of activeSlots) {
          const targetSlotId = slot.targetSlotId;
          const slotPet = slot.activePet;
          const slotDisabled = hasBusyOperation || !pet.itemId;
          const slotButton = document.createElement('button');
          slotButton.type = 'button';
          slotButton.disabled = slotDisabled;
          slotButton.style.cssText = [
            'min-height:44px',
            'display:flex',
            'align-items:center',
            'gap:6px',
            'padding:6px 8px',
            'border-radius:8px',
            `border:1px solid ${slotDisabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.2)'}`,
            `background:${slotDisabled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)'}`,
            `color:${slotDisabled ? 'var(--qpm-text-muted)' : 'var(--qpm-text)'}`,
            `cursor:${slotDisabled ? 'not-allowed' : 'pointer'}`,
          ].join(';');

          const slotNumber = document.createElement('span');
          slotNumber.textContent = String(slot.visualIndex);
          slotNumber.style.cssText = 'font-size:10px;font-family:monospace;min-width:10px;color:var(--qpm-text-muted);';
          slotButton.appendChild(slotNumber);

          if (slotPet?.species) {
            const slotImg = document.createElement('img');
            slotImg.src = getPetSpriteDataUrlWithMutations(slotPet.species, slotPet.mutations ?? []) ?? '';
            slotImg.dataset.qpmSprite = `pet:${slotPet.species}`;
            slotImg.alt = slotPet.species;
            slotImg.style.cssText = 'width:18px;height:18px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
            slotButton.appendChild(slotImg);
          } else {
            const slotSpacer = document.createElement('span');
            slotSpacer.style.cssText = 'width:18px;height:18px;display:inline-block;flex-shrink:0;';
            slotButton.appendChild(slotSpacer);
          }

          const slotName = document.createElement('span');
          slotName.textContent = (slotPet?.name || slotPet?.species || t('feature.xpTracker.empty')).slice(0, 14);
          slotName.style.cssText = 'font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;';
          slotButton.appendChild(slotName);

          slotButton.addEventListener('click', async () => {
            if (state.busyPetKey || !pet.itemId) return;

            state.busyPetKey = petKey;
            triggerRerender();

            if (pet.source !== 'hutch' && pet.source !== 'inventory') return;

            const result = targetSlotId
              ? await swapPetIntoActiveSlot({
                  source: pet.source,
                  itemId: pet.itemId,
                  targetSlotId,
                  storageId: pet.source === 'hutch' ? pet.storageId : null,
                })
              : await placePetIntoActiveSlot({
                  source: pet.source,
                  itemId: pet.itemId,
                  storageId: pet.source === 'hutch' ? pet.storageId : null,
                });

            state.busyPetKey = null;
            if (result.ok) {
              state.expandedPetKey = null;
              setNearMaxStatus(state, petKey, t('feature.xpTracker.swapSuccess'), 'success', triggerRerender);
            } else {
              state.expandedPetKey = petKey;
              setNearMaxStatus(state, petKey, mapSwapErrorReason(result.reason), 'error', triggerRerender);
            }
            triggerRerender();
          });

          picker.appendChild(slotButton);
        }

        rowShell.appendChild(picker);
      }

      if (state.status?.key === petKey) {
        const statusEl = document.createElement('div');
        statusEl.textContent = state.status.text;
        const tone = state.status.tone;
        statusEl.style.cssText = [
          'padding-left:28px',
          'font-size:12px',
          `color:${tone === 'success'
            ? 'var(--qpm-positive)'
            : tone === 'error'
              ? 'var(--qpm-danger)'
              : 'var(--qpm-text-muted)'}`,
        ].join(';');
        rowShell.appendChild(statusEl);
      }

      list.appendChild(rowShell);
    }

    container.appendChild(list);
  } catch (e) {
    log('Near max update failed', e);
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'padding:12px 14px;color:var(--qpm-danger);font-size:12px;';
    errDiv.textContent = t('feature.xpTracker.nearMaxError');
    container.innerHTML = '';
    container.appendChild(errDiv);
  }
}
