import type { Pass } from '../frame/frame';
import type { PixiClasses, UniformGroupLike } from '../types';

/** The resource name the camera group binds under in every 3D program (floor, horizon, area mesh, walls, weather). */
export const CAM_RESOURCE = 'qpm3dCam';

interface CamValues { uCamPos: Float32Array; uCamF: Float32Array; uCamR: Float32Array; uCamU: Float32Array; uFpx: number; uCenter: Float32Array; uNear: number }

// One group written once per frame, where five passes each declared, wrote and updated their own (A Q2). Without
// UBOs each GL program still syncs the values it uses, so this saves the JS work, not uniform uploads.
export interface CamUniforms extends Pass { readonly group: UniformGroupLike }

export function createCamUniforms(C: PixiClasses): CamUniforms {
  const v = (n: number, type: string) => ({ value: new Float32Array(n), type });
  const group: UniformGroupLike = new C.UniformGroup({
    uCamPos: v(3, 'vec3<f32>'), uCamF: v(3, 'vec3<f32>'), uCamR: v(3, 'vec3<f32>'), uCamU: v(3, 'vec3<f32>'),
    uFpx: { value: 1, type: 'f32' }, uCenter: v(2, 'vec2<f32>'), uNear: { value: 40, type: 'f32' },
  });
  const u = group.uniforms as unknown as CamValues;
  return {
    name: 'cam',
    group,
    pre(ctx) {
      const b = ctx.basis;
      u.uCamPos.set(b.C); u.uCamF.set(b.F); u.uCamR.set(b.R); u.uCamU.set(b.U);
      u.uFpx = b.fpx; u.uCenter[0] = b.cx0; u.uCenter[1] = b.cy0; u.uNear = ctx.params.near;
      group.update();
    },
    drop() { /* values only */ },
    destroy() { /* no GPU resource without a UBO */ },
  };
}
