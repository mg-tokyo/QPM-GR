import type { Node3, PixiClasses, ShaderLike, UniformGroupLike } from '../types';
import { slabBounds, slabKey } from './weatherCells';

/** P9: one weather mirror's depth slabs. Each is a World mesh on the mirror's geometry, program and mode group, with
 * its own [lo, hi) range; attached only while tilted standing weather shows (a hidden World child still costs sorts). */
export interface SlabSet {
  readonly n: number;
  readonly on: boolean;
  /** Ranges and keys for the window starting at slab index k0; a no-op while the window is unchanged. */
  place(k0: number, slabPx: number): void;
  attach(world: Node3, on: boolean): void;
  /** Follows the game mesh: its geometry, and its resources through `sync`. */
  follow(geometry: unknown, sync: (shader: ShaderLike) => void): void;
  destroy(): void;
}

export function createSlabSet(C: PixiClasses, skip: WeakSet<Node3>, make: (range: UniformGroupLike) => ShaderLike, geometry: unknown, n: number): SlabSet {
  const meshes: Node3[] = [], shaders: ShaderLike[] = [], ranges: UniformGroupLike[] = [];
  const b: [number, number] = [0, 0];
  let on = false, placedK0 = NaN, placedPx = NaN;
  for (let i = 0; i < n; i++) {
    const range = new C.UniformGroup({ uSlab: { value: new Float32Array(2), type: 'vec2<f32>' } });
    const shader = make(range);
    const mesh = new C.Mesh({ geometry, shader, texture: C.Texture.WHITE });
    mesh.label = 'qpm3d-weather-slab';
    mesh.eventMode = 'none';
    skip.add(mesh);
    meshes.push(mesh); shaders.push(shader); ranges.push(range);
  }
  return {
    n,
    get on() { return on; },
    place(k0, slabPx) {
      if (k0 === placedK0 && slabPx === placedPx) return;
      placedK0 = k0; placedPx = slabPx;
      for (let i = 0; i < n; i++) {
        slabBounds(i, k0, n, slabPx, b);
        const v = ranges[i]!.uniforms.uSlab as Float32Array;
        v[0] = b[0]; v[1] = b[1];
        ranges[i]!.update();
        const key = slabKey(i, k0, slabPx);
        if (meshes[i]!.zIndex !== key) meshes[i]!.zIndex = key;
      }
    },
    attach(world, want) {
      if (want === on) return;
      on = want;
      for (const m of meshes) { if (want) world.addChild(m); else m.parent?.removeChild(m); }
    },
    follow(g, sync) {
      for (let i = 0; i < n; i++) {
        if (meshes[i]!.geometry !== g) meshes[i]!.geometry = g;
        sync(shaders[i]!);
      }
    },
    destroy() {
      for (let i = 0; i < meshes.length; i++) {
        meshes[i]!.parent?.removeChild(meshes[i]!);
        meshes[i]!.destroy();
        shaders[i]!.destroy(false); // the program is the mirror's, destroyed with its own shader
      }
      meshes.length = 0; shaders.length = 0; ranges.length = 0;
      on = false;
    },
  };
}
