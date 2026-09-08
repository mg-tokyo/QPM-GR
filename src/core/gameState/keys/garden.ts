import { atomSource, defineKey, stateSource } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import type { QuinoaUserSlotData } from '../../../types/gameAtoms';
import { selectMyData } from './selectors';

export const GARDEN_KEYS = {
  myData: defineKey<QuinoaUserSlotData>({
    policy: 'authoritative', tier: 'state', doc: 'My slot data (garden, inventory, petSlots, journal, activityLogs, ...)',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data', selectMyData, { trustPatches: true }),
      atomSource(/^my(?:Player)?Data(?:Atom)?$/, 'authoritative', { structure: (v) => isRecord(v) && isRecord(v.garden) && 'tileObjects' in v.garden }),
    ],
  }),
  map: defineKey<Record<string, unknown>>({
    policy: 'client', tier: 'client', doc: 'Static world map (bundle JSON via mapAtom; not in room state)',
    sources: [atomSource(/^(?:room|garden)?[Mm]ap(?:Data)?Atom$/, 'client', { structure: (v) => isRecord(v) && 'cols' in v && 'rows' in v && 'globalTileIdxToDirtTile' in v })],
  }),
  dirtTileIndex: defineKey<number>({
    policy: 'client', tier: 'client', doc: 'Dirt tile index under the player in their own garden',
    sources: [atomSource(/^myOwnCurrentDirtTileIndexAtom$/, 'client', { project: (v) => (typeof v === 'number' ? v : null) })],
  }),
  gardenTile: defineKey<Record<string, unknown>>({
    policy: 'client', tier: 'client', doc: 'Tile under the player {tileType, userSlotIdx, localTileIndex}',
    sources: [atomSource(/^myCurrentGardenTileAtom$/, 'client', { project: (v) => (isRecord(v) ? v : null) })],
  }),
  gardenObject: defineKey<unknown>({
    policy: 'client', tier: 'composite', doc: 'Garden object under the player (any garden)',
    sources: [atomSource(/^myCurrentGardenObjectAtom$/, 'client')],
  }),
  ownGardenObject: defineKey<unknown>({
    policy: 'client', tier: 'composite', doc: 'Garden object under the player (own garden only)',
    sources: [atomSource(/^myOwnCurrentGardenObjectAtom$/, 'client')],
  }),
};
