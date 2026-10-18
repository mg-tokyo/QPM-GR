// The game's 2D camera handles (cameraAtoms.ts, cutsceneAtoms.ts, hotkeyAtoms.ts, baseAtoms.ts; live 1448).
// cameraTarget = freelook position in freelook mode, else cutsceneCameraTarget ?? the avatar-centred point.
import { atomSource, defineKey } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import type { GridPosition } from '../../../types/gameAtoms';

export type LocalPresence = 'seated' | 'spectating' | 'unseated';

const isGrid = (v: unknown): boolean => isRecord(v) && Number.isFinite(v.x) && Number.isFinite(v.y);
const isGridOrNull = (v: unknown): boolean => v === null || isGrid(v);
const isObjectOrNull = (v: unknown): boolean => v === null || isRecord(v);
const isPresence = (v: unknown): boolean => v === 'seated' || v === 'spectating' || v === 'unseated';
const isBool = (v: unknown): boolean => typeof v === 'boolean';

export const CAMERA_KEYS = {
  cameraTarget: defineKey<GridPosition | null>({
    policy: 'client', tier: 'composite', defaultValue: null, doc: 'Grid point the 2D camera follows this frame (derived, read-only)',
    sources: [atomSource(/^cameraTargetAtom$/, 'client', { structure: isGridOrNull })],
  }),
  cutsceneCameraTarget: defineKey<GridPosition | null>({
    policy: 'client', tier: 'client', defaultValue: null,
    doc: 'Camera override while seated (primitive, init null). Game writers: cutscene end (nulls it), the NPC arrival pan',
    sources: [atomSource(/^cutsceneCameraTargetAtom$/, 'client', { writable: true, structure: isGridOrNull })],
  }),
  freelookCameraPosition: defineKey<GridPosition>({
    policy: 'client', tier: 'client', doc: 'Camera target in freelook mode (a real spectator)',
    sources: [atomSource(/^freelookCameraPositionAtom$/, 'client', { writable: true, structure: isGrid })],
  }),
  zoomIntent: defineKey<number | null>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'Requested 2D zoom (px per tile), null = the game default',
    sources: [atomSource(/^zoomIntentAtom$/, 'client', { writable: true, structure: (v) => v === null || Number.isFinite(v) })],
  }),
  activeCutscene: defineKey<unknown>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'Running cutscene or null',
    sources: [atomSource(/^activeCutsceneAtom$/, 'client', { structure: isObjectOrNull })],
  }),
  tramJourney: defineKey<unknown>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'Running tram journey or null',
    sources: [atomSource(/^tramJourneyAtom$/, 'client', { structure: isObjectOrNull })],
  }),
  keyboardCaptureOwners: defineKey<readonly object[]>({
    policy: 'client', tier: 'client',
    doc: 'Keyboard capture owners: non-empty = game hotkeys off. Game owners are {ownerName, token, allowMovementKeys}, removed by token',
    sources: [atomSource(/^quinoaKeyboardCaptureOwnersAtom$/, 'client', {
      writable: true, structure: (v) => Array.isArray(v) && v.every(isRecord),
    })],
  }),
  localPresence: defineKey<LocalPresence>({
    policy: 'client', tier: 'composite', doc: "'seated' | 'spectating' | 'unseated'",
    sources: [atomSource(/^localPresenceAtom$/, 'client', { structure: isPresence })],
  }),
  // Cinematic Mode's own flag has no label; isChromeHiddenAtom reads exactly it OR cutsceneChromeHidden (read traced,
  // live 1448), so Cinematic on = hudChromeHidden && !cutsceneChromeHidden.
  hudChromeHidden: defineKey<boolean>({
    policy: 'client', tier: 'composite', doc: 'Game HUD hidden: Cinematic Mode or a cutscene that hides it (derived, read-only)',
    sources: [atomSource(/^isChromeHiddenAtom$/, 'client', { structure: isBool })],
  }),
  cutsceneChromeHidden: defineKey<boolean>({
    policy: 'client', tier: 'composite', doc: 'A running cutscene hides the game HUD (derived, read-only)',
    sources: [atomSource(/^isCutsceneChromeHiddenAtom$/, 'client', { structure: isBool })],
  }),
};
