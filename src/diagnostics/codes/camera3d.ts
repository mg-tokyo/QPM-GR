import type { ErrorCodeDefinition } from '../types';

// Keep in sync with CURRENT_VERSION in ../codes.ts (local copy avoids a circular import).
const V = '3.2.29';
const SUB = 'feature:camera3d';

export const CAMERA3D_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-CAM3D-001', subsystem: SUB, category: 'feature', severity: 'warn',
    title: '3D camera unavailable (game changed)',
    description: 'A scene node, PIXI class or engine system the 3D camera needs was not found, so 3D stays off and the game runs in plain 2D.',
    userAction: 'None needed: the game works normally in 2D. Report it if it persists after a game update.',
    devNotes: 'src/features/camera3d/capabilities.ts resolveCapabilities(); context.missing lists what failed. Re-probe with QPM_DEBUG_API.camera3d.state().',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-002', subsystem: SUB, category: 'feature', severity: 'info',
    title: '3D camera hook re-wrapped',
    description: 'Another script replaced a game method the 3D camera wraps (renderer.render, applyInputZoom, mapPositionToPoint); QPM wrapped the new one.',
    userAction: 'None.',
    devNotes: 'context.hook names the method. Precedent: npcDialogue talkInterceptor ensure/displace pattern.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-003', subsystem: SUB, category: 'feature', severity: 'warn',
    title: '3D frame failed, back to 2D',
    description: 'A 3D frame threw; the frame was re-drawn in 2D and 3D exited.',
    userAction: 'Scroll in again to retry. After three failures 3D stays off until reload.',
    devNotes: 'src/features/camera3d/runtime.ts onStage(); context.phase is pre|render, context.n the session count.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-004', subsystem: SUB, category: 'feature', severity: 'info',
    title: '3D camera disabled for this session',
    description: 'Three 3D frame failures in one session; 3D stays off until the page reloads.',
    userAction: 'Reload the game tab to try again.',
    devNotes: 'See the preceding QPM-CAM3D-003 entries for the failing phase.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-005', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Mouse look (pointer lock) refused',
    description: 'The browser or the Discord frame refused pointer lock; right-drag look keeps working.',
    userAction: 'Use right-drag to look around.',
    devNotes: 'src/features/camera3d/input/look.ts pointerlockerror.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-006', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Weather hidden in 3D',
    description: 'The weather pattern shader or its resources changed shape, so rain/snow is not drawn while in 3D.',
    userAction: 'None.',
    devNotes: 'src/features/camera3d/scene/shaders.ts patchWeatherVertex() returned null or the bind map 99 resources were missing.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-007', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Held item hidden in first person',
    description: "The avatar's held-item node changed shape, so first person hides the whole avatar (and the held item) as before.",
    userAction: 'None.',
    devNotes: 'src/features/camera3d/scene/viewmodel.ts firstPerson(); context.missing is parts (AvatarRotation/HeldItemVisual not found) or offsets (currentOffsetX/Y not numbers).',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-008', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Area tiles approximated in 3D',
    description: 'The perspective mesh for area tiles (shard coverage, binder auras) could not be created, so they fall back to the flat approximation, which skews close to the camera.',
    userAction: 'None.',
    devNotes: 'src/features/camera3d/scene/areaMesh.ts create(); context.error is the thrown message.',
    sinceVersion: V, notifyUser: false,
  },
];
