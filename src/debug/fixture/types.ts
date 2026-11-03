export type FixtureConfig = {
  schema: 1;
  allowRarity: string;                       // e.g. "Common"
  reserveFloors: Record<string, number>;     // key `${kind}:${id}`, e.g. "egg:CommonEgg"; missing = 0
  buyEggsAtOrBelowFloor: boolean;
  spendCapPerRun: number;
  spendCapPerDay: number;
  coinFloor: number;
  useCaps: { seeds: number; eggs: number };
};

// slot = String(dirt tile index); objectId = the planting's snapshot objectId, set once the object exists.
export type LedgerSlot = { slot: string; kind: 'plant' | 'egg'; id: string; runId: string; objectId?: string };
export type Ledger = { schema: 1; slots: LedgerSlot[]; petIds: string[]; itemIds: string[] };
export type BeginInput = { runId: string; config: FixtureConfig; ledger: Ledger; budget: { spendCap: number }; alert: boolean };
// Ids present at begin whose catalog rarity is allowRarity; the out-of-page diff has no catalogs.
export type FixtureAllowlist = { seed: string[]; egg: string[]; crop: string[] };

// Pets carry one id (inventory, hutch and petSlots alike; team members reference it as petId).
export type SnapPet = {
  id: string;
  species: string;
  name: string | null;
  location: 'inventory' | 'hutch' | 'active';
};

export type SnapStackKind = 'seed' | 'egg' | 'tool' | 'decor' | 'unknown';

export type FixtureSnapshot = {
  takenAt: string;
  coins: number;
  // Summed over inventory and every storage; `unknown` = an item type this build cannot classify.
  stacks: { kind: SnapStackKind; id: string; quantity: number }[];
  crops: { id: string; species: string }[];
  favoritedItemIds: string[];
  pets: SnapPet[];
  teams: { id: string; petIds: string[] }[];
  // slot: dirt index, or `boardwalk:<n>` / `edge:<n>`; objectId = String(plantedAt), the planting's identity.
  garden: { slot: string; objectType: string; id: string | null; objectId: string | null }[];
};

export type FixtureEvent = { at: string; type: string; origin: 'qpm' | 'native'; verdict: 'allow' | 'refuse'; reason: string | null };
export type Learned = { slots: LedgerSlot[]; petIds: string[]; itemIds: string[] };
export type EndResult = {
  runId: string;
  after: FixtureSnapshot;
  events: FixtureEvent[];
  learned: Learned;
  spent: number;
  endReason: 'end' | 'connection-changed' | 'unload';
};
