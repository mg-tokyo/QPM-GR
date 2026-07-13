export interface HoldContexts {
  harvest: boolean;   // harvest/rainbowHarvest/goldHarvest
  plant: boolean;     // planting seeds
  shovel: boolean;    // removing garden objects
  sell: boolean;      // selling at shops
  hatch: boolean;     // hatching eggs
  other: boolean;     // any unrecognized action context
}

export interface GardenQolConfig {
  instaHarvestRainbow: boolean;  // skip hold-to-harvest for Rainbow plants
  instaHarvestGold: boolean;     // skip hold-to-harvest for Gold plants
  ariesHold: boolean;            // rapid-fire hold mode (hold Space → repeat at N Hz)
  holdRateHz: number;            // hold repeat rate in Hz (5–20, default 10)
  holdContexts: HoldContexts;   // per-action-context hold toggles
}
