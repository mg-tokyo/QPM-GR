import { getSlotOwnerId } from '../../../core/slotOwner';
import { isRecord } from '../../../utils/typeGuards';
import { humanizeAction } from './barModel';

/** Catalog lookups, injected so the model stays pure; null when the id is unknown to that catalog. */
export interface CardNames {
  /** Seeds (by plant species), eggs, tools and decor, by their catalog id. */
  itemName(id: string): string | null;
  petName(species: string): string | null;
  cropName(species: string): string | null;
  plantName(species: string): string | null;
  /** Null when the id is no ability (most log actions name an ability or a game action). */
  abilityName(id: string): string | null;
  /** coinsToFullyReplenishHunger: hunger is stored in the same units. */
  hungerCap(species: string): number | null;
}

/** title null = an entry whose action the card cannot name (the UI shows a generic word). */
export interface ActivityLine { title: string | null; detail: string; at: number }

export interface PetTile { id: string; species: string; label: string; mutations: string[]; abilities: string[]; hungerPct: number | null }

export type HeldItem =
  | { kind: 'none' }
  | { kind: 'catalog'; id: string; name: string }
  | { kind: 'pet'; species: string; mutations: string[]; name: string }
  | { kind: 'crop'; species: string; mutations: string[]; name: string }
  | { kind: 'plant'; species: string; slotMutations: string[][]; name: string }
  | { kind: 'unknown' };

export interface CardModel {
  riding: string | null;
  pets: PetTile[];
  held: HeldItem;
  lines: ActivityLine[];
  /** The log list the lines came from: passed back in, an unchanged list reuses them. */
  logs: unknown;
  coins: number | null;
  dust: number | null;
}

const MAX_MENTIONS = 2;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function petLabel(pet: Record<string, unknown>, species: string, names: CardNames): string {
  return str(pet.name) ?? names.petName(species) ?? species;
}

// A log entry's parameters carry no labels (live 1448: purchaseSeed { speciesIds }, HungerRestoreII { pet, targetPet },
// SeedFinderIII { pet, speciesId }), so any value a catalog can name is shown, in the order the game wrote them.
function mentionOf(v: unknown, names: CardNames): string | null {
  if (typeof v === 'string') return names.itemName(v);
  if (!isRecord(v)) return null;
  const petSpecies = str(v.petSpecies);
  if (petSpecies) return petLabel(v, petSpecies, names);
  const species = str(v.species);
  return species ? names.cropName(species) : null;
}

function listMention(list: readonly unknown[], names: CardNames): string | null {
  const counts = new Map<string, number>();
  for (const x of list) {
    const m = mentionOf(x, names);
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const parts = [...counts].slice(0, MAX_MENTIONS).map(([m, n]) => (n > 1 ? `${m} ×${n}` : m));
  return parts.length > 0 ? parts.join(', ') : null;
}

function detailOf(params: unknown, names: CardNames): string {
  if (!isRecord(params)) return '';
  const out = new Set<string>();
  for (const v of Object.values(params)) {
    const m = Array.isArray(v) ? listMention(v, names) : mentionOf(v, names);
    if (m) out.add(m);
    if (out.size === MAX_MENTIONS) break;
  }
  return [...out].join(' · ');
}

/** The newest `max` log entries (userSlots[i].data.activityLogs, oldest first in the game's list), newest first. */
export function activityLines(logs: unknown, names: CardNames, max: number): ActivityLine[] {
  if (!Array.isArray(logs)) return [];
  const timed: Array<{ e: Record<string, unknown>; at: number }> = [];
  for (const e of logs) {
    const at = isRecord(e) ? num(e.timestamp) : null;
    if (isRecord(e) && at !== null) timed.push({ e, at });
  }
  timed.sort((a, b) => b.at - a.at);
  return timed.slice(0, max).map(({ e, at }) => {
    const action = str(e.action);
    const title = action ? names.abilityName(action) ?? (humanizeAction(action) || null) : null;
    return { title, detail: detailOf(e.parameters, names), at };
  });
}

export function petTiles(petSlots: unknown, names: CardNames): PetTile[] {
  if (!Array.isArray(petSlots)) return [];
  const out: PetTile[] = [];
  for (const p of petSlots) {
    const id = isRecord(p) ? str(p.id) : null;
    const species = isRecord(p) ? str(p.petSpecies) : null;
    if (!isRecord(p) || !id || !species) continue;
    const cap = names.hungerCap(species);
    const hunger = num(p.hunger);
    const hungerPct = cap !== null && cap > 0 && hunger !== null ? Math.min(100, Math.max(0, (hunger / cap) * 100)) : null;
    out.push({ id, species, label: petLabel(p, species, names), mutations: strings(p.mutations), abilities: strings(p.abilities), hungerPct });
  }
  return out;
}

// heldItem.itemId is the inventory key (live 1448): the catalog id for stackables (a seed's species, toolId, eggId,
// decorId), the item's own id for pets, produce and potted plants.
export function heldItemOf(slot: unknown, names: CardNames): HeldItem {
  const held = isRecord(slot) && isRecord(slot.heldItem) ? str(slot.heldItem.itemId) : null;
  if (!held || !isRecord(slot)) return { kind: 'none' };
  const catalogName = names.itemName(held);
  if (catalogName) return { kind: 'catalog', id: held, name: catalogName };
  const inv = isRecord(slot.data) && isRecord(slot.data.inventory) ? slot.data.inventory.items : null;
  const item: unknown = Array.isArray(inv) ? inv.find((x) => isRecord(x) && x.id === held) : null;
  if (!isRecord(item)) return { kind: 'unknown' };
  const petSpecies = str(item.petSpecies);
  if (item.itemType === 'Pet' && petSpecies) {
    return { kind: 'pet', species: petSpecies, mutations: strings(item.mutations), name: petLabel(item, petSpecies, names) };
  }
  const species = str(item.species);
  if (item.itemType === 'Produce' && species) {
    return { kind: 'crop', species, mutations: strings(item.mutations), name: names.cropName(species) ?? species };
  }
  if (item.itemType === 'Plant' && species) {
    const slotMutations = Array.isArray(item.slots) ? item.slots.map((s: unknown) => (isRecord(s) ? strings(s.mutations) : [])) : [];
    return { kind: 'plant', species, slotMutations, name: names.plantName(species) ?? species };
  }
  return { kind: 'unknown' };
}

export function slotOwnedBy(slots: unknown, id: string): Record<string, unknown> | null {
  if (!Array.isArray(slots)) return null;
  const slot: unknown = slots.find((s) => getSlotOwnerId(s) === id);
  return isRecord(slot) ? slot : null;
}

export interface LinesMemo { logs: unknown; lines: ActivityLine[]; max: number }

/** `prev`: the last model's lines; the game keeps an unchanged log list's identity (live 1448), so they are reused. */
export function cardModel(slot: unknown, names: CardNames, maxLines: number, prev?: LinesMemo | null): CardModel {
  const data = isRecord(slot) && isRecord(slot.data) ? slot.data : null;
  const pets = petTiles(data?.petSlots, names);
  const riddenId = isRecord(slot) ? str(slot.riddenPetId) : null;
  const logs = data?.activityLogs;
  const reuse = prev && logs !== undefined && prev.logs === logs && prev.max === maxLines;
  return {
    riding: riddenId ? pets.find((p) => p.id === riddenId)?.label ?? null : null,
    pets,
    held: heldItemOf(slot, names),
    lines: reuse ? prev.lines : activityLines(logs, names, maxLines),
    logs,
    coins: num(data?.coinsCount),
    dust: num(data?.magicDustCount),
  };
}
