import { shareGlobal } from '../../core/pageContext';
import { createProbeApi } from './api';
import { createProbeState, stopProbeState } from './lifecycle';
import { removeOverlay } from './overlay';

export function registerUniversalProbe(target: Record<string, unknown>): () => void {
  const state = createProbeState();
  const api = createProbeApi(state);
  target.probe = api;

  shareGlobal('QPM_PROBE', () => api.scan());
  shareGlobal('QPM_PROBE_OVERLAY', () => api.overlay());
  shareGlobal('QPM_PICK', () => api.pickOnce());

  return () => {
    api.stop();
    removeOverlay(state);
    stopProbeState(state);
    delete target.probe;
  };
}
