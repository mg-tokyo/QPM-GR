import { readSync } from '../../core/gameState';
import type { QuinoaInventoryItem, QuinoaUserSlotData } from '../../types/gameAtoms';
import { isRecord } from '../../utils/typeGuards';
import type { AllowedKind } from './allowlist';
import type { LiveView } from './rules';
import type { FixtureSnapshot, SnapPet, SnapStackKind } from './types';

type StackItemType = { kind: Exclude<SnapStackKind, 'unknown'>; idField: string };

// literal-list-justified: wire item-type table (inventory itemType → snapshot kind + its id field).
const STACK_ITEM_TYPES: Readonly<Record<string, StackItemType>> = {
  Seed: { kind: 'seed', idField: 'species' },
  Egg: { kind: 'egg', idField: 'eggId' },
  Tool: { kind: 'tool', idField: 'toolId' },
  Decor: { kind: 'decor', idField: 'decorId' },
};
const PET_ITEM_TYPE = 'Pet';
const CROP_ITEM_TYPE = 'Produce';

type Located = { item: QuinoaInventoryItem; inStorage: boolean };
type Stack = FixtureSnapshot['stacks'][number];

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const byKey = <T>(key: (v: T) => string) => (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

function itemsOf(data: QuinoaUserSlotData): Located[] {
  const inv = data.inventory;
  const out: Located[] = (inv?.items ?? []).map((item) => ({ item, inStorage: false }));
  for (const storage of inv?.storages ?? []) {
    for (const item of storage.items ?? []) out.push({ item, inStorage: true });
  }
  return out;
}

function stackOf(item: QuinoaInventoryItem): Stack | null {
  const type = str(item.itemType);
  if (type === PET_ITEM_TYPE || type === CROP_ITEM_TYPE) return null;
  const quantity = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
  const known = type ? STACK_ITEM_TYPES[type] : undefined;
  const id = known ? str(item[known.idField]) : null;
  if (known && id) return { kind: known.kind, id, quantity };
  // Fail closed: an unclassifiable item still shows up, so its disappearance is a diff.
  return { kind: 'unknown', id: `${type ?? '?'}:${str(item.id) ?? JSON.stringify(item)}`, quantity };
}

function petsOf(data: QuinoaUserSlotData, located: Located[]): SnapPet[] {
  const pets: SnapPet[] = [];
  const push = (raw: unknown, location: SnapPet['location']): void => {
    if (!isRecord(raw)) return;
    const id = str(raw.id);
    if (id) pets.push({ id, species: str(raw.petSpecies) ?? '?', name: str(raw.name), location });
  };
  for (const slot of data.petSlots ?? []) push(slot, 'active');
  for (const { item, inStorage } of located) {
    if (item.itemType === PET_ITEM_TYPE) push(item, inStorage ? 'hutch' : 'inventory');
  }
  return pets.sort(byKey((p) => p.id));
}

function teamsOf(data: QuinoaUserSlotData): FixtureSnapshot['teams'] {
  const raw = Array.isArray(data.petTeams) ? (data.petTeams as unknown[]) : [];
  const teams: FixtureSnapshot['teams'] = [];
  for (const t of raw) {
    const id = isRecord(t) ? str(t.id) : null;
    if (!isRecord(t) || !id) continue;
    const members = Array.isArray(t.members) ? (t.members as unknown[]) : [];
    // Member order is kept: reordering a saved team is a team change.
    teams.push({ id, petIds: members.map((m) => (isRecord(m) ? str(m.petId) ?? '?' : '?')) });
  }
  return teams.sort(byKey((t) => t.id));
}

function gardenOf(data: QuinoaUserSlotData): FixtureSnapshot['garden'] {
  const garden = isRecord(data.garden) ? data.garden : {};
  const out: FixtureSnapshot['garden'] = [];
  const add = (group: unknown, prefix: string): void => {
    if (!isRecord(group)) return;
    for (const [key, obj] of Object.entries(group)) {
      if (!isRecord(obj)) continue;
      const planted = obj.plantedAt;
      out.push({
        slot: `${prefix}${key}`,
        objectType: str(obj.objectType) ?? '?',
        id: str(obj.species) ?? str(obj.eggId) ?? str(obj.decorId),
        objectId: typeof planted === 'number' || typeof planted === 'string' ? String(planted) : null,
      });
    }
  };
  add(garden.tileObjects, '');
  add(garden.boardwalkTileObjects, 'boardwalk:');
  add(garden.edgeObjects, 'edge:');
  return out.sort(byKey((g) => g.slot));
}

/** Only fields an action changes; growth, hunger, xp, mutations and timers are left out. */
export function buildSnapshot(data: QuinoaUserSlotData, takenAt: Date): FixtureSnapshot {
  const coins = data.coinsCount;
  if (typeof coins !== 'number' || !Number.isFinite(coins)) throw new Error('fixture snapshot: coins unavailable');
  const located = itemsOf(data);
  const stacks = new Map<string, Stack>();
  const crops: FixtureSnapshot['crops'] = [];
  for (const { item } of located) {
    if (item.itemType === CROP_ITEM_TYPE) {
      const id = str(item.id);
      if (id) crops.push({ id, species: str(item.species) ?? '?' });
      continue;
    }
    const stack = stackOf(item);
    if (!stack) continue;
    const key = `${stack.kind}:${stack.id}`;
    const prev = stacks.get(key);
    if (prev) prev.quantity += stack.quantity;
    else stacks.set(key, stack);
  }
  const favs = data.inventory?.favoritedItemIds ?? [];
  return {
    takenAt: takenAt.toISOString(),
    coins,
    stacks: [...stacks.values()].sort(byKey((s) => `${s.kind}:${s.id}`)),
    crops: crops.sort(byKey((c) => c.id)),
    favoritedItemIds: favs.filter((f): f is string => typeof f === 'string').sort(),
    pets: petsOf(data, located),
    teams: teamsOf(data),
    garden: gardenOf(data),
  };
}

export function readFixtureData(): QuinoaUserSlotData | null {
  return readSync('myData');
}

export function takeFixtureSnapshot(): FixtureSnapshot {
  const data = readFixtureData();
  if (!data) throw new Error('fixture snapshot: no seat data');
  return buildSnapshot(data, new Date());
}

export function petIdsOf(data: QuinoaUserSlotData): Set<string> {
  return new Set(petsOf(data, itemsOf(data)).map((p) => p.id));
}

export function createLiveView(data: QuinoaUserSlotData): LiveView {
  const located = itemsOf(data);
  const tiles = isRecord(data.garden) && isRecord(data.garden.tileObjects) ? data.garden.tileObjects : {};
  const coins = typeof data.coinsCount === 'number' && Number.isFinite(data.coinsCount) ? data.coinsCount : 0;
  const crops = located.filter(({ item }) => item.itemType === CROP_ITEM_TYPE).map(({ item }) => item);
  const pets = petIdsOf(data);
  return {
    coins,
    stackQty(kind: AllowedKind, id: string): number {
      if (kind === 'crop') return crops.filter((c) => c.species === id).length;
      let total = 0;
      for (const { item } of located) {
        const stack = stackOf(item);
        if (stack && stack.kind === kind && stack.id === id) total += stack.quantity;
      }
      return total;
    },
    slotEmpty: (slot) => !Object.prototype.hasOwnProperty.call(tiles, slot),
    cropSpecies: (itemId) => str(crops.find((c) => c.id === itemId)?.species),
    isPetItem: (itemId) => pets.has(itemId),
  };
}
