import type { TowerId } from '../types';
import type { UpgradeSlot } from '../data/tierSlots';
import type { MgSceneV1 } from '../../../../mg-sprite-render/src';

export type { UpgradeSlot };
export type { MgSceneV1 };

export const TD_CUSTOM_DESIGNS_KEY = 'qpm.td.customDesigns.v1';

export interface DesignLibraryEntry {
  id: string;
  name: string;
  createdAt: number;
  scene: MgSceneV1;
  thumbnailDataUrl: string;
  // True for bundled preset scenes seeded on init. UI hides rename/remove for
  // these; user can override by binding a different design over the preset.
  builtIn?: boolean;
}

export interface Binding {
  kind: TowerId;
  slot: UpgradeSlot;
  designId: string;
}

export interface TDCustomDesignsV1 {
  version: 1;
  library: DesignLibraryEntry[];
  bindings: Binding[];
}
