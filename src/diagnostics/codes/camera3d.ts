import type { ErrorCodeDefinition } from '../types';

// The release each code first shipped in: 001–008 with the 3D camera (3.3.51), 009–011 with its polish and perf work
// (next release).
const V = '3.3.51';
const V_POLISH = '3.3.53';
const SUB = 'feature:camera3d';

export const CAMERA3D_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-CAM3D-001', subsystem: SUB, category: 'feature', severity: 'warn',
    title: '3D camera unavailable (game changed)',
    description: 'A scene node, PIXI class or engine system the 3D camera needs was not found, or a game layout it reads changed shape, so 3D stays off and the game runs in plain 2D.',
    userAction: 'None needed: the game works normally in 2D. Report it if it persists after a game update.',
    devNotes: "src/features/camera3d/capabilities.ts resolveCapabilities(); context.missing lists what failed: node, class or system names; 'tilemap-layout' (tileArt.ts checkTileLayout) or 'depth-keys' (math/depth.ts checkDepthKeys), the install drift checks; init:<step> = that install step threw (index.ts install()) and every piece before it was removed; 'drift:horizon' = no sky band once the tile textures resolved (scene/horizon.ts), 3D blocked with that reason. QPM_DEBUG_API.camera3d.drift() runs every drift check; state().status.caps is the last probe; retry() probes and installs again.",
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-002', subsystem: SUB, category: 'feature', severity: 'info',
    title: '3D camera hook re-wrapped',
    description: 'Something replaced what the 3D camera hooks: usually another script replacing a game method it wraps (renderer.render, applyInputZoom, mapPositionToPoint), or a room reconnect replacing the engine systems it uses. QPM hooked the new ones.',
    userAction: 'None.',
    devNotes: "context.hook: render (runtime.ts watchdog), applyInputZoom (engine/zoomBridge.ts), mapPositionToPoint (input/remap.ts): re-wrapped; systems (index.ts revalidateSystems): a system object changed after a reconnect, full reinstall. Too many re-wraps a minute become QPM-CAM3D-010.",
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-003', subsystem: SUB, category: 'feature', severity: 'warn',
    title: '3D frame failed, back to 2D',
    description: 'A 3D frame threw; the frame was re-drawn in 2D and 3D exited.',
    userAction: 'Scroll in again to retry. After three failures 3D stays off until reload.',
    devNotes: 'src/features/camera3d/runtime.ts fail(); context.phase is stage|view|pre|render|post|postRender|frame|exit (render path) or zoom|pick|hover|move (input wrappers); context.n the page-session count. Reinstalls keep the count; QPM_DEBUG_API.camera3d.retry() clears it.',
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
    devNotes: 'src/features/camera3d/input/look.ts refused(): once per QPM pointer-lock request (lookGesture.ts lockFailed), from its rejected promise or the pointerlockerror event; a lock error of another script is not logged.',
    sinceVersion: V, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-006', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Weather hidden or simplified in 3D',
    description: 'The weather pattern shader or its resources changed shape, so in 3D rain/snow is not drawn, or is drawn without its fades or storm bolts.',
    userAction: 'None.',
    devNotes: "src/features/camera3d/scene/weather.ts report(), once per install per context.patch: vertex | resources | none (no 3D weather); fragment (no per-cell fades); cellHash | hashFn (one storm phase path lost; bolts need one); tall (standing rain/frost stays one frame tall); gpuPhases (the game-renderer phase map failed, CPU twin used). weatherCells.ts weatherPatchIssues().",
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
  {
    code: 'QPM-CAM3D-009', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Avatar heights approximated in 3D',
    description: "The game's avatar view changed shape, or an avatar was lifted by something QPM does not model, so in 3D that lift reads as a step north instead of height (benches, bridges, platforms).",
    userAction: 'None.',
    devNotes: "src/features/camera3d/scene/ground.ts + avatarSource.ts. context.kind 'view': no AvatarView with the glide fields for that container (getSystem('avatar').views); 'rest': a resting avatar's tile centre − natural target − lift moved from its first value (context.rest/ref, decorId) — a new lift source.",
    sinceVersion: V_POLISH, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-010', subsystem: SUB, category: 'feature', severity: 'info',
    title: '3D camera off: another script keeps replacing its hook',
    description: 'Another script replaced a game method the 3D camera wraps more than four times in a minute. QPM stopped wrapping it again and turned 3D off until QPM reinstalls, so the two scripts do not stack wrappers forever.',
    userAction: 'Turn off the other mod that changes the game camera or input, then reload.',
    devNotes: 'src/features/camera3d/frame/rewrap.ts RewrapBudget; runtime.ts hookFight(). context.hook: render | applyInputZoom | mapPositionToPoint. The runtime reports blockedReason "hook-fight".',
    sinceVersion: V_POLISH, notifyUser: false,
  },
  {
    code: 'QPM-CAM3D-011', subsystem: SUB, category: 'feature', severity: 'info',
    title: 'Far pets keep animating in 3D',
    description: "With far animation off, a distant pet or player could not be frozen (its frozen frame could not be saved, its sprite changed shape, or QPM can't see the game's animated sprites yet), so it keeps animating.",
    userAction: 'None.',
    devNotes: "src/features/camera3d/engine/farAnim.ts, once per install. context.kind 'refused': a sprite QPM paused came back un-paused (RiveSprite cancelPauseAfterSnapshotFailure, or another script resumed it) or pause() threw; it is not paused again this install. 'shape': a World-rooted Rive sprite without pause/resume/isPaused. 'tracker': the rive-engine tracker has not hooked the game's atlas working set (instanceTracker.ts tryHook, isInstanceTrackerHooked), so no sprite is seen and nothing freezes.",
    sinceVersion: V_POLISH, notifyUser: false,
  },
];
