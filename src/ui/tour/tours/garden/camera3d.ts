import { getCamera3dRuntime, getCamera3dSettings, getCamera3dView, markCamera3dHint, onCamera3dViewChange, type Camera3dView } from '../../../../features/camera3d';
import type { TourDefinition } from '../../types';

const canvas = (): HTMLElement | null => getCamera3dRuntime()?.caps.scene.renderer.canvas ?? null;

const until = (pred: (v: Camera3dView) => boolean) => (advance: () => void): (() => void) => {
  if (pred(getCamera3dView())) advance();
  return onCamera3dViewChange((v) => { if (pred(v)) advance(); });
};

export const camera3dTour: TourDefinition = {
  windowId: 'camera3d',
  label: '3D Camera',
  category: 'garden',
  version: 1,
  steps: [
    {
      id: 'enter',
      resolve: canvas,
      title: 'Try the 3D camera',
      body: 'Scroll in all the way, then keep scrolling.',
      advanceWhen: (advance) => {
        // The card says what the one-time detent / first-entry toasts would.
        markCamera3dHint('detent');
        markCamera3dHint('firstEntry');
        return until((v) => v.live)(advance);
      },
    },
    {
      id: 'look',
      resolve: () => (getCamera3dView().live ? canvas() : null),
      title: 'Look around',
      body: 'Right-drag to look. WASD walks where you face.',
    },
    {
      id: 'first-person',
      resolve: () => (getCamera3dSettings().firstPerson ? canvas() : null),
      title: 'First person',
      body: 'Keep scrolling in. Shift + right-click locks the mouse, Esc frees it.',
      advanceWhen: until((v) => v.fp),
    },
    {
      id: 'exit',
      resolve: canvas,
      title: 'Head back anytime',
      body: 'Scroll out to return. Settings: QPM → Config → 3D camera.',
    },
  ],
};
