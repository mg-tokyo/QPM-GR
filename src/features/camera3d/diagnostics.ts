import { createFeatureDiagnostics } from '../../diagnostics/featureDiagnostics';
import type { GraphicsPreset, GraphicsRows } from './settings';

export const camera3dDiag = createFeatureDiagnostics('feature:camera3d', 'camera3d');

/** fp: in first person now; firstPerson / camMove / invertY: the settings (A U8: "W walks the wrong way" reports).
 * blocked: why 3D would refuse to enter now (runtime blockedReason), null when it would not. gfx: the lit preset. */
export interface Camera3dStatus extends GraphicsRows {
  enabled: boolean;
  live: boolean;
  s: number;
  fp: boolean;
  blocked: string | null;
  fov: number;
  firstPerson: boolean;
  camMove: boolean;
  invertY: boolean;
  gfx: GraphicsPreset | 'custom';
  caps: string;
  fails: number;
  pickMs: number | null;
  jsMs: number | null;
}

const MAX_LINE = 120;

// Half-up: (2.05).toFixed(1) is "2.0" because 2.05 is stored as 2.0499…
const ms = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
const initial = (v: string): string => v.charAt(0).toUpperCase();

/** One copy-report line. opts lists the settings that are on: fp (first person), move (camera-relative WASD), invY.
 * gfx=H:MFHF is the lit preset, then detail, far animation, ground and weather by initial: the spec's named fields
 * don't fit the 120-character line (perf Task 9). */
export function formatCamera3dLine(st: Camera3dStatus): string {
  const fails = ` fails=${st.fails}`;
  if (!st.enabled) return `3D: off${st.fails ? fails : ''}`;
  const opts = [st.firstPerson ? 'fp' : '', st.camMove ? 'move' : '', st.invertY ? 'invY' : ''].filter(Boolean).join(',') || '-';
  const tail = `${st.pickMs !== null ? ` pick=${ms(st.pickMs)}ms` : ''}${st.jsMs !== null ? ` js=${ms(st.jsMs)}ms` : ''}`;
  const head = `3D: on live=${st.live ? 1 : 0} s=${st.s.toFixed(2)} fp=${st.fp ? 1 : 0}${st.blocked ? ` blocked=${st.blocked}` : ''}`
    + ` fov=${Math.round(st.fov)} opts=${opts} gfx=${initial(st.gfx)}:${initial(st.detail)}${initial(st.farAnim)}${initial(st.ground)}${initial(st.weather3d)}`;
  const room = MAX_LINE - head.length - fails.length - tail.length - ' caps='.length;
  const caps = st.caps.length > room ? `${st.caps.slice(0, Math.max(0, room - 1))}…` : st.caps;
  return `${head} caps=${caps}${fails}${tail}`;
}
