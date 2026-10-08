import { LEGACY_CULL } from '../constants';
import { newCull, updateCull, type Cull } from '../frame/cull';
import { TRAVEL_CAP_PX } from '../frame/frame';
import type { Basis, CamParams } from '../math/camera';

/** The frame runner's cull bounds for a test FrameCtx (frame/cull.ts): legacy, the fixed side margin; ring > 0, the
 * per-frame near ring (frame.ts RING_PX); turn, the show-ahead band (rad) with its lever (frames, 0: off). */
export const cullOf = (basis: Basis, params: CamParams, W: number, H: number, legacy: number = LEGACY_CULL.side, ring = 0, turn = { yaw: 0, pitch: 0, frames: 0 }): Cull =>
  updateCull(newCull(), basis, params, W, H, { capPx: TRAVEL_CAP_PX, legacy, ring, ahead: turn.frames, aheadMax: Math.PI / 6 }, turn);
