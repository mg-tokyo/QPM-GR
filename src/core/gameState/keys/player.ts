import { atomSource, defineKey, stateSource } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import { getSlotOwnerId } from '../../slotOwner';
import type { PlayerAtomValue, QuinoaData, QuinoaStateSnapshot, QuinoaUserSlot } from '../../../types/gameAtoms';
import { selectMySlot } from './selectors';

const isSnapshot = (v: unknown): v is QuinoaStateSnapshot => isRecord(v) && 'child' in v && isRecord(v.child);

export const PLAYER_KEYS = {
  state: defineKey<QuinoaStateSnapshot>({
    policy: 'authoritative', tier: 'state', doc: 'Root room state snapshot',
    sources: [
      stateSource('', (s) => s),
      atomSource(/^(?:room|game)?[Ss]tate(?:Data)?Atom$/, 'authoritative', { structure: isSnapshot }),
    ],
  }),
  quinoaData: defineKey<QuinoaData>({
    policy: 'authoritative', tier: 'state', doc: 'child.data (shops, weather, userSlots, ...)',
    sources: [
      stateSource('/child/data', (s) => (s.child?.data && typeof s.child.data === 'object' ? s.child.data : undefined)),
      atomSource(/^quinoaDataAtom$/, 'authoritative'),
    ],
  }),
  userSlots: defineKey<unknown[]>({
    policy: 'authoritative', tier: 'state', doc: 'All user slots (null entries for empty seats)',
    sources: [
      stateSource('/child/data/userSlots', (s) => (Array.isArray(s.child?.data?.userSlots) ? s.child.data.userSlots : undefined)),
      atomSource(/^(?:room)?[Uu]ser[Ss]lots(?:Data)?Atom$/, 'authoritative', {
        structure: (v) => Array.isArray(v) && v.every((x) => x === null || (isRecord(x) && ('userId' in x || 'playerId' in x))),
      }),
    ],
  }),
  players: defineKey<PlayerAtomValue[]>({
    policy: 'authoritative', tier: 'state', doc: 'Room players (data.players)',
    sources: [stateSource('/data/players', (s) => (Array.isArray(s.data?.players) ? s.data.players : undefined))],
  }),
  myUserSlot: defineKey<QuinoaUserSlot>({
    policy: 'authoritative', tier: 'state', doc: 'My user slot (slot level: riddenPetId, petSlotInfos, lastActionEvent)',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}', selectMySlot),
      atomSource(/^myUserSlotAtom$/, 'authoritative'),
    ],
  }),
  myUserSlotIdx: defineKey<number>({
    policy: 'authoritative', tier: 'state', doc: 'Index of my user slot',
    sources: [
      stateSource('/child/data/userSlots', (s, id) => {
        if (id.playerId === null) return undefined;
        const slots = s.child?.data?.userSlots;
        if (!Array.isArray(slots)) return undefined;
        const idx = slots.findIndex((x) => getSlotOwnerId(x) === id.playerId);
        return idx >= 0 ? idx : undefined;
      }),
      atomSource(/^my(?:User)?Slot(?:Idx|Index)(?:Data)?Atom$/, 'authoritative', { structure: (v) => typeof v === 'number' }),
    ],
  }),
  playerId: defineKey<string>({
    policy: 'client', tier: 'client', doc: 'My player id (identity ladder owns the fallback rungs)',
    sources: [atomSource(/^playerIdAtom$/, 'client', { structure: (v) => typeof v === 'string' && v.length > 0 })],
  }),
  player: defineKey<PlayerAtomValue>({
    policy: 'client', tier: 'client', doc: 'My player record',
    sources: [
      atomSource(/^player(?:Data)?Atom$/, 'client', { structure: (v) => isRecord(v) && typeof v.id === 'string' && 'name' in v }),
    ],
  }),
};
