import { atomSource, defineKey, PET_TICK_PATCH_PATHS, ROOT_TICK_PATCH_PATHS, stateSource } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import { getSlotOwnerId } from '../../slotOwner';
import type { PlayerAtomValue, QuinoaData, QuinoaStateSnapshot, QuinoaUserSlot } from '../../../types/gameAtoms';
import { selectMySlot } from './selectors';

const isSnapshot = (v: unknown): v is QuinoaStateSnapshot => isRecord(v) && 'child' in v && isRecord(v.child);

export const PLAYER_KEYS = {
  state: defineKey<QuinoaStateSnapshot>({
    policy: 'authoritative', tier: 'state', doc: 'Root room state snapshot',
    sources: [
      stateSource('', (s) => s, { trustPatches: true, ignorePatchSuffixes: ROOT_TICK_PATCH_PATHS }),
      atomSource(/^(?:room|game)?[Ss]tate(?:Data)?Atom$/, 'authoritative', { structure: isSnapshot }),
    ],
  }),
  quinoaData: defineKey<QuinoaData>({
    policy: 'authoritative', tier: 'state', doc: 'child.data (shops, weather, userSlots, ...)',
    sources: [
      stateSource('/child/data', (s) => (s.child?.data && typeof s.child.data === 'object' ? s.child.data : undefined), { trustPatches: true, ignorePatchSuffixes: ROOT_TICK_PATCH_PATHS }),
      atomSource(/^quinoaDataAtom$/, 'authoritative'),
    ],
  }),
  userSlots: defineKey<unknown[]>({
    policy: 'authoritative', tier: 'state', doc: 'All user slots (null entries for empty seats)',
    sources: [
      stateSource('/child/data/userSlots', (s) => (Array.isArray(s.child?.data?.userSlots) ? s.child.data.userSlots : undefined), { trustPatches: true, ignorePatchSuffixes: PET_TICK_PATCH_PATHS }),
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
      stateSource('/child/data/userSlots/{myIdx}', selectMySlot, { trustPatches: true, ignorePatchSuffixes: PET_TICK_PATCH_PATHS }),
      // Structure guard: myUserSlotAtom is `myUserSlots[myIdx]` in beta baseAtoms.ts;
      // it delivers `null` when the player has no seat. Reject null so the ladder
      // reports UNBOUND rather than "bound with null".
      atomSource(/^myUserSlotAtom$/, 'authoritative', {
        structure: (v) => v !== null && typeof v === 'object',
        requiresSeat: true,
      }),
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
      atomSource(/^my(?:User)?Slot(?:Idx|Index)(?:Data)?Atom$/, 'authoritative', {
        structure: (v) => typeof v === 'number',
        requiresSeat: true,
      }),
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
  spectators: defineKey<readonly string[]>({
    policy: 'authoritative', tier: 'state', defaultValue: [],
    doc: 'Player ids currently spectating this room (data.spectators)',
    sources: [
      stateSource('/child/data/spectators', (s) => (Array.isArray(s.child?.data?.spectators) ? s.child.data.spectators : undefined)),
      atomSource(/^spectatorsAtom$/, 'authoritative', {
        structure: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
      }),
    ],
  }),
  // policy:'client' (not 'authoritative') because the ladder is atom-only:
  // isSpectatingAtom is a composite derived by the game from myUserSlotIdx
  // and spectators (baseAtoms.ts:44-49); mirroring the formula on the
  // state-tree rung would duplicate that derivation. assertLadderPolicy
  // requires authoritative keys to list a stateTree source first.
  isSpectating: defineKey<boolean>({
    policy: 'client', tier: 'composite', defaultValue: false,
    doc: 'True iff the player has no seat AND their id is in spectators (isSpectatingAtom)',
    sources: [
      atomSource(/^isSpectatingAtom$/, 'client', { structure: (v) => typeof v === 'boolean' }),
    ],
  }),
};
