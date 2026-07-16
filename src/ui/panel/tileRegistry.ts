// src/ui/panel/tileRegistry.ts
import { windowLog } from '../core/modalWindow';
import type { PerTileStatusProvider, MultiTileStatusProvider } from './tileStatusTypes';
import type { HubGroupDef, LauncherCardConfig, ExpandableCardConfig } from '../hub/cards/types';

export interface TileDefinition {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly color: string; // rgba color for background tint + glow
  readonly action: () => void;
  readonly defaultStatus?: string;
  readonly statusProvider?: PerTileStatusProvider;
}

const registry: TileDefinition[] = [];
const multiTileProviders: MultiTileStatusProvider[] = [];

export function registerTile(def: TileDefinition): void {
  if (registry.some(t => t.id === def.id)) return;
  registry.push(def);
}

export function getAllTileDefinitions(): readonly TileDefinition[] {
  return registry;
}

export function getTileDefinition(id: string): TileDefinition | undefined {
  return registry.find(t => t.id === id);
}

// ---------------------------------------------------------------------------
// Multi-tile provider registry
// ---------------------------------------------------------------------------

export function registerMultiTileProvider(provider: MultiTileStatusProvider): void {
  if (multiTileProviders.includes(provider)) return;
  multiTileProviders.push(provider);
}

export function getMultiTileProviders(): readonly MultiTileStatusProvider[] {
  return multiTileProviders;
}

// ---------------------------------------------------------------------------
// Auto-register tiles from hub group card definitions
// ---------------------------------------------------------------------------

export function registerTilesFromGroups(groups: ReadonlyArray<HubGroupDef>): void {
  for (const group of groups) {
    for (const card of group.cards) {
      if (!card.tile) continue;
      const tileMeta = card.tile;
      const tileId = tileMeta.tileId ?? card.key;

      let action = tileMeta.action;
      if (!action) {
        if (card.tier === 'launcher') {
          action = (card as LauncherCardConfig).onOpen;
        } else if (card.tier === 'expandable' && (card as ExpandableCardConfig).onDetach) {
          action = (card as ExpandableCardConfig).onDetach;
        }
      }

      if (!action) {
        windowLog.warn('QPM-UI-002', { what: 'tileReg:noAction', tile: tileId, cardKey: card.key });
        continue;
      }

      const def: TileDefinition = {
        id: tileId,
        icon: tileMeta.icon,
        label: card.label,
        color: tileMeta.color,
        action,
        ...(tileMeta.defaultStatus != null ? { defaultStatus: tileMeta.defaultStatus } : {}),
        ...(tileMeta.statusProvider != null ? { statusProvider: tileMeta.statusProvider } : {}),
      };
      registerTile(def);
    }
  }
}
