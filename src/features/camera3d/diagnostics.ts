import { createFeatureDiagnostics } from '../../diagnostics/featureDiagnostics';
import type { DetailPreset } from './settings';

export const camera3dDiag = createFeatureDiagnostics('feature:camera3d', 'camera3d');

export interface Camera3dStatus {
  enabled: boolean;
  live: boolean;
  s: number;
  fp: boolean;
  detail: DetailPreset;
  caps: string;
  fails: number;
  pickMs: number | null;
  jsMs: number | null;
}

const MAX_LINE = 120;

// Half-up: (2.05).toFixed(1) is "2.0" because 2.05 is stored as 2.0499…
const ms = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

export function formatCamera3dLine(st: Camera3dStatus): string {
  const tail = `${st.pickMs !== null ? ` pick=${ms(st.pickMs)}ms` : ''}${st.jsMs !== null ? ` js=${ms(st.jsMs)}ms` : ''}`;
  const head = `3D: ${st.enabled ? 'on' : 'off'} live=${st.live ? 1 : 0} s=${st.s.toFixed(2)} fp=${st.fp ? 1 : 0} detail=${st.detail.charAt(0).toUpperCase()}`;
  const fails = ` fails=${st.fails}`;
  const room = MAX_LINE - head.length - fails.length - tail.length - ' caps='.length;
  const caps = st.caps.length > room ? `${st.caps.slice(0, Math.max(0, room - 1))}…` : st.caps;
  return `${head} caps=${caps}${fails}${tail}`;
}
