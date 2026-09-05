export interface HoldContexts {
  harvest: boolean;   // harvest / *Harvest variants
  plant: boolean;     // planting seeds
  shovel: boolean;    // removing garden objects
  sell: boolean;      // selling at shops
  hatch: boolean;     // hatching eggs
  other: boolean;     // any unrecognized action context
}

export interface GardenQolConfig {
  ariesHold: boolean;            // rapid-fire hold mode (hold Space → repeat at N Hz)
  holdRateHz: number;            // hold repeat rate in Hz (5–20, default 10)
  holdContexts: HoldContexts;    // per-action-context hold toggles
}
