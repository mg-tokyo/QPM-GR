import type { ErrorCodeDefinition } from '../types';

// The release these first ship in (3.3.54 is the current one).
const V = '3.3.55';
const SUB = 'feature:spectator';

export const SPECTATOR_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-SPEC-001', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Spectator camera unavailable (game changed)',
    description: 'A camera handle the spectator camera needs (camera target, keyboard capture, engine, ticker or avatar views) is missing or changed shape, so spectating stays off. The game is unaffected.',
    userAction: 'None needed. Report it if it persists after a game update.',
    devNotes: "src/features/spectator/probe.ts startupCheck(); context.missing lists the failed handles (key names from keys/camera.ts, 'engine', 'ticker', 'avatar-views', 'avatar-view' (no view has the follow shape, or its positionSmoothing can't be copied and advanced), 'pointer' (World, the canvas or PIXI's event mapping), 'write-test', 'restore'). 'target-busy' (the game owns the cutscene target) and 'not-seated' are transient and never logged. QPM_DEBUG_API.spectator.probe() re-runs every check with facts.",
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-SPEC-002', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Spectator camera stepped aside',
    description: 'The game took the camera (a cutscene, a tram ride or an NPC arrival pan) or something displaced the spectator keyboard capture, so the spectator camera paused.',
    userAction: 'None. It resumes when the game lets go.',
    devNotes: 'Once per episode. context.reason: cutscene | tram | foreign (the target held a value QPM did not write) | owner (QPM capture owner removed by someone else).',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-SPEC-003', subsystem: SUB, category: 'feature', severity: 'warn',
    title: 'Spectator frame failed, camera returned',
    description: 'A spectator camera frame threw; spectating exited and the camera went back to your avatar.',
    userAction: 'Press the spectate key again to retry. After three failures it stays off until reload.',
    devNotes: 'context.phase names the failing step; context.n the page-session count.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-SPEC-004', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Spectator camera disabled for this session',
    description: 'Three spectator frame failures in one session; spectating stays off until the page reloads.',
    userAction: 'Reload the game tab to try again.',
    devNotes: 'See the preceding QPM-SPEC-003 entries for the failing phase.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-SPEC-005', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Photo could not be saved or copied',
    description: 'The browser or the Discord frame refused the download or the clipboard, so the photo opened in a preview instead.',
    userAction: 'Save the photo from the preview.',
    devNotes: 'context.kind: download | clipboard; context.error is the refusal message.',
    sinceVersion: V, notifyUser: false,
  },
];
