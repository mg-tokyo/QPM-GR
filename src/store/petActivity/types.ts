export type EventKind = 'ability' | 'feed' | 'hatch' | 'sell' | 'potion' | 'mount' | 'team';

export interface PetSnap {
  id: string;
  species: string;
  name: string | null;
  mutations: string[];
  targetScale: number;
  xp: number;
  abilities: string[];
  str: number | null;
  maxStr: number | null;
  level: number | null;
}

export type TargetSnap =
  | { kind: 'crop'; species: string; mutations: string[]; scale: number }
  | { kind: 'growSlot'; species: string; mutations: string[]; targetScale: number; startTime: number; endTime: number }
  | { kind: 'pet'; pet: PetSnap }
  | { kind: 'egg'; eggId: string }
  | { kind: 'seed'; species: string }
  | { kind: 'tool'; toolId: string }
  | { kind: 'coin' };

export type EventValue = number | string;

export interface PetActivityEvent {
  id: string;
  ts: number;
  source: 'server' | 'qpm';
  kind: EventKind;
  action: string;
  family: string;
  pet: PetSnap;
  targets: TargetSnap[];
  values: Record<string, EventValue>;
  cluster?: TargetSnap[];
  clusterTotal?: number;
  updatedAt: number;
}

export interface ActivityRun {
  id: string;
  kind: EventKind;
  family: string;
  pet: PetSnap;
  events: PetActivityEvent[];   // newest first
  totals: Record<string, number>;
  firstTs: number;
  lastTs: number;
}

export interface PetActivityEnvelope {
  version: 1;
  events: PetActivityEvent[];
}

export interface PetActivityChange {
  added: PetActivityEvent[];
  updated: PetActivityEvent[];
  cleared: boolean;
}

export type KindFilter = 'all' | 'hatchSell' | EventKind;

export interface PetActivityUiPrefs {
  kind: KindFilter;
  pet: string | null;   // species key, not a pet id

  families: string[];
  density: 'ledger' | 'compact';
}
