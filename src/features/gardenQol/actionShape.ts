// Pattern helper for the game's *Harvest action taxonomy. Verified against
// beta actionTypes.ts:27-45 (rainbowHarvest, goldHarvest, preservedHarvest)
// and v1040 main bundle (adds rarePatchHarvest). Case-sensitive suffix so
// 'sellRainbowPet' etc. never match.

export function isHarvestAction(action: string | null | undefined): boolean {
  if (!action) return false;
  return action === 'harvest' || /[Hh]arvest$/.test(action);
}
