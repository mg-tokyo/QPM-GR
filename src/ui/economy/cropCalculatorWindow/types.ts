export interface PlantOption {
  key: string;
  name: string;
  baseSellPrice: number;
  baseWeight: number;
  maxScale: number;
}

export interface CropCalcState {
  plant: PlantOption | null;
  sizePercent: number;
  colorMutation: string | null;
  weatherMutation: string | null;
  timeMutation: string | null;
  playerCount: number;
}

export interface PetOption {
  key: string;
  name: string;
  maturitySellPrice: number;
  maxScale: number;
  hoursToMature: number;
  rarity: string;
}

export interface PetCalcState {
  pet: PetOption | null;
  maxStrength: number;
  currentStrength: number;
  colorMutation: string | null;
  playerCount: number;
}

export interface PillOption {
  label: string;
  value: string | null;
}

export interface MutationTileOption {
  value: string;
  displayName: string;
  multiplier: number;
  color: string;
  gradient: string | undefined;
}
