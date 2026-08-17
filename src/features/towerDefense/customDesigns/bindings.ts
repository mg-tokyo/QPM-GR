import type { TowerId, UpgradeTier } from '../types';
import { resolveUpgradeSlot, TIER_SLOTS, type UpgradeSlot } from '../data/tierSlots';
import { presetIdFor } from '../data/presetScenes/manifest';
import type { Binding, DesignLibraryEntry } from './types';

export function findBinding(
  bindings: readonly Binding[],
  kind: TowerId,
  slot: UpgradeSlot,
): Binding | undefined {
  return bindings.find(b => b.kind === kind && b.slot === slot);
}

// Preset defaults are applied when the user has NO binding recorded for this
// (kind, slot) — the "explicit vanilla" sentinel (user-bound null) currently
// isn't stored (setBinding with null just clears the row), so absence means
// "use the preset if one exists".
export function resolveDesignForTower(
  bindings: readonly Binding[],
  library: readonly DesignLibraryEntry[],
  kind: TowerId,
  upgA: UpgradeTier,
  upgB: UpgradeTier,
): DesignLibraryEntry | null {
  const slot = resolveUpgradeSlot(upgA, upgB);
  const binding = findBinding(bindings, kind, slot);
  if (binding) return library.find(l => l.id === binding.designId) ?? null;
  const presetId = presetIdFor(kind, slot);
  return library.find(l => l.id === presetId) ?? null;
}

export function isValidSlotForKind(kind: TowerId, slot: UpgradeSlot): boolean {
  return TIER_SLOTS[kind].includes(slot);
}
