import type { TowerId } from '../../types';
import type { UpgradeSlot } from '../tierSlots';
import type { MgSceneV1 } from '../../../../../mg-sprite-render/src';

import sproutSlinger_t2a from './sproutSlinger_t2a.mgscene.json';
import sproutSlinger_t2b from './sproutSlinger_t2b.mgscene.json';
import sproutSlinger_t2a2b from './sproutSlinger_t2a2b.mgscene.json';
import sproutSlinger_t3a from './sproutSlinger_t3a.mgscene.json';
import sproutSlinger_t3a2b from './sproutSlinger_t3a2b.mgscene.json';
import sproutSlinger_t3b from './sproutSlinger_t3b.mgscene.json';
import sproutSlinger_t3b2a from './sproutSlinger_t3b2a.mgscene.json';
import sproutSlinger_t4a from './sproutSlinger_t4a.mgscene.json';
import sproutSlinger_t4a2b from './sproutSlinger_t4a2b.mgscene.json';
import sproutSlinger_t4b from './sproutSlinger_t4b.mgscene.json';
import sproutSlinger_t4b2a from './sproutSlinger_t4b2a.mgscene.json';

import witchsCauldron_t2a from './witchsCauldron_t2a.mgscene.json';
import witchsCauldron_t2b from './witchsCauldron_t2b.mgscene.json';
import witchsCauldron_t2a2b from './witchsCauldron_t2a2b.mgscene.json';
import witchsCauldron_t3a from './witchsCauldron_t3a.mgscene.json';
import witchsCauldron_t3a2b from './witchsCauldron_t3a2b.mgscene.json';
import witchsCauldron_t3b from './witchsCauldron_t3b.mgscene.json';
import witchsCauldron_t3b2a from './witchsCauldron_t3b2a.mgscene.json';
import witchsCauldron_t4a from './witchsCauldron_t4a.mgscene.json';
import witchsCauldron_t4a2b from './witchsCauldron_t4a2b.mgscene.json';
import witchsCauldron_t4b from './witchsCauldron_t4b.mgscene.json';
import witchsCauldron_t4b2a from './witchsCauldron_t4b2a.mgscene.json';

import frostWizard_t2a from './frostWizard_t2a.mgscene.json';
import frostWizard_t2b from './frostWizard_t2b.mgscene.json';
import frostWizard_t2a2b from './frostWizard_t2a2b.mgscene.json';
import frostWizard_t3a from './frostWizard_t3a.mgscene.json';
import frostWizard_t3a2b from './frostWizard_t3a2b.mgscene.json';
import frostWizard_t3b from './frostWizard_t3b.mgscene.json';
import frostWizard_t3b2a from './frostWizard_t3b2a.mgscene.json';
import frostWizard_t4a from './frostWizard_t4a.mgscene.json';
import frostWizard_t4a2b from './frostWizard_t4a2b.mgscene.json';
import frostWizard_t4b from './frostWizard_t4b.mgscene.json';
import frostWizard_t4b2a from './frostWizard_t4b2a.mgscene.json';

import marbleKnight_t2a from './marbleKnight_t2a.mgscene.json';
import marbleKnight_t2b from './marbleKnight_t2b.mgscene.json';
import marbleKnight_t2a2b from './marbleKnight_t2a2b.mgscene.json';
import marbleKnight_t3a from './marbleKnight_t3a.mgscene.json';
import marbleKnight_t3a2b from './marbleKnight_t3a2b.mgscene.json';
import marbleKnight_t3b from './marbleKnight_t3b.mgscene.json';
import marbleKnight_t3b2a from './marbleKnight_t3b2a.mgscene.json';
import marbleKnight_t4a from './marbleKnight_t4a.mgscene.json';
import marbleKnight_t4a2b from './marbleKnight_t4a2b.mgscene.json';
import marbleKnight_t4b from './marbleKnight_t4b.mgscene.json';
import marbleKnight_t4b2a from './marbleKnight_t4b2a.mgscene.json';

export interface PresetSceneEntry {
  readonly kind: TowerId;
  readonly slot: UpgradeSlot;
  readonly scene: MgSceneV1;
}

// JSON imports arrive typed as `unknown`. The customDesigns validator runs at
// library-seed time so shape drift surfaces as a diagnostic rather than a hard
// runtime failure. The cast is intentional and narrow.
const asScene = (raw: unknown): MgSceneV1 => raw as MgSceneV1;

export const PRESET_SCENES: readonly PresetSceneEntry[] = [
  { kind: 'sproutSlinger', slot: 't2a',    scene: asScene(sproutSlinger_t2a) },
  { kind: 'sproutSlinger', slot: 't2b',    scene: asScene(sproutSlinger_t2b) },
  { kind: 'sproutSlinger', slot: 't2a2b',  scene: asScene(sproutSlinger_t2a2b) },
  { kind: 'sproutSlinger', slot: 't3a',    scene: asScene(sproutSlinger_t3a) },
  { kind: 'sproutSlinger', slot: 't3a2b',  scene: asScene(sproutSlinger_t3a2b) },
  { kind: 'sproutSlinger', slot: 't3b',    scene: asScene(sproutSlinger_t3b) },
  { kind: 'sproutSlinger', slot: 't3b2a',  scene: asScene(sproutSlinger_t3b2a) },
  { kind: 'sproutSlinger', slot: 't4a',    scene: asScene(sproutSlinger_t4a) },
  { kind: 'sproutSlinger', slot: 't4a2b',  scene: asScene(sproutSlinger_t4a2b) },
  { kind: 'sproutSlinger', slot: 't4b',    scene: asScene(sproutSlinger_t4b) },
  { kind: 'sproutSlinger', slot: 't4b2a',  scene: asScene(sproutSlinger_t4b2a) },

  { kind: 'witchsCauldron', slot: 't2a',    scene: asScene(witchsCauldron_t2a) },
  { kind: 'witchsCauldron', slot: 't2b',    scene: asScene(witchsCauldron_t2b) },
  { kind: 'witchsCauldron', slot: 't2a2b',  scene: asScene(witchsCauldron_t2a2b) },
  { kind: 'witchsCauldron', slot: 't3a',    scene: asScene(witchsCauldron_t3a) },
  { kind: 'witchsCauldron', slot: 't3a2b',  scene: asScene(witchsCauldron_t3a2b) },
  { kind: 'witchsCauldron', slot: 't3b',    scene: asScene(witchsCauldron_t3b) },
  { kind: 'witchsCauldron', slot: 't3b2a',  scene: asScene(witchsCauldron_t3b2a) },
  { kind: 'witchsCauldron', slot: 't4a',    scene: asScene(witchsCauldron_t4a) },
  { kind: 'witchsCauldron', slot: 't4a2b',  scene: asScene(witchsCauldron_t4a2b) },
  { kind: 'witchsCauldron', slot: 't4b',    scene: asScene(witchsCauldron_t4b) },
  { kind: 'witchsCauldron', slot: 't4b2a',  scene: asScene(witchsCauldron_t4b2a) },

  { kind: 'frostWizard', slot: 't2a',    scene: asScene(frostWizard_t2a) },
  { kind: 'frostWizard', slot: 't2b',    scene: asScene(frostWizard_t2b) },
  { kind: 'frostWizard', slot: 't2a2b',  scene: asScene(frostWizard_t2a2b) },
  { kind: 'frostWizard', slot: 't3a',    scene: asScene(frostWizard_t3a) },
  { kind: 'frostWizard', slot: 't3a2b',  scene: asScene(frostWizard_t3a2b) },
  { kind: 'frostWizard', slot: 't3b',    scene: asScene(frostWizard_t3b) },
  { kind: 'frostWizard', slot: 't3b2a',  scene: asScene(frostWizard_t3b2a) },
  { kind: 'frostWizard', slot: 't4a',    scene: asScene(frostWizard_t4a) },
  { kind: 'frostWizard', slot: 't4a2b',  scene: asScene(frostWizard_t4a2b) },
  { kind: 'frostWizard', slot: 't4b',    scene: asScene(frostWizard_t4b) },
  { kind: 'frostWizard', slot: 't4b2a',  scene: asScene(frostWizard_t4b2a) },

  { kind: 'marbleKnight', slot: 't2a',    scene: asScene(marbleKnight_t2a) },
  { kind: 'marbleKnight', slot: 't2b',    scene: asScene(marbleKnight_t2b) },
  { kind: 'marbleKnight', slot: 't2a2b',  scene: asScene(marbleKnight_t2a2b) },
  { kind: 'marbleKnight', slot: 't3a',    scene: asScene(marbleKnight_t3a) },
  { kind: 'marbleKnight', slot: 't3a2b',  scene: asScene(marbleKnight_t3a2b) },
  { kind: 'marbleKnight', slot: 't3b',    scene: asScene(marbleKnight_t3b) },
  { kind: 'marbleKnight', slot: 't3b2a',  scene: asScene(marbleKnight_t3b2a) },
  { kind: 'marbleKnight', slot: 't4a',    scene: asScene(marbleKnight_t4a) },
  { kind: 'marbleKnight', slot: 't4a2b',  scene: asScene(marbleKnight_t4a2b) },
  { kind: 'marbleKnight', slot: 't4b',    scene: asScene(marbleKnight_t4b) },
  { kind: 'marbleKnight', slot: 't4b2a',  scene: asScene(marbleKnight_t4b2a) },
];

export function presetIdFor(kind: TowerId, slot: UpgradeSlot): string {
  return `preset:${kind}:${slot}`;
}
