import type { Balloon, Tower } from '../types';
import { positionAt } from './path';

let forceCamoDetectAll = false;

// Debug-bridge escape hatch kept from Layer 2 as a manual toggle. Real Owl
// coverage lives below; this override still forces detection of every camo.
export function setForceCamoDetectAll(on: boolean): void {
  forceCamoDetectAll = on;
}

export function isForceCamoDetectAll(): boolean {
  return forceCamoDetectAll;
}

export interface OwlCoverageEntry {
  readonly tower: Tower;
  readonly range: number;
}

// Caller (pickTarget in tower.ts) supplies EFFECTIVE ranges so Sharp Eyes /
// Night Hunter upgrades scale coverage. Squared-distance because this is
// called per tower per balloon per tick.
export function isBalloonDetected(
  balloon: Balloon,
  owls: readonly OwlCoverageEntry[],
): boolean {
  if (!balloon.modifiers.includes('camo')) return false;
  if (forceCamoDetectAll) return true;
  const pos = positionAt(balloon.distance);
  for (const owl of owls) {
    const dx = pos.x - owl.tower.pixel.x;
    const dy = pos.y - owl.tower.pixel.y;
    if (dx * dx + dy * dy <= owl.range * owl.range) return true;
  }
  return false;
}
