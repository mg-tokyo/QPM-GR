import { atomSource, defineKey, stateSource } from '../define';
import { selectMyData, selectMySlot } from './selectors';

export const PET_KEYS = {
  activePetSlots: defineKey<unknown[]>({
    policy: 'authoritative', tier: 'state', doc: 'Authoritative active pets (myData.petSlots). Feed/swap logic must not act on predictions.',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/petSlots', (s, id) => { const d = selectMyData(s, id); return !d ? undefined : (Array.isArray(d.petSlots) ? d.petSlots : undefined); }, { trustPatches: true }),
      atomSource(/^myPredictedPetSlotsAtom$/, 'predicted', { project: (v) => (Array.isArray(v) ? v : undefined) }),
    ],
    // Idle-queue myPredictedPetSlotsAtom returns the game's presentation-stable
    // snapshot, which lets hunger/xp/abilityCooldowns lag authoritative by design.
    // Verified at scraped-data/BetaGameSourceFiles/3668-migratequinoaactionstoorderprediction/
    //   preview.magicgarden.gg/src/games/Quinoa/atoms/petSlotAtoms.ts:19
    auditNormalize: (slots) => (slots ?? []).map((slot) => {
      if (!slot || typeof slot !== 'object') return slot;
      const { hunger: _h, xp: _x, abilityCooldowns: _c, ...rest } = slot as Record<string, unknown>;
      return rest;
    }),
  }),
  petSlotInfos: defineKey<Record<string, unknown>>({
    policy: 'authoritative', tier: 'state', doc: 'Per-pet motion/lastActionEvent map (slot level). Verified identical to myPetSlotInfosAtom live 2026-09-05.',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/petSlotInfos', (s, id) => {
        const slot = selectMySlot(s, id);
        if (!slot) return undefined;
        const v = slot.petSlotInfos;
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
      }, { trustPatches: true }),
      atomSource(/^myPetSlotInfosAtom$/, 'authoritative', { project: (v) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined) }),
    ],
  }),
  riddenPetId: defineKey<string | null>({
    policy: 'authoritative', tier: 'state', defaultValue: null, doc: 'Authoritative mount (slot.riddenPetId, NOT under data)',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/riddenPetId', (s, id) => { const slot = selectMySlot(s, id); return !slot ? undefined : (typeof slot.riddenPetId === 'string' ? slot.riddenPetId : null); }),
      atomSource(/^myAuthoritativeRiddenPetIdAtom$/, 'authoritative', { project: (v) => (typeof v === 'string' ? v : null) }),
    ],
  }),
};
